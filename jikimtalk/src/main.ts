import './style.css';
import { parseChat, participants, type Chat } from './core/parse';
import { analyze, CATEGORY, EVENT, tally, context, type Analysis, type Flag, type Category } from './core/detect';
import { makeScorer, type ModelData } from './core/model';
import { textReport, sha256, fmtTime, line, whyFlag, whyToMe, pad2, type Source } from './core/report';

/** 클로드 아티팩트로 열 때는 인쇄·파일 저장이 막혀 있다. 그땐 복사만 보여 준다. */
const EMBEDDED = import.meta.env.MODE === 'artifact';

type Child = Node | string | null | undefined | false | Child[];
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = v as string;
    else if (typeof v === 'boolean') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  const add = (c: Child) => { if (Array.isArray(c)) c.forEach(add); else if (c != null && c !== false) el.append(c); };
  kids.forEach(add);
  return el;
}
const $app = document.getElementById('app')!;
const hm = (t: number) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const dayLabel = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };

function toast(msg: string) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ───────── 상태 ─────────
interface State {
  chat: Chat;
  src: Source;
  sample: boolean;
  me?: string;
  aliases: string[];
  a?: Analysis;
  picked: Set<number>; // 고른 메시지 번호
  onlyMe: boolean;
}
let S: State | null = null;
let model: ModelData | null = null;
const modelReady = fetch('./model.json').then((r) => r.json()).then((m) => (model = m)).catch(() => null);

// ───────── 처음 ─────────
function start() {
  const input = h('input', { type: 'file', id: 'file', accept: '.txt,.csv,text/plain,text/csv', class: 'sr' });
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) load(f); input.value = ''; });
  const drop = h('label', { class: 'drop', for: 'file' },
    h('span', { class: 'drop-title' }, '대화 파일 넣기'),
    h('span', { class: 'drop-sub' }, '카톡에서 내보낸 .txt 또는 .csv'));
  for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) load(f); });

  const how = h('div', { class: 'how' });
  const tabs: [string, string[]][] = [
    ['안드로이드', ['단톡방 오른쪽 위 ☰', '아래 ⚙ 설정', '대화 내용 내보내기', '텍스트만 보내기 → 내 폰에 저장']],
    ['아이폰', ['단톡방 오른쪽 위 ☰', '아래 ⚙ 설정', '대화 내용 내보내기', '텍스트만 보내기 → "파일에 저장"']],
    ['PC', ['단톡방 오른쪽 위 ≡', '대화 내용 → 대화 내보내기', '.txt로 저장']],
  ];
  const panel = h('ol', { class: 'steps' });
  const tabRow = h('div', { class: 'tabs', role: 'tablist' });
  const show = (k: number) => {
    tabRow.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === k)));
    panel.replaceChildren(...tabs[k][1].map((s) => h('li', {}, s)));
  };
  tabs.forEach(([name], k) => tabRow.append(h('button', { role: 'tab', type: 'button', onclick: () => show(k) }, name)));
  how.append(h('p', { class: 'label' }, '카톡에서 대화 내보내기'), tabRow, panel);
  show(/iPhone|iPad/.test(navigator.userAgent) ? 1 : /Android/.test(navigator.userAgent) ? 0 : 2);

  $app.replaceChildren(
    h('header', { class: 'masthead' },
      h('p', { class: 'brand' }, '지킴톡'),
      h('h1', {}, '단톡방에서 당한 일,', h('br'), '신고할 수 있게 정리해요.'),
      h('p', { class: 'lede' }, '카톡 대화를 내보내서 넣으면 욕설·협박·따돌림·카톡감옥·방폭을 찾아 시간순 기록으로 만들어요. 대화는 이 기기 밖으로 나가지 않아요.')),
    h('section', { class: 'start' }, input, drop,
      h('button', { class: 'ghost wide', type: 'button', 'data-testid': 'sample', onclick: loadSample }, '예시 대화로 먼저 보기')),
    how,
    h('section', { class: 'promise' },
      h('div', {}, h('b', {}, '원문 그대로'), h('span', {}, '글자 하나 고치지 않고, 앞뒤 대화까지 넣어요.')),
      h('div', {}, h('b', {}, '고르는 건 나'), h('span', {}, '앱은 찾기만 해요. 기록에 넣을 말은 내가 골라요.')),
      h('div', {}, h('b', {}, '파일 지문'), h('span', {}, '원본 파일의 SHA-256을 적어 바뀌지 않았음을 보여요.'))),
    helpBox());
}

