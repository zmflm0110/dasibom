export type Weekday = 1 | 2 | 3 | 4 | 5 | 6;

export interface Timetable {
  /** 교시마다 시작·끝 "HH:MM" */
  periods: { start: string; end: string }[];
  /** 요일(1=월) → 교시별 과목. 빈 문자열은 빈 시간 */
  grid: Record<number, string[]>;
}

export const DEFAULT_PERIODS = [
  ['09:00', '09:45'], ['09:55', '10:40'], ['10:50', '11:35'], ['11:45', '12:30'],
  ['13:30', '14:15'], ['14:25', '15:10'], ['15:20', '16:05'],
].map(([start, end]) => ({ start, end }));

export const emptyTimetable = (): Timetable => ({
  periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
  grid: { 1: [], 2: [], 3: [], 4: [], 5: [] },
});

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** 끝나고 쉬는 시간에 찍어도 그 수업으로 친다. 판서는 대개 수업 끝에 찍힌다. */
export const GRACE_MIN = 10;

/** 찍은 시각 → 과목. 모르면 null(사용자가 한 번 고른다). */
export function subjectAt(t: Timetable, when: Date): string | null {
  const day = when.getDay();
  const row = t.grid[day];
  if (!row) return null;
  const now = when.getHours() * 60 + when.getMinutes();
  for (let i = 0; i < t.periods.length; i++) {
    const p = t.periods[i];
    if (now >= mins(p.start) && now < mins(p.end) + GRACE_MIN) {
      const s = row[i]?.trim();
      return s ? s : null;
    }
  }
  return null;
}

/** 시간표에 나오는 과목들(선택지용), 나온 순서대로 */
export function subjects(t: Timetable): string[] {
  const seen = new Set<string>();
  for (const d of Object.keys(t.grid).sort()) for (const s of t.grid[+d]) if (s?.trim()) seen.add(s.trim());
  return [...seen];
}
