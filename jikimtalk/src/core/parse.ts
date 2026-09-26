/**
 * 카카오톡 "대화 내보내기" 파일을 메시지 목록으로.
 *
 * 폰·PC마다 모양이 다르다. 알려진 네 가지를 읽고, 어느 줄에도 안 맞는 줄은 앞 메시지에
 * 이어 붙인다(여러 줄 메시지). 글자는 한 자도 고치지 않는다 — 보고서에 원문 그대로 들어간다.
 */

export type SysType = 'invite' | 'leave' | 'kick' | 'join' | 'other';
export interface Msg {
  /** 파일 안 순서(0부터) */
  i: number;
  /** 보낸 시각(기기 시간대 기준 ms) */
  t: number;
  sender: string;
  text: string;
  kind: 'msg' | 'system';
  sys?: { type: SysType; actor?: string; targets: string[] };
  /** 원본 파일의 몇째 줄(1부터) — 보고서에서 원본과 맞춰 볼 수 있게 */
  line: number;
}
export interface Chat { title: string; format: Format; messages: Msg[]; unparsed: number }
export type Format = 'android' | 'ios' | 'pc' | 'mac-csv' | 'unknown';

const AMPM = '(오전|오후|AM|PM|am|pm)';
// 2024년 3월 4일 오후 2:10, 이름 : 내용      (안드로이드)
const RE_KO = new RegExp(`^(\\d{4})년 (\\d{1,2})월 (\\d{1,2})일 (?:${AMPM} )?(\\d{1,2}):(\\d{2})(?::\\d{2})?, (.+)$`);
// 2024. 3. 4. 오후 2:10, 이름 : 내용         (아이폰)
const RE_DOT = new RegExp(`^(\\d{4})\\. ?(\\d{1,2})\\. ?(\\d{1,2})\\.? (?:${AMPM} )?(\\d{1,2}):(\\d{2})(?::\\d{2})?, (.+)$`);
// --------------- 2024년 3월 4일 월요일 ---------------   (PC 날짜 줄)
const RE_PC_DATE = /^-{3,} ?(\d{4})년 (\d{1,2})월 (\d{1,2})일 \S+ ?-{3,}$/;
// [이름] [오후 2:10] 내용                    (PC)
const RE_PC_MSG = new RegExp(`^\\[(.+?)\\] \\[(?:${AMPM} )?(\\d{1,2}):(\\d{2})\\] ?(.*)$`);
// 날짜만 있는 줄: "2024년 3월 4일 월요일", "2024년 3월 4일 오후 2:10"
const RE_DATE_ONLY = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일( \S+요일)?( (오전|오후) \d{1,2}:\d{2})?$/;
// Mac CSV: 2024-03-04 14:10:00,"이름","내용"
const RE_CSV = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?,/;

function hour24(h: number, ampm?: string) {
  if (!ampm) return h;
  const pm = ampm === '오후' || ampm.toLowerCase() === 'pm';
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}
const at = (y: string, mo: string, d: string, h: number, mi: string) => new Date(+y, +mo - 1, +d, h, +mi).getTime();

/** "이름 : 내용" 이면 메시지, 아니면 시스템 줄 */
function splitSender(rest: string): { sender: string; text: string } | null {
  const k = rest.indexOf(' : ');
  if (k <= 0) return null;
  return { sender: rest.slice(0, k), text: rest.slice(k + 3) };
}

/** 시스템 줄 뜻 풀기: 초대·나감·내보냄·들어옴 */
export function parseSystem(text: string): Msg['sys'] {
  const s = text.trim();
  let m = s.match(/^(.+?)님이 (.+?)님을 초대(?:했습니다|하였습니다)\.?$/);
  if (m) return { type: 'invite', actor: m[1], targets: splitNames(m[2]) };
  m = s.match(/^(.+?)님이 (.+?)님을 내보냈습니다\.?$/);
  if (m) return { type: 'kick', actor: m[1], targets: [m[2]] };
  m = s.match(/^(.+?)님이 나갔습니다\.?$/);
  if (m) return { type: 'leave', targets: [m[1]] };
  m = s.match(/^(.+?)님이 들어왔습니다\.?(?:.*)$/);
  if (m) return { type: 'join', targets: [m[1]] };
  return { type: 'other', targets: [] };
}
/** "김철수님, 이영희님과 박민수" → 이름들 */
function splitNames(s: string) {
  return s.split(/님?,\s*|님과\s+|님\s*및\s+|님 그리고\s+/).map((x) => x.replace(/님$/, '').trim()).filter(Boolean);
}