function helpBox(strong = false) {
  const row = (num: string, what: string) => h('div', { class: 'help-row' }, h('span', {}, what),
    h('button', { class: 'num', type: 'button', 'aria-label': `${num} 복사`, onclick: () => copy(num.replace(/\s.*/, ''), `${num} 복사했어요`) }, num));
  return h('aside', { class: `help${strong ? ' strong' : ''}` },
    h('p', { class: 'label' }, strong ? '혼자 견디지 않아도 돼요' : '지금 도움이 필요하면'),
    row('117', '학교폭력 신고·상담 (24시간, 문자 #0117)'),
    row('1388', '청소년 상담 (24시간, 문자 #1388)'),
    row('112', '위험할 때'));
}

async function copy(text: string, ok: string) {
  try { await navigator.clipboard.writeText(text); toast(ok); }
  catch { toast('복사가 막혀 있어요. 길게 눌러 직접 복사해 주세요.'); }
}

// ───────── 파일 읽기 ─────────
function decode(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 5) { try { return new TextDecoder('euc-kr').decode(buf); } catch { /* 그대로 */ } }
  return utf8;
}

async function load(file: File) {
  const buf = await file.arrayBuffer();
  const text = decode(buf);
  const chat = parseChat(text);
  if (chat.format === 'unknown' || chat.messages.length === 0) {
    toast('카톡 대화 파일로 읽지 못했어요. "텍스트만 보내기"로 내보낸 파일인지 확인해 주세요.');
    return;
  }
  S = { chat, sample: false, aliases: [], picked: new Set(), onlyMe: true,
    src: { name: file.name, bytes: buf.byteLength, sha256: await sha256(buf), lines: text.split('\n').length } };
  pickMe();
}

async function loadSample() {
  const text = await (await fetch('./samples/example-android.txt')).text();
  const buf = new TextEncoder().encode(text).buffer as ArrayBuffer;
  S = { chat: parseChat(text), sample: true, aliases: [], picked: new Set(), onlyMe: true,
    src: { name: '예시_2학년3반단톡.txt', bytes: buf.byteLength, sha256: await sha256(buf), lines: text.split('\n').length } };
  pickMe('김민지');
}

// ───────── 나 고르기 ─────────
function pickMe(preset?: string) {
  const st = S!;
  const people = participants(st.chat);
  let me = preset ?? st.me ?? '';
  const list = h('div', { class: 'people', role: 'radiogroup', 'aria-label': '나' });
  const next = h('button', { class: 'primary wide', type: 'button', 'data-testid': 'analyze', disabled: !me }, '정리하기');
  const render = () => {
    list.replaceChildren(...people.map((p) => h('button', { type: 'button', role: 'radio', class: 'person', 'aria-checked': String(p.name === me),
      onclick: () => { me = p.name; next.disabled = false; render(); } },
    h('span', { class: 'pname' }, p.name), h('span', { class: 'pcount' }, p.count ? `${p.count}마디` : '말 없음'))));
  };
  render();
  const alias = h('input', { id: 'alias', type: 'text', placeholder: '예: 민지, 킴민, 뚱민', value: st.aliases.join(', ') });
  next.addEventListener('click', async () => {
    st.me = me;
    st.aliases = alias.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    await modelReady;
    const scorer = model ? makeScorer(model) : undefined;
    st.a = analyze(st.chat, { me, aliases: st.aliases, score: scorer, threshold: model?.threshold });
    // 기본으로 고르기: 나를 향한 말 중 규칙에 걸린 것(모델만 걸린 '공격적인 말'은 직접 고른다)
    st.picked = new Set(st.a.flags.filter((f) => f.toMe && f.level >= 2).map((f) => f.msg.i));
    review();
  });
  const msgs = st.chat.messages;
  $app.replaceChildren(
    bar('누가 나예요?', start),
    h('section', { class: 'file-card' },
      st.sample ? h('p', { class: 'tag sample' }, '예시 대화 — 지어낸 이름이에요') : null,
      h('p', { class: 'fname' }, st.chat.title || st.src.name),
      h('p', { class: 'meta' }, `${fmtTime(msgs[0].t)} ~ ${fmtTime(msgs[msgs.length - 1].t)} · ${msgs.length.toLocaleString('ko-KR')}줄 · ${people.length}명`),
      st.chat.unparsed ? h('p', { class: 'meta warn' }, `읽지 못한 줄 ${st.chat.unparsed}개`) : null),
    h('p', { class: 'label' }, '이 대화방에서 나를 골라 주세요'),
    list,
    h('label', { class: 'label', for: 'alias' }, '나를 부르는 별명이 있으면 (쉼표로)'),
    alias,
    h('div', { class: 'dock' }, next));
}

