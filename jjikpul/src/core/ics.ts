/**
 * 복습 알림. 웹앱은 서버 없이 정해진 시각에 알림을 못 띄운다(푸시에는 서버가 필요).
 * 대신 폰 캘린더에 "매일 이 시각 찍풀 복습" 반복 일정을 넣는다 — 서버 없이 되는 알림이다.
 */
export function reminderIcs(hhmm: string, url: string, now = new Date()): string {
  const [h, m] = hhmm.split(':').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jjikpul//KO', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:jjikpul-review-${d}@jjikpul`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${d}T${pad(h)}${pad(m)}00`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:찍풀 복습 (5분)',
    `DESCRIPTION:오늘 풀 빈칸을 풀어요. ${url}`,
    `URL:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:찍풀 복습', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
