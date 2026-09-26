import type { Chat, Msg } from './parse';
import { CATEGORY, EVENT, tally, type Analysis, type Flag } from './detect';

/** 원본 파일 정보: 보고서가 원본과 같은 파일에서 나왔음을 맞춰 볼 수 있게 */
export interface Source { name: string; bytes: number; sha256: string; lines: number }

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const fmtTime = (t: number) => { const d = new Date(t); return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const WHY: Record<Exclude<Flag['toMe'], false>, string> = { name: '내 이름을 부름', you: '"너·니"로 부름', reply: '내 말 뒤 3분 안', thread: '나를 부른 공격 뒤 3분 안' };
export const whyToMe = (f: Flag) => (f.toMe ? WHY[f.toMe] : '누구에게 한 말인지 모름');
export const whyFlag = (f: Flag) => (f.hits.length ? f.hits.map((h) => `"${h}"`).join(', ') : `공격성 점수 ${Math.round(f.score * 100)}점`);

/**
 * 신고용 글 보고서. 학교·117에 낼 때 그대로 붙여 쓰거나 인쇄한다.
 * 판단하는 말("가해자", "학폭이다")은 쓰지 않는다. 무엇이 언제 누구에게서 왔는지만 적는다.
 */
export function textReport(chat: Chat, a: Analysis, picked: Flag[], me: string, src: Source, now = Date.now()): string {
  const msgs = chat.messages;
  const first = msgs[0]?.t, last = msgs[msgs.length - 1]?.t;
  const L: string[] = [];
  L.push('단톡방 괴롭힘 기록');
  L.push('='.repeat(20));
  L.push(`만든 날: ${fmtTime(now)} (지킴톡, 기기 안에서 정리)`);
  L.push(`대화방: ${chat.title || '(이름 없음)'}`);
  L.push(`기록한 사람: ${me}`);
  if (first && last) L.push(`대화 기간: ${fmtTime(first)} ~ ${fmtTime(last)}`);
  L.push('');
  L.push('[원본 파일]');
  L.push(`파일 이름: ${src.name}`);
  L.push(`크기: ${src.bytes.toLocaleString('ko-KR')}바이트, ${src.lines.toLocaleString('ko-KR')}줄`);
  L.push(`SHA-256: ${src.sha256}`);
  L.push('※ 원본 파일을 함께 내세요. 같은 파일이면 위 SHA-256 값이 똑같이 나옵니다(파일이 바뀌지 않았다는 확인).');
  L.push('');
  L.push('[요약]');
  L.push(`고른 기록 ${picked.length}건, 관련된 사람 ${new Set(picked.map((f) => f.msg.sender)).size}명`);
  for (const row of tally(picked)) {
    L.push(`- ${row.name}: ${row.total}건 (${[...row.row].map(([c, n]) => `${CATEGORY[c].label} ${n}`).join(', ')})`);
  }
  if (a.events.length) {
    L.push('');
    L.push('[방에서 일어난 일]');
    for (const e of a.events) L.push(`- ${fmtTime(e.t)} ${EVENT[e.type].label}: ${e.detail}${e.people.length ? ` (${e.people.join(', ')})` : ''}`);
  }
  L.push('');
  L.push('[기록] 원문 그대로. 앞뒤 대화 2줄씩, 표시한 말은 ▶');
  const sorted = [...picked].sort((x, y) => x.msg.i - y.msg.i);
  let lastEnd = -1;
  sorted.forEach((f, k) => {
    const from = Math.max(0, f.msg.i - 2, lastEnd + 1);
    const to = Math.min(msgs.length - 1, f.msg.i + 2);
    L.push('');
    L.push(`${k + 1}. ${fmtTime(f.msg.t)} ${f.msg.sender} — ${f.cats.map((c) => CATEGORY[c].label).join(', ')} / ${whyToMe(f)} / 원본 ${f.msg.line}번째 줄`);
    for (let i = from; i <= to; i++) {
      const m = msgs[i];
      const mark = sorted.some((s) => s.msg.i === i) ? '▶' : ' ';
      L.push(`  ${mark} ${line(m)}`);
    }
    lastEnd = to;
  });
  L.push('');
  L.push('[읽는 분께]');
  L.push('이 기록은 카카오톡 "대화 내보내기" 파일을 프로그램이 정리한 것입니다. 표시는 말의 모양(욕설·협박 표현 등)을 보고 붙였고,');
  L.push('어떤 말을 기록에 넣을지는 기록한 사람이 골랐습니다. 판단이 아니라 정리이며, 원문은 고치지 않았습니다.');
  return L.join('\n') + '\n';
}

export function line(m: Msg) {
  const hm = (() => { const d = new Date(m.t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; })();
  return m.kind === 'system' ? `[${hm}] (${m.text})` : `[${hm}] ${m.sender}: ${m.text.replace(/\n/g, '\n      ')}`;
}

/** 파일 지문. 브라우저·노드 모두 crypto.subtle */
export async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
