import type { Blank } from './types';

const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/**
 * 상자마다 다음 복습까지의 간격(일). 맞히면 한 칸 올라가고, 모르면 첫 칸으로 돌아간다.
 * 1·3·7·14·30일은 학생이 "시험 전까지" 기억하는 데 맞춘 흔한 간격이다.
 */
export const INTERVALS = [1, 3, 7, 14, 30, 60];

/** 첫 복습은 찍은 날 안에 한다. 수업 중에 알림이 뜨지 않게 세 시간 뒤. */
export const FIRST_DELAY = 3 * HOUR;

export function newSchedule(now: number): Pick<Blank, 'box' | 'due'> {
  return { box: 0, due: now + FIRST_DELAY };
}

export function grade(b: Pick<Blank, 'box' | 'due' | 'history'>, knew: boolean, now: number) {
  const box = knew ? Math.min(b.box + 1, INTERVALS.length) : 0;
  const days = INTERVALS[Math.max(0, box - 1)] ?? INTERVALS[INTERVALS.length - 1];
  // 모른 것은 내일 다시. 맞힌 것은 상자 간격만큼 뒤, 단 새벽이 아니라 같은 시각.
  return { box, due: now + days * DAY, history: [...b.history, { at: now, knew }] };
}

export function isDue(b: Pick<Blank, 'due' | 'group'>, now: number) {
  return b.group !== 'control' && b.due <= now;
}

/** 오늘 풀 것: 늦은 것부터, 같은 사진끼리 붙여서(사진을 매번 새로 읽지 않게). */
export function dueQueue<T extends Pick<Blank, 'due' | 'group' | 'photoId' | 'rect'>>(blanks: T[], now: number): T[] {
  const due = blanks.filter((b) => isDue(b, now));
  const firstDue = new Map<string, number>();
  for (const b of due) firstDue.set(b.photoId, Math.min(firstDue.get(b.photoId) ?? Infinity, b.due));
  return due.sort((a, b) =>
    (firstDue.get(a.photoId)! - firstDue.get(b.photoId)!) ||
    a.photoId.localeCompare(b.photoId) ||
    (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
}

/** 이 상자까지 올라간 빈칸은 "외웠다"로 센다(14일 간격을 한 번 넘김). */
export const LEARNED_BOX = 4;
