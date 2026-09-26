import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { grade, newSchedule, dueQueue, DAY, INTERVALS, FIRST_DELAY } from '../src/core/schedule';
import { subjectAt, emptyTimetable, subjects } from '../src/core/timetable';
import { stripParticle, suggestBlanks, stemRect, isNumberTerm, iou } from '../src/core/blanks';
import { fromTesseract, spacesBefore } from '../src/core/ocrWords';
import { assignGroups, summarize, toCsv, hash01 } from '../src/core/experiment';
import type { OcrWord } from '../src/core/types';

describe('복습 일정', () => {
  const t0 = Date.UTC(2026, 8, 1, 9);
  it('첫 복습은 찍은 날 안에', () => {
    expect(newSchedule(t0).due).toBe(t0 + FIRST_DELAY);
    expect(FIRST_DELAY).toBeLessThan(12 * 3600_000);
  });
  it('맞히면 간격이 늘고, 모르면 내일로', () => {
    let b = { ...newSchedule(t0), history: [] as { at: number; knew: boolean }[] };
    const gaps: number[] = [];
    let now = t0;
    for (let i = 0; i < 5; i++) { const n = grade(b, true, now); gaps.push((n.due - now) / DAY); now = n.due; b = n; }
    expect(gaps).toEqual(INTERVALS.slice(0, 5));
    const miss = grade(b, false, now);
    expect(miss.box).toBe(0);
    expect(miss.due - now).toBe(DAY);
    expect(miss.history).toHaveLength(6);
  });
  it('상자는 끝을 넘지 않는다', () => {
    let b = { box: INTERVALS.length, due: 0, history: [] };
    expect(grade(b, true, 0).box).toBe(INTERVALS.length);
  });
  it('오늘 풀 것: 대조군은 빼고, 같은 사진끼리 위에서 아래로', () => {
    const r = (y: number) => ({ x: 0, y, w: .1, h: .05 });
    const q = dueQueue([
      { photoId: 'b', due: 5, rect: r(.5) },
      { photoId: 'a', due: 9, rect: r(.9) },
      { photoId: 'b', due: 7, rect: r(.1) },
      { photoId: 'a', due: 1, rect: r(.2), group: 'control' as const },
      { photoId: 'c', due: 99, rect: r(.1) },
    ], 10);
    expect(q.map((b) => b.photoId + b.rect.y)).toEqual(['b0.1', 'b0.5', 'a0.9']);
  });
});

describe('시간표로 과목 알아내기', () => {
  const t = emptyTimetable();
  t.grid[2] = ['국어', '수학', '과학', '', '역사'];
  // 2026-09-01은 화요일
  const at = (h: number, m: number) => new Date(2026, 8, 1, h, m);
  it('수업 중', () => expect(subjectAt(t, at(10, 0))).toBe('수학'));
  it('끝나고 쉬는 시간에 찍어도 그 수업', () => expect(subjectAt(t, at(10, 45))).toBe('수학'));
  it('점심·빈 시간·주말은 모름', () => {
    expect(subjectAt(t, at(12, 50))).toBeNull();
    expect(subjectAt(t, at(12, 0))).toBeNull();
    expect(subjectAt(t, new Date(2026, 8, 6, 10, 0))).toBeNull();
  });
  it('과목 목록은 중복 없이', () => {
    t.grid[3] = ['수학', '영어'];
    expect(subjects(t)).toEqual(['국어', '수학', '과학', '역사', '영어']);
  });
});

describe('조사 떼기', () => {
  it.each([
    ['포도당을', '포도당'], ['수요량은', '수요량'], ['엽록체에서', '엽록체'], ['광합성', '광합성'],
    ['사과', '사과'], ['결과', '결과'], ['증가', '증가'], ['국가가', '국가'], ['(1919년)', '1919년'], ['직유법:', '직유법'],
  ])('%s → %s', (a, b) => expect(stripParticle(a)).toBe(b));
});

describe('숫자 낱말', () => {
  it.each(['1919년', '33인', '100%', '3개', '1945'])('%s 은 가릴 만하다', (s) => expect(isNumberTerm(s)).toBe(true));
  it.each(['1', '12', '가'])('%s 는 아니다', (s) => expect(isNumberTerm(s)).toBe(false));
});

