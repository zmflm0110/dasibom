import type { OcrWord, Rect } from './types';

/**
 * OCR 낱말 중에서 "가리면 좋은 것"을 고른다. 고르기만 한다 — 학생이 한 번씩 톡 눌러 고친다.
 * 뜻을 몰라도 되는 신호만 쓴다: 제목, 쌍점 앞 말, 숫자+단위, 되풀이, 괄호 속.
 */

// 끝에서 떼어도 되는 조사(긴 것부터). 떼고 남는 게 두 글자 이상일 때만 뗀다('사과'의 '과' 보호).
const PARTICLES = ['에서는', '으로는', '에게서', '이라는', '에서', '으로', '에게', '한테', '까지', '부터', '처럼', '보다', '이다', '이며', '이고', '이나', '라는',
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과', '도', '만', '나'];

// 명사가 아닐 가능성이 큰 끝(용언 활용). 틀려도 학생이 고치면 된다.
const PREDICATE_END = /(한다|된다|했다|였다|이다|하는|되는|하고|하여|해서|하면|되면|으면|르면|오면|하며|하게|하지|합니다|입니다|니다|습니다|어요|아요|해요|세요|는데|면서|[다면며]|[아어여]서)$/;

// 판서에 자주 나오지만 가려 봐야 공부가 안 되는 말
const STOP = new Set(['그리고', '그러나', '하지만', '또는', '그래서', '따라서', '때문', '경우', '다음', '이것', '그것', '저것', '여기', '우리', '사람', '정리',
  '과정', '결과', '장소', '재료', '방법', '특징', '예시', '의미', '뜻', '종류', '내용', '문제', '답', '참고', '중요', '복습', '숙제', '시험', '오늘', '단원', '페이지',
  '가격', '같이', '아닌', '것을', '이는', '있다', '없다', '많이', '매우', '가장']);

export interface Candidate {
  /** 가릴 부분(조사를 뺀 앞부분) */
  text: string;
  rect: Rect;
  score: number;
  /** 왜 골랐는지 — 화면엔 안 보이고 측정·디버깅용 */
  why: string[];
  wordIndex: number;
}

const HANGUL = /[가-힣]/;

export function stripParticle(word: string): string {
  const w = word.replace(/[.,;:!?)\]}"'”’·…]+$/, '').replace(/^[(\["'“‘\[]+/, '');
  for (const p of PARTICLES) {
    if (w.endsWith(p) && [...w].length - p.length >= 2 && HANGUL.test(w.slice(-p.length - 1, -p.length))) return w.slice(0, -p.length);
  }
  return w;
}

/** 조사를 뗀 앞부분만 가리는 사각형. 글자 위치가 있으면 그대로, 없으면 글자 수 비례. */
export function stemRect(word: OcrWord, stem: string): Rect {
  const all = [...word.text];
  const start = word.text.indexOf(stem) >= 0 ? [...word.text.slice(0, word.text.indexOf(stem))].length : 0;
  const n = [...stem].length;
  if (word.chars && word.chars.length === all.length && n > 0) {
    const cs = word.chars.slice(start, start + n);
    const x0 = Math.min(...cs.map((c) => c.x)), y0 = Math.min(...cs.map((c) => c.y));
    const x1 = Math.max(...cs.map((c) => c.x + c.w)), y1 = Math.max(...cs.map((c) => c.y + c.h));
    return pad({ x: x0, y: Math.min(y0, word.rect.y), w: x1 - x0, h: Math.max(y1, word.rect.y + word.rect.h) - Math.min(y0, word.rect.y) });
  }
  const unit = word.rect.w / Math.max(1, all.length);
  return pad({ x: word.rect.x + unit * start, y: word.rect.y, w: unit * n, h: word.rect.h });
}

/** 가림 상자는 글자보다 조금 크게: 획 끝이 삐져나와 답이 새지 않게 */
function pad(r: Rect): Rect {
  const px = r.h * 0.12, py = r.h * 0.12;
  return { x: Math.max(0, r.x - px), y: Math.max(0, r.y - py), w: r.w + 2 * px, h: r.h + 2 * py };
}

export function isNumberTerm(s: string) {
  return /^\d{1,4}(년|월|일|세기|인|개|명|도|%|km|m|kg|g|cm|배|차|번|호|대|권)?$/.test(s) && /\d/.test(s) && (s.length >= 3 || /\D/.test(s));
}