function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function detectFormat(lines: string[]): Format {
  const head = lines.slice(0, 200);
  if (/^Date,User,Message/i.test(head[0] ?? '')) return 'mac-csv';
  const count = (re: RegExp) => head.filter((l) => re.test(l)).length;
  const scores: [Format, number][] = [['android', count(RE_KO)], ['ios', count(RE_DOT)], ['pc', count(RE_PC_MSG) + count(RE_PC_DATE)], ['mac-csv', count(RE_CSV)]];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : 'unknown';
}

export function parseChat(raw: string): Chat {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const format = detectFormat(lines);
  const messages: Msg[] = [];
  let title = '';
  let unparsed = 0;
  let day: [string, string, string] | null = null;
  let lastT = 0;

  const first = lines[0]?.trim() ?? '';
  const tm = first.match(/^(.+?) (?:님과 )?카카오톡 대화(?:방)?$/) ?? first.match(/^(.+?) 님과 카카오톡 대화$/);
  if (tm) title = tm[1].replace(/ 님과$/, '');

  const push = (t: number, rest: string, line: number) => {
    lastT = t;
    const sp = splitSender(rest);
    if (sp) messages.push({ i: messages.length, t, sender: sp.sender, text: sp.text, kind: 'msg', line });
    else messages.push({ i: messages.length, t, sender: '', text: rest, kind: 'system', sys: parseSystem(rest), line });
  };
  const append = (l: string) => {
    const last = messages[messages.length - 1];
    if (last && last.kind === 'msg') last.text += '\n' + l;
    else if (l.trim()) unparsed++;
  };

  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    const lineNo = n + 1;
    if (n === 0 && tm) continue;
    if (/^저장한 날짜\s*:/.test(l)) continue;
    let m: RegExpMatchArray | null;
    if (format === 'mac-csv') {
      if (n === 0) continue;
      if ((m = l.match(RE_CSV))) {
        const cells = csvCells(l);
        const t = at(m[1], m[2], m[3], +m[4], m[5]) + (m[6] ? +m[6] * 1000 : 0);
        const [, user = '', msg = ''] = cells;
        if (user) { lastT = t; messages.push({ i: messages.length, t, sender: user, text: msg, kind: 'msg', line: lineNo }); }
        else push(t, msg, lineNo);
      } else append(l.replace(/"$/, ''));
      continue;
    }
    if ((m = l.match(RE_KO)) || (m = l.match(RE_DOT))) {
      push(at(m[1], m[2], m[3], hour24(+m[5], m[4]), m[6]), m[7], lineNo);
      continue;
    }
    if ((m = l.match(RE_PC_DATE))) { day = [m[1], m[2], m[3]]; continue; }
    if ((m = l.match(RE_DATE_ONLY))) { day = [m[1], m[2], m[3]]; continue; }
    if (format === 'pc' && (m = l.match(RE_PC_MSG))) {
      const d = day ?? ['1970', '1', '1'];
      lastT = at(d[0], d[1], d[2], hour24(+m[3], m[2]), m[4]);
      messages.push({ i: messages.length, t: lastT, sender: m[1], text: m[5], kind: 'msg', line: lineNo });
      continue;
    }
    // PC의 시스템 줄에는 시각이 없다: 바로 앞 메시지 시각을 쓴다
    if (format === 'pc' && /님이 .*(초대했습니다|나갔습니다|내보냈습니다|들어왔습니다)\.?$/.test(l.trim())) {
      messages.push({ i: messages.length, t: lastT, sender: '', text: l.trim(), kind: 'system', sys: parseSystem(l), line: lineNo });
      continue;
    }
    append(l);
  }
  // 끝의 빈 줄이 붙은 것 정리
  for (const m of messages) m.text = m.text.replace(/\n+$/, '');
  return { title, format, messages, unparsed };
}

/** 참여자: 말한 수가 많은 순 */
export function participants(chat: Chat): { name: string; count: number }[] {
  const c = new Map<string, number>();
  for (const m of chat.messages) if (m.kind === 'msg') c.set(m.sender, (c.get(m.sender) ?? 0) + 1);
  for (const m of chat.messages) for (const t of m.sys?.targets ?? []) if (!c.has(t)) c.set(t, 0);
  return [...c].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