function bar(title: string, back: () => void, right?: Child) {
  return h('div', { class: 'bar' }, h('button', { class: 'back', type: 'button', 'aria-label': '뒤로', onclick: back }, '←'), h('h2', {}, title), right ?? h('span'));
}

// ───────── 검토 ─────────
function review() {
  const st = S!;
  const a = st.a!;
  const listEl = h('div', { class: 'feed' });
  const countEl = h('span', { class: 'count' });
  const lvlName = { 3: '심각', 2: '주의', 1: '확인' } as const;

  const render = () => {
    const shown = a.flags.filter((f) => !st.onlyMe || f.toMe);
    countEl.textContent = `${st.picked.size}건 고름`;
    listEl.replaceChildren();
    let day = '';
    for (const f of shown) {
      const d = dayLabel(f.msg.t);
      if (d !== day) { day = d; listEl.append(h('p', { class: 'day' }, d)); }
      listEl.append(item(f));
    }
    if (!shown.length) listEl.append(h('p', { class: 'empty' }, st.onlyMe ? '나를 향한 말로 보이는 것이 없어요. "모든 표시"로 바꿔 보세요.' : '표시된 말이 없어요.'));
  };

  const item = (f: Flag) => {
    const on = st.picked.has(f.msg.i);
    const ctx = h('div', { class: 'ctx', hidden: true }, ...context(st.chat, f.msg).map((m) => h('p', { class: m.i === f.msg.i ? 'me-line' : '' }, line(m))));
    const box = h('input', { type: 'checkbox', id: `pick-${f.msg.i}`, checked: on, 'aria-label': '기록에 넣기' });
    box.addEventListener('change', () => { box.checked ? st.picked.add(f.msg.i) : st.picked.delete(f.msg.i); art.classList.toggle('off', !box.checked); countEl.textContent = `${st.picked.size}건 고름`; });
    const art = h('article', { class: `flag l${f.level}${on ? '' : ' off'}`, 'data-testid': 'flag' },
      h('div', { class: 'flag-head' },
        h('span', { class: `sev l${f.level}` }, lvlName[f.level]),
        h('b', { class: 'who' }, f.msg.sender),
        h('time', {}, hm(f.msg.t)),
        h('label', { class: 'pick', for: `pick-${f.msg.i}` }, box, h('span', {}, '기록에 넣기'))),
      h('p', { class: 'said' }, f.msg.text),
      h('div', { class: 'chips' }, ...f.cats.map((c) => h('span', { class: 'chip' }, CATEGORY[c].label)),
        h('span', { class: 'why' }, `${whyFlag(f)} · ${whyToMe(f)}`)),
      h('button', { class: 'link', type: 'button', onclick: (e: Event) => { ctx.hidden = !ctx.hidden; (e.target as HTMLElement).textContent = ctx.hidden ? '앞뒤 대화 보기' : '앞뒤 대화 접기'; } }, '앞뒤 대화 보기'),
      ctx);
    return art;
  };

  const people = tally(a.flags.filter((f) => f.toMe));
  const toggle = h('div', { class: 'seg', role: 'tablist' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.onlyMe), onclick: () => { st.onlyMe = true; review(); } }, `나를 향한 말 ${a.flags.filter((f) => f.toMe).length}`),
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(!st.onlyMe), onclick: () => { st.onlyMe = false; review(); } }, `모든 표시 ${a.flags.length}`));

  $app.replaceChildren(...[
    bar('찾은 것', () => pickMe(), countEl),
    a.selfRisk.length ? h('div', { class: 'care' },
      h('p', {}, h('b', {}, '많이 힘들었겠어요. '), '네 잘못이 아니에요. 지금 이야기할 사람이 필요하면 아래 번호로 연락해요. 문자도 돼요.'),
      helpBox(true)) : null,
    st.sample ? h('p', { class: 'tag sample' }, '예시 대화 — 지어낸 이름이에요') : null,
    h('section', { class: 'overview' },
      h('div', { class: 'stat' }, h('b', {}, String(a.flags.filter((f) => f.toMe && f.level === 3).length)), h('span', {}, '심각')),
      h('div', { class: 'stat' }, h('b', {}, String(a.flags.filter((f) => f.toMe && f.level === 2).length)), h('span', {}, '주의')),
      h('div', { class: 'stat' }, h('b', {}, String(a.events.length)), h('span', {}, '사건')),
      h('div', { class: 'stat' }, h('b', {}, String(people.length)), h('span', {}, '관련된 사람'))),
    a.events.length ? h('section', { class: 'events' }, h('p', { class: 'label' }, '방에서 일어난 일'),
      ...a.events.map((e) => h('div', { class: `event e-${e.type}` },
        h('span', { class: 'ename' }, EVENT[e.type].label),
        h('span', { class: 'etime' }, fmtTime(e.t)),
        h('span', { class: 'edetail' }, `${e.detail}${e.people.length ? ` · ${e.people.join(', ')}` : ''}`)))) : null,
    people.length ? h('section', { class: 'who-table' }, h('p', { class: 'label' }, '사람별 (나를 향한 말)'),
      h('div', { class: 'table-wrap' }, peopleTable(people))) : null,
    toggle,
    h('p', { class: 'hint' }, '앱은 말의 모양만 보고 표시해요. 장난이었거나 나를 향한 말이 아니면 체크를 풀어 주세요.'),
    listEl,
    h('div', { class: 'dock' }, h('button', { class: 'primary wide', type: 'button', 'data-testid': 'to-report', onclick: () => {
      if (!st.picked.size) { toast('기록에 넣을 말을 하나 이상 골라 주세요'); return; }
      report();
    } }, '기록 만들기'))].filter((x): x is HTMLElement => !!x));
  render();
}

