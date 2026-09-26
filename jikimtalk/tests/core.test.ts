import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize, ngrams } from '../src/core/normalize';
import { parseChat, participants, parseSystem, detectFormat } from '../src/core/parse';
import { analyze, ruleHits, tally, context } from '../src/core/detect';
import { makeScorer } from '../src/core/model';
import { IOS, PC, MAC, MULTI_INVITE } from './fixtures';

const model = JSON.parse(readFileSync(new URL('../public/model.json', import.meta.url), 'utf8'));
const score = makeScorer(model);
const EXAMPLE = readFileSync(new URL('../public/samples/example-android.txt', import.meta.url), 'utf8');

describe('다듬기는 파이썬(학습)과 똑같다', () => {
  const cases = JSON.parse(readFileSync(new URL('./parity.json', import.meta.url), 'utf8'));
  it.each(cases.map((c: { in: string }) => [c.in, c]))('%s', (_s, c: { in: string; norm: string; ngrams: string[] }) => {
    expect(normalize(c.in)).toBe(c.norm);
    expect(ngrams(c.in)).toEqual(c.ngrams);
  });
});

describe('모델', () => {
  it('공격적인 말은 높게, 일상 말은 낮게', () => {
    expect(score('너 진짜 병신같다 꺼져')).toBeGreaterThan(model.threshold);
    expect(score('내일 수행평가 뭐였지')).toBeLessThan(model.threshold);
    expect(score('오늘 급식 돈까스래')).toBeLessThan(model.threshold);
  });
});

describe('카톡 내보내기 읽기', () => {
  it('안드로이드: 제목·메시지·시스템 줄·여러 줄', () => {
    const c = parseChat(EXAMPLE);
    expect(c.format).toBe('android');
    expect(c.title).toBe('2학년 3반 단톡');
    expect(c.unparsed).toBe(0);
    const m = c.messages.find((x) => x.text.startsWith('니 얼굴 보면'))!;
    expect(m.text).toBe('니 얼굴 보면\n토 나와');
    expect(m.sender).toBe('최도윤');
    expect(new Date(m.t).getHours()).toBe(22);
    const inv = c.messages.filter((x) => x.sys?.type === 'invite');
    expect(inv).toHaveLength(2);
    expect(inv[0].sys).toEqual({ type: 'invite', actor: '박서준', targets: ['김민지'] });
  });
  it('아이폰: 점 날짜, 오전 12시는 자정', () => {
    const c = parseChat(IOS);
    expect(c.format).toBe('ios');
    expect(c.messages.map((m) => m.kind)).toEqual(['msg', 'msg', 'system', 'system', 'msg']);
    expect(c.messages[1].text).toBe('너 꺼져\n여러 줄로\n쓴 말');
    expect(new Date(c.messages[4].t).getHours()).toBe(0);
  });
  it('PC: 날짜 줄 + [이름] [시각], 시스템 줄은 앞 시각', () => {
    const c = parseChat(PC);
    expect(c.format).toBe('pc');
    expect(c.messages.map((m) => m.sender)).toEqual(['박서준', '최도윤', '', '', '이하은']);
    expect(c.messages[4].text).toBe('[괄호로] 시작하는 말');
    expect(c.messages[2].t).toBe(c.messages[1].t);
    expect(c.messages[3].sys?.type).toBe('invite');
  });
  it('맥 CSV: 쉼표·따옴표가 든 말', () => {
    const c = parseChat(MAC);
    expect(c.format).toBe('mac-csv');
    expect(c.messages[1].text).toBe('너 꺼져, "진짜"');
    expect(c.messages[2].sys?.type).toBe('leave');
  });
  it('여러 명 초대, 강퇴, 들어옴', () => {
    expect(parseChat(MULTI_INVITE).messages[0].sys).toEqual({ type: 'invite', actor: '박서준', targets: ['김민지', '이하은', '최도윤'] });
    expect(parseSystem('박서준님이 김민지님을 내보냈습니다.')).toEqual({ type: 'kick', actor: '박서준', targets: ['김민지'] });
    expect(parseSystem('김민지님이 들어왔습니다.')?.type).toBe('join');
  });
  it('원문은 한 글자도 안 바뀐다', () => {
    const c = parseChat(EXAMPLE);
    const lines = EXAMPLE.split('\n');
    for (const m of c.messages.filter((x) => x.kind === 'msg')) expect(lines[m.line - 1]).toContain(m.text.split('\n')[0]);
  });
  it('모르는 파일', () => {
    expect(detectFormat(['그냥 글', '아무거나'])).toBe('unknown');
    expect(parseChat('').messages).toEqual([]);
  });
  it('참여자: 말 많은 순, 말 안 한 사람도', () => {
    const p = participants(parseChat(EXAMPLE));
    expect(p[0].name).toBe('박서준');
    expect(p.map((x) => x.name)).toContain('김민지');
  });
});

