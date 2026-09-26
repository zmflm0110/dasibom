import type { OcrWord, Rect } from './types';

/** tesseract.js 결과(blocks)에서 쓰는 모양만 적었다. */
interface BBox { x0: number; y0: number; x1: number; y1: number }
interface TSymbol { text: string; bbox: BBox }
interface TWord { text: string; confidence: number; bbox: BBox; symbols?: TSymbol[] }
interface TLine { text?: string; words: TWord[] }
interface TPara { lines: TLine[] }
interface TBlock { paragraphs: TPara[] }

/**
 * tesseract 픽셀 좌표 → 0~1 정규화한 OcrWord[] (읽는 순서).
 *
 * 한국어에서 tesseract는 낱말을 글자 하나씩 쪼개 돌려주는 일이 잦다("비|유|법").
 * 그런데 줄 글자(line.text)에는 띄어쓰기가 제대로 들어 있다("비유법"). 그래서 줄 글자에
 * 맞춰 띄어쓰기 없이 붙은 조각을 다시 잇는다. 간격만으로는 못 가른다 — 재 보니
 * 낱말 안 간격(0~0.3)과 낱말 사이 간격(0.18~0.6, 줄 높이 대비)이 겹쳤다.
 */
export function fromTesseract(blocks: TBlock[] | null | undefined, width: number, height: number): OcrWord[] {
  const out: OcrWord[] = [];
  let line = 0;
  const norm = (b: BBox): Rect => ({ x: b.x0 / width, y: b.y0 / height, w: (b.x1 - b.x0) / width, h: (b.y1 - b.y0) / height });
  for (const bl of blocks ?? []) for (const p of bl.paragraphs) for (const l of p.lines) {
    const pieces: OcrWord[] = [];
    for (const w of l.words) {
      const text = w.text.trim();
      if (!text) continue;
      const chars = w.symbols && w.symbols.length === [...text].length ? w.symbols.map((s) => norm(s.bbox)) : undefined;
      pieces.push({ text, rect: norm(w.bbox), confidence: w.confidence, line, chars });
    }
    const glue = l.text ? spacesBefore(pieces.map((x) => x.text), l.text) : null;
    for (let i = 0; i < pieces.length; i++) {
      const prev = out[out.length - 1];
      if (i > 0 && glue && !glue[i]) out[out.length - 1] = join(prev, pieces[i]);
      else out.push(pieces[i]);
    }
    line++;
  }
  return out;
}

/** 각 조각 앞에 띄어쓰기가 있었나. 줄 글자와 맞춰 보다 어긋나면 null(그땐 안 잇는다). */
export function spacesBefore(pieces: string[], lineText: string): boolean[] | null {
  const res: boolean[] = [];
  let pos = 0;
  for (const piece of pieces) {
    let sawSpace = false;
    while (pos < lineText.length && /\s/.test(lineText[pos])) { sawSpace = true; pos++; }
    if (!lineText.startsWith(piece, pos)) return null;
    res.push(sawSpace || res.length === 0);
    pos += piece.length;
  }
  return res;
}

function join(a: OcrWord, b: OcrWord): OcrWord {
  const x0 = Math.min(a.rect.x, b.rect.x), y0 = Math.min(a.rect.y, b.rect.y);
  const x1 = Math.max(a.rect.x + a.rect.w, b.rect.x + b.rect.w), y1 = Math.max(a.rect.y + a.rect.h, b.rect.y + b.rect.h);
  return {
    text: a.text + b.text,
    rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    confidence: Math.min(a.confidence, b.confidence),
    line: a.line,
    chars: a.chars && b.chars ? [...a.chars, ...b.chars] : undefined,
  };
}