export function scoreWords(words: OcrWord[]): Candidate[] {
  if (words.length === 0) return [];
  const heights = words.map((w) => w.rect.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)];
  const stems = words.map((w) => stripParticle(w.text));
  const count = new Map<string, number>();
  for (const s of stems) if ([...s].length >= 2) count.set(s, (count.get(s) ?? 0) + 1);

  const out: Candidate[] = [];
  words.forEach((w, i) => {
    const stem = stems[i];
    const len = [...stem].length;
    const why: string[] = [];
    let score = 0;
    const clean = w.text.replace(/[.,;!?]+$/, '');
    const isNum = isNumberTerm(stem);
    const isLatin = /^[A-Za-z][A-Za-z0-9₀-₉+\-]{1,}$/.test(stem);
    const isKo = /^[가-힣]+$/.test(stem);
    if (!isNum && !isLatin && !isKo) return; // 기호·깨진 글자
    if (len < 2 && !isNum) return;
    if (w.confidence < 45) return;
    if (STOP.has(stem)) return;
    if (isKo && stem === clean.replace(/[:：]$/, '') && PREDICATE_END.test(stem)) return;
    if (isKo && len > 7) return; // 이어 쓴 말 덩어리일 가능성

    // 제목(다른 글자보다 확실히 큼)
    if (w.rect.h > medianH * 1.25) { score += 3; why.push('제목'); }
    // "장소: 엽록체" 처럼 쌍점·등호 바로 뒤, 또는 "직유법:" 처럼 쌍점 앞 머리말
    const prev = words[i - 1];
    if (/[:：=]$/.test(w.text)) { score += 3; why.push('머리말'); }
    if (prev && prev.line === w.line && /[:：=→]$/.test(prev.text)) { score += 2; why.push('쌍점 뒤'); }
    if (prev && prev.line === w.line && /^[:：=→]$/.test(prev.text)) { score += 2; why.push('쌍점 뒤'); }
    if (i > 0 && prev?.line !== w.line && /^[:：]/.test(words[i + 1]?.text ?? '')) { score += 3; why.push('머리말'); }
    // "균형 가격:" 처럼 쌍점으로 끝나는 머리말이 두 낱말이면 앞 낱말도 머리말
    const next = words[i + 1];
    if ((prev?.line !== w.line) && next?.line === w.line && /[:：]$/.test(next.text) && !/[:：]$/.test(w.text)) { score += 2; why.push('머리말 앞'); }
    // 줄 끝 명사: "가격이 오르면 수요량은 감소" — 결론이 줄 끝에 온다
    if (i > 0 && prev?.line === w.line && next?.line !== w.line && stem === clean && isKo) { score += 1.5; why.push('줄 끝'); }
    if (isNum) { score += 3; why.push('숫자'); }
    if (isLatin) { score += 1; why.push('영문'); }
    if (/^\(/.test(w.text) || /\)$/.test(w.text)) { score += 1; why.push('괄호'); }
    if ((count.get(stem) ?? 0) >= 2) { score += 2; why.push('되풀이'); }
    if (isKo && len >= 3 && len <= 5) { score += 1; why.push('길이'); }
    // 한자어 개념어에 흔한 끝 글자
    if (isKo && /(법|성|체|설|론|권|력|량|율|률|식|소|제|기|화|학|계|층|물|질|형|파|자)$/.test(stem) && len >= 2) { score += 1; why.push('개념어 끝'); }
    if (stem !== clean) { score += 0.5; why.push('조사 붙음'); } // 조사가 붙었다면 명사일 가능성이 높다
    if (w.confidence < 70) score -= 1;

    out.push({ text: stem, rect: stemRect(w, stem), score, why, wordIndex: i });
  });
  return out;
}

/**
 * 추천 빈칸: 점수 높은 순, 같은 말은 한 번만, 한 줄에 둘까지.
 * 너무 많이 가리면 문제가 아니라 빈 종이가 된다 — 낱말의 3분의 1, 최대 8개.
 */
export function suggestBlanks(words: OcrWord[], opts: { max?: number; minScore?: number } = {}): Candidate[] {
  const minScore = opts.minScore ?? 2;
  const max = Math.min(opts.max ?? 8, Math.max(1, Math.ceil(words.length / 3)));
  const ranked = scoreWords(words).filter((c) => c.score >= minScore).sort((a, b) => b.score - a.score || a.wordIndex - b.wordIndex);
  const seen = new Set<string>();
  const perLine = new Map<number, number>();
  const picked: Candidate[] = [];
  for (const c of ranked) {
    if (picked.length >= max) break;
    const line = words[c.wordIndex].line;
    if (seen.has(c.text) || (perLine.get(line) ?? 0) >= 2) continue;
    seen.add(c.text);
    perLine.set(line, (perLine.get(line) ?? 0) + 1);
    picked.push(c);
  }
  return picked.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/** 두 사각형이 얼마나 겹치나(IoU). 테스트와 "이미 가린 낱말" 판별에 쓴다. */
export function iou(a: Rect, b: Rect) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}
