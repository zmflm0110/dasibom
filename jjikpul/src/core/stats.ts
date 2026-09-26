import type { Blank } from './types';
import { LEARNED_BOX } from './schedule';

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** 오늘까지 며칠 연속 복습했나. 오늘 아직 안 했으면 어제까지를 센다(아침에 0이 되지 않게). */
export function streak(blanks: Pick<Blank, 'history'>[], now: number): number {
  const days = new Set<string>();
  for (const b of blanks) for (const h of b.history) days.add(dayKey(h.at));
  const DAY = 86_400_000;
  let t = now;
  if (!days.has(dayKey(t))) t -= DAY;
  let n = 0;
  while (days.has(dayKey(t))) { n++; t -= DAY; }
  return n;
}

export function learned(blanks: Pick<Blank, 'box' | 'group'>[]) {
  return blanks.filter((b) => b.group !== 'control' && b.box >= LEARNED_BOX).length;
}

/** 다음에 풀 것이 언제, 몇 개 생기나(오늘 할 게 끝났을 때 보여 준다) */
export function nextDue(blanks: Pick<Blank, 'due' | 'group'>[], now: number): { at: number; count: number } | null {
  const future = blanks.filter((b) => b.group !== 'control' && b.due > now).map((b) => b.due).sort((a, b) => a - b);
  if (!future.length) return null;
  const first = future[0];
  const sameDay = future.filter((t) => dayKey(t) === dayKey(first)).length;
  return { at: first, count: sameDay };
}