describe('규칙', () => {
  it.each([
    ['죽여버린다', 'threat'], ['선생님한테 말하면 죽는다', 'threat'], ['학교에서 보자', 'threat'],
    ['만원만 가져와', 'money'], ['기프티콘 보내라', 'money'], ['핫스팟 켜', 'money'],
    ['반 단톡에 뿌린다', 'exposure'], ['박제 ㅋㅋ', 'exposure'],
    ['너 빼고 다 가', 'exclude'], ['꺼져', 'exclude'], ['아무도 너 안 좋아해', 'exclude'],
    ['돼지야', 'looks'], ['냄새나서', 'looks'],
    ['시1발', 'curse'], ['ㅅㅂ', 'curse'], ['병신같네', 'curse'],
    ['죽어버려', 'selfharm'], ['뛰어내려', 'selfharm'],
  ])('%s → %s', (text, cat) => expect(ruleHits(text).map((h) => h.cat)).toContain(cat));
  it.each(['보지 마', '자지 마 일어나', '걸레질 해야 돼', '껌 씹어', '새끼 고양이 귀여워', '쓰레기 분리수거', '빵 사왔어', '너무 웃기다', '나가서 놀자', '아니 그게 아니라', '오늘 급식 돈까스'])(
    '일상 말 "%s" 은 규칙에 안 걸린다', (text) => expect(ruleHits(text)).toEqual([]));
});

describe('찾기: 예시 대화', () => {
  const chat = parseChat(EXAMPLE);
  const a = analyze(chat, { me: '김민지', score, threshold: model.threshold });
  it('나를 향한 말만 골라도 괴롭힘이 다 잡힌다', () => {
    const texts = a.flags.filter((f) => f.toMe).map((f) => f.msg.text);
    for (const t of ['몰라 돼지야', '민지 꺼져', '김민지 월요일에 만원만 가져와', '그럼 학교에서 보자', '싫은데? 반 단톡에 뿌린다', '니 얼굴 보면\n토 나와'])
      expect(texts).toContain(t);
  });
  it('내가 한 말은 표시하지 않는다', () => {
    expect(a.flags.some((f) => f.msg.sender === '김민지')).toBe(false);
  });
  it('친구끼리 장난 욕은 표시하되 나를 향한 말로 보지 않는다', () => {
    const f = a.flags.find((x) => x.msg.text.startsWith('아 시발 나 보고서'));
    expect(f?.toMe).toBe(false);
  });
  it('일상 말은 표시하지 않는다', () => {
    const texts = a.flags.map((f) => f.msg.text);
    for (const t of ['내일 수행평가 뭐였지', '오늘 급식 뭐야', '돈까스!!', '8시 반 정문', '내일 소풍 몇 시까지야?']) expect(texts).not.toContain(t);
  });
  it('카톡감옥 2번, 방폭 1번, 떼카 1번 이상', () => {
    const count = (t: string) => a.events.filter((e) => e.type === t).length;
    expect(count('prison')).toBe(2);
    expect(count('roomBomb')).toBe(1);
    expect(a.events.find((e) => e.type === 'roomBomb')!.people).toEqual(['박서준', '이하은', '최도윤', '정유나']);
    expect(count('gang')).toBeGreaterThanOrEqual(1);
  });
  it('위험 수준: 협박·돈 요구는 3', () => {
    expect(a.flags.find((f) => f.msg.text === '그럼 학교에서 보자')!.level).toBe(3);
    expect(a.flags.find((f) => f.msg.text === '몰라 돼지야')!.level).toBe(2);
  });
  it('사람별 표와 앞뒤 대화', () => {
    const t = tally(a.flags.filter((f) => f.toMe));
    expect(t[0].name).toBe('박서준');
    const f = a.flags.find((x) => x.msg.text === '몰라 돼지야')!;
    expect(context(chat, f.msg).map((m) => m.text)).toEqual(expect.arrayContaining(['오늘 체육 시간에 내 가방 누가 가져갔어?', '냄새나서 치운 거 아님?']));
  });
  it('강퇴', () => {
    const c = parseChat(`2026년 9월 2일 오후 9:41, 박서준님이 김민지님을 내보냈습니다.`);
    expect(analyze(c, { me: '김민지' }).events.map((e) => e.type)).toEqual(['kicked']);
  });
  it('내 말 속 위험 신호는 따로 모은다(보고서엔 안 넣음)', () => {
    const c = parseChat(`2026년 9월 2일 오후 9:41, 김민지 : 진짜 죽고 싶다\n2026년 9월 2일 오후 9:42, 김민지 : 배고파`);
    expect(analyze(c, { me: '김민지' }).selfRisk.map((m) => m.text)).toEqual(['진짜 죽고 싶다']);
  });
});

describe('나를 향한 말 판단', () => {
  const at = (hm: string, who: string, text: string) => `2026년 9월 2일 오후 ${hm}, ${who} : ${text}`;
  it('이름으로 부른 공격 뒤 3분 안에 이어진 말은 같은 흐름', () => {
    const c = parseChat([at('9:00', '가', '민지 꺼져'), at('9:02', '나', '진짜 병신같네'), at('9:20', '다', '진짜 병신같네')].join('\n'));
    const a = analyze(c, { me: '김민지' });
    expect(a.flags.map((f) => f.toMe)).toEqual(['name', 'thread', false]);
  });
  it('"너무"·"아니"는 너·니가 아니다', () => {
    const c = parseChat([at('9:00', '가', '너무 병신같은 시험'), at('9:30', '가', '아니 시발')].join('\n'));
    expect(analyze(c, { me: '김민지' }).flags.map((f) => f.toMe)).toEqual([false, false]);
  });
  it('별명으로 불러도 안다', () => {
    const c = parseChat(at('9:00', '가', '뚱민 꺼져'));
    expect(analyze(c, { me: '김민지', aliases: ['뚱민'] }).flags[0].toMe).toBe('name');
  });
});