function peopleTable(rows: ReturnType<typeof tally>) {
  const cats = (Object.keys(CATEGORY) as Category[]).filter((c) => rows.some((r) => r.row.get(c)));
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, '이름'), ...cats.map((c) => h('th', {}, CATEGORY[c].label)), h('th', {}, '합계'))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, h('th', {}, r.name), ...cats.map((c) => h('td', {}, r.row.get(c) ? String(r.row.get(c)) : '·')), h('td', { class: 'sum' }, String(r.total))))));
}

// ───────── 기록(보고서) ─────────
function report() {
  const st = S!;
  const a = st.a!;
  const picked = a.flags.filter((f) => st.picked.has(f.msg.i));
  const text = textReport(st.chat, a, picked, st.me!, st.src);
  const pre = h('pre', { class: 'doc', 'data-testid': 'report', tabindex: '0' }, text);
  const actions = h('div', { class: 'dock actions' },
    h('button', { class: 'primary', type: 'button', onclick: () => copy(text, '기록을 복사했어요. 메모·문자·메일에 붙여 넣으세요.') }, '글 복사'),
    EMBEDDED ? null : h('button', { class: 'ghost', type: 'button', onclick: () => {
      const a2 = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: `괴롭힘기록_${new Date().toISOString().slice(0, 10)}.txt` });
      document.body.append(a2); a2.click(); a2.remove();
    } }, '파일로 저장'),
    EMBEDDED ? null : h('button', { class: 'ghost', type: 'button', onclick: () => window.print() }, '인쇄·PDF'));
  $app.replaceChildren(...[
    bar('기록', review),
    st.sample ? h('p', { class: 'tag sample' }, '예시 대화 — 지어낸 이름이에요') : null,
    h('section', { class: 'next' },
      h('p', { class: 'label' }, '이제 이렇게 해요'),
      h('ol', {},
        h('li', {}, h('b', {}, '원본 파일을 지우지 마세요. '), '이 기록과 함께 내요. 기록 맨 위 SHA-256으로 같은 파일인지 확인할 수 있어요.'),
        h('li', {}, h('b', {}, '믿을 수 있는 어른에게 보여 주세요. '), '담임·학교폭력 담당 선생님·부모님, 또는 117.'),
        h('li', {}, h('b', {}, '대화방 화면도 캡처해 두세요. '), '방 이름·참여자 목록이 보이게.'))),
    pre,
    helpBox(),
    actions].filter((x): x is HTMLElement => !!x));
}

start();
