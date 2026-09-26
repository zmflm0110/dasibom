import type { Blank, Group } from './types';
import { DAY } from './schedule';

/**
 * 우리 반에서 직접 재는 실험. 한 학생 안에서 비교한다(반 친구를 두 무리로 나눌 필요 없다).
 *
 * 사진마다 고른 빈칸을 반씩 나눈다.
 *   - practice: 평소처럼 복습 문제로 나온다(인출 연습).
 *   - control:  복습 때 가려지지 않고 사진에 그대로 보인다(다시 읽기만).
 * 찍고 7일 뒤 "최종 확인"에서 둘 다 가리고 한 번씩 묻는다. 두 무리의 기억률 차이가 효과다.
 */
export const FINAL_AFTER = 7 * DAY;

/** 문자열 → 0~1 (같은 입력이면 늘 같은 값). 무작위 배정을 재현 가능하게. */
export function hash01(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * 빈칸을 반씩 나눈다. 위치 순으로 짝을 지어 한 짝 안에서 하나씩 — 제목·본문이 한쪽에 몰리지 않게.
 * 홀수면 마지막 하나는 practice(공부 손해가 없게).
 */
export function assignGroups(photoId: string, blankIds: string[]): Map<string, Group> {
  const m = new Map<string, Group>();
  for (let i = 0; i < blankIds.length; i += 2) {
    const a = blankIds[i], b = blankIds[i + 1];
    if (b === undefined) { m.set(a, 'practice'); break; }
    const flip = hash01(photoId + ':' + i) < 0.5;
    m.set(a, flip ? 'practice' : 'control');
    m.set(b, flip ? 'control' : 'practice');
  }
  return m;
}

export interface ExperimentResult {
  photos: number;
  practice: { n: number; knew: number };
  control: { n: number; knew: number };
  /** 기억률 차이(%p). 표본이 적으면 null */
  diff: number | null;
}

export function summarize(blanks: Pick<Blank, 'group' | 'final' | 'photoId'>[]): ExperimentResult {
  const done = blanks.filter((b) => b.group && b.final);
  const g = (name: Group) => {
    const xs = done.filter((b) => b.group === name);
    return { n: xs.length, knew: xs.filter((b) => b.final!.knew).length };
  };
  const practice = g('practice'), control = g('control');
  const rate = (x: { n: number; knew: number }) => x.knew / x.n;
  const diff = practice.n >= 5 && control.n >= 5 ? Math.round((rate(practice) - rate(control)) * 1000) / 10 : null;
  return { photos: new Set(done.map((b) => b.photoId)).size, practice, control, diff };
}

export function toCsv(rows: { subject: string; photoId: string; group?: Group; final?: { at: number; knew: boolean }; history: { knew: boolean }[] }[]) {
  const head = 'subject,photo,group,reviews,final_knew';
  const body = rows.filter((r) => r.group && r.final).map((r) =>
    [r.subject, r.photoId, r.group, r.history.length, r.final!.knew ? 1 : 0].map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(','));
  return [head, ...body].join('\n') + '\n';
}