const w = (text: string, line: number, x: number, h = 0.04, confidence = 95): OcrWord =>
  ({ text, line, confidence, rect: { x, y: line * 0.1, w: 0.03 * [...text].length, h } });

describe('빈칸 추천', () => {
  it('제목·쌍점·숫자를 고르고, 용언·불용어는 안 고른다', () => {
    const words = [
      w('광합성', 0, 0.1, 0.07),
      w('빛에너지를', 1, 0.1), w('이용해', 1, 0.3), w('포도당을', 1, 0.5), w('만드는', 1, 0.7), w('과정', 1, 0.85),
      w('장소:', 2, 0.1), w('엽록체', 2, 0.3),
      w('1919년', 3, 0.1), w('발표한다', 3, 0.3),
    ];
    const s = suggestBlanks(words).map((c) => c.text);
    expect(s).toContain('광합성');
    expect(s).toContain('엽록체');
    expect(s).toContain('1919년');
    expect(s).not.toContain('만드는');
    expect(s).not.toContain('과정');
    expect(s).not.toContain('발표한다');
  });
  it('낱말의 3분의 1, 최대 8개까지만', () => {
    const many = Array.from({ length: 60 }, (_, i) => w(`${1000 + i}년`, i, 0.1));
    expect(suggestBlanks(many)).toHaveLength(8);
    expect(suggestBlanks(many.slice(0, 6))).toHaveLength(2);
  });
  it('같은 말은 한 번만', () => {
    const s = suggestBlanks([w('수요량', 0, .1), w('=', 0, .3), w('수요량', 1, .1), w('=', 1, .3), w('공급량', 2, .1)]);
    expect(s.filter((c) => c.text === '수요량')).toHaveLength(1);
  });
  it('빈 입력', () => expect(suggestBlanks([])).toEqual([]));
  it('조사를 뺀 부분만 가린다(글자 위치가 있으면 그대로)', () => {
    const word = { ...w('포도당을', 0, 0.2), chars: [0, 1, 2, 3].map((i) => ({ x: 0.2 + i * 0.03, y: 0, w: 0.028, h: 0.04 })) };
    const r = stemRect(word, '포도당');
    expect(r.x).toBeLessThan(0.2);
    expect(r.x + r.w).toBeGreaterThan(0.2 + 0.03 * 2 + 0.028);
    expect(r.x + r.w).toBeLessThan(0.2 + 0.03 * 3 + 0.005);
  });
  it('가림 상자는 글자를 빠짐없이 덮는다', () => {
    const word = w('엽록체', 0, 0.3);
    expect(iou(stemRect(word, '엽록체'), word.rect)).toBeGreaterThan(0.6);
    const r = stemRect(word, '엽록체');
    expect(r.x).toBeLessThanOrEqual(word.rect.x);
    expect(r.y + r.h).toBeGreaterThanOrEqual(word.rect.y + word.rect.h);
  });
});

describe('tesseract 결과 잇기', () => {
  it('줄 글자의 띄어쓰기에 맞춰 쪼개진 글자를 잇는다', () => {
    expect(spacesBefore(['비', '유', '법'], '비유법\n')).toEqual([true, false, false]);
    expect(spacesBefore(['직', '유', '법', ':', 'AL'], '직유법: AL\n')).toEqual([true, false, false, false, true]);
    expect(spacesBefore(['가', '나'], '다라')).toBeNull();
  });
  it('실제 OCR 결과에서 "비유법"이 한 낱말이 된다', () => {
    const o = JSON.parse(readFileSync(new URL('./fixtures-ocr.json', import.meta.url), 'utf8'))['kor-slide-white-clean.jpg'];
    const words = fromTesseract(o.blocks, o.width, o.height);
    expect(words.map((x) => x.text)).toContain('비유법');
    expect(words.map((x) => x.text)).toContain('직유법:');
    for (const x of words) {
      expect(x.rect.x).toBeGreaterThanOrEqual(0);
      expect(x.rect.x + x.rect.w).toBeLessThanOrEqual(1);
    }
  });
});

describe('측정 사진 전체에서 추천 품질이 떨어지지 않는다(회귀 방지)', () => {
  it('핵심어 60% 이상, 정밀도 80% 이상', () => {
    const idx = JSON.parse(readFileSync(new URL('../eval/fixtures/index.json', import.meta.url), 'utf8'));
    const ocr = JSON.parse(readFileSync(new URL('./fixtures-ocr.json', import.meta.url), 'utf8'));
    let hit = 0, keys = 0, good = 0, picked = 0;
    for (const f of idx) {
      const o = ocr[f.file];
      const s = suggestBlanks(fromTesseract(o.blocks, o.width, o.height));
      const match = (c: string, k: string) => c.includes(k) || (k.includes(c) && c.length >= 2);
      hit += f.keys.filter((k: string) => s.some((c) => match(c.text, k))).length;
      good += s.filter((c) => f.keys.some((k: string) => match(c.text, k))).length;
      keys += f.keys.length; picked += s.length;
    }
    expect(hit / keys).toBeGreaterThan(0.6);
    expect(good / picked).toBeGreaterThan(0.8);
  });
});

describe('실험', () => {
  it('반씩 나누고, 홀수면 남는 하나는 연습', () => {
    const g = assignGroups('p1', ['a', 'b', 'c', 'd', 'e']);
    const vals = [...g.values()];
    expect(vals.filter((v) => v === 'control')).toHaveLength(2);
    expect(g.get('e')).toBe('practice');
  });
  it('같은 사진이면 늘 같은 배정(재현 가능)', () => {
    expect([...assignGroups('xyz', ['a', 'b', 'c', 'd'])]).toEqual([...assignGroups('xyz', ['a', 'b', 'c', 'd'])]);
  });
  it('배정은 한쪽으로 치우치지 않는다', () => {
    let first = 0;
    for (let i = 0; i < 1000; i++) if (assignGroups('p' + i, ['a', 'b']).get('a') === 'practice') first++;
    expect(first).toBeGreaterThan(420);
    expect(first).toBeLessThan(580);
    expect(hash01('a')).not.toBe(hash01('b'));
  });
  it('요약: 표본이 적으면 차이를 말하지 않는다', () => {
    const f = (group: 'practice' | 'control', knew: boolean) => ({ group, photoId: 'p', final: { at: 0, knew } });
    expect(summarize([f('practice', true), f('control', false)]).diff).toBeNull();
    const many = [...Array(8)].map((_, i) => f('practice', i < 6)).concat([...Array(8)].map((_, i) => f('control', i < 3)));
    const s = summarize(many);
    expect(s.practice).toEqual({ n: 8, knew: 6 });
    expect(s.diff).toBe(37.5);
  });
  it('CSV는 최종 확인까지 한 것만, 쉼표는 따옴표로', () => {
    const csv = toCsv([
      { subject: '과학, 1반', photoId: 'p', group: 'practice', final: { at: 0, knew: true }, history: [{ knew: true }] },
      { subject: '국어', photoId: 'q', group: 'control', history: [] },
    ]);
    expect(csv).toBe('subject,photo,group,reviews,final_knew\n"과학, 1반",p,practice,1,1\n');
  });
});

import { reminderIcs } from '../src/core/ics';
import { streak, learned, nextDue } from '../src/core/stats';

describe('캘린더 알림', () => {
  it('매일 반복 일정과 알람이 들어 있다', () => {
    const ics = reminderIcs('19:30', 'https://x.test/', new Date(2026, 8, 1, 10));
    expect(ics).toContain('DTSTART:20260901T193000');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe('기록', () => {
  const D = 86_400_000, now = new Date(2026, 8, 10, 20).getTime();
  const h = (...daysAgo: number[]) => ({ history: daysAgo.map((d) => ({ at: now - d * D, knew: true })) });
  it('연속 복습일: 오늘 안 했으면 어제까지', () => {
    expect(streak([h(0, 1, 2), h(4)], now)).toBe(3);
    expect(streak([h(1, 2)], now)).toBe(2);
    expect(streak([h(3)], now)).toBe(0);
    expect(streak([], now)).toBe(0);
  });
  it('외운 빈칸은 대조군을 빼고 센다', () => {
    expect(learned([{ box: 4 }, { box: 5 }, { box: 1 }, { box: 6, group: 'control' }])).toBe(2);
  });
  it('다음 복습: 가장 이른 날과 그날 개수', () => {
    expect(nextDue([{ due: now + D }, { due: now + D + 60_000 }, { due: now + 3 * D }, { due: now - 1 }], now)).toEqual({ at: now + D, count: 2 });
    expect(nextDue([{ due: now - 5 }], now)).toBeNull();
  });
});
