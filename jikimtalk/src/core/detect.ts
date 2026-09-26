import type { Chat, Msg } from './parse';
import { normalize } from './normalize';

/**
 * 괴롭힘으로 보이는 말·일을 찾는다. **찾기만 한다 — 판단은 사람이 한다.**
 * 보고서에는 원문과 앞뒤 대화가 그대로 들어가고, 표시마다 "왜 표시했는지"가 붙는다.
 */

export type Category = 'selfharm' | 'threat' | 'money' | 'sexual' | 'exposure' | 'exclude' | 'looks' | 'curse' | 'hostile';
export type Level = 3 | 2 | 1;

export const CATEGORY: Record<Category, { label: string; level: Level; hint: string }> = {
  selfharm: { label: '죽으라는 말', level: 3, hint: '자해·자살을 부추기는 말' },
  threat: { label: '협박', level: 3, hint: '때리거나 해치겠다는 말' },
  money: { label: '돈·물건 요구', level: 3, hint: '돈, 기프티콘, 데이터, 심부름을 시키는 말' },
  sexual: { label: '성적인 말', level: 3, hint: '몸·성에 대한 말' },
  exposure: { label: '사진·신상 퍼뜨리기', level: 3, hint: '사진·번호·주소를 퍼뜨리겠다는 말' },
  exclude: { label: '따돌림', level: 2, hint: '빼고, 꺼져, 나가 같은 따돌리는 말' },
  looks: { label: '외모 놀림', level: 2, hint: '외모·몸을 깎아내리는 말' },
  curse: { label: '욕설', level: 2, hint: '욕' },
  hostile: { label: '공격적인 말', level: 1, hint: '규칙엔 없지만 모델이 공격적이라고 본 말' },
};

/**
 * 규칙. 다듬은 말(normalize: 소문자·반복 줄임·한글 사이 기호 뺌)에 맞춘다.
 * 흔한 오탐을 막는 예외를 같이 둔다(예: '보지 마'의 '보지', '걸레질'의 '걸레').
 */
const RULES: { cat: Category; re: RegExp; not?: RegExp }[] = [
  { cat: 'selfharm', re: /(죽어\s?버려|죽어라|자살\s?(해|하라|좀)|뛰어\s?내려|목\s?매|없어져\s?(버려|라)|태어나지\s?말|살\s?가치|왜\s?사냐|죽지\s?왜|디져라|뒤져라|뒤지라고)/ },
  { cat: 'threat', re: /(죽여|죽인다|죽일|죽을래|죽고\s?싶냐|패\s?버|패줄|팰까|때린다|때릴|맞을래|맞고\s?싶|찾아\s?간다|찾아\s?갈|가만\s?안\s?(둬|둔|둘)|각오\s?해|두고\s?보자|끝나고\s?(보자|남아|따라와)|학교\s?에서\s?보자|밤길\s?조심|묻어\s?버|칼\s?(들고|로)|뒤질래|뒤지고\s?싶|말하면\s?(죽|알지|어떻게)|신고하면\s?(죽|알지|어떻게)|이르면\s?(죽|알지)|안\s?(가져오면|보내면|하면|주면)\s?(알지|죽|맞)|어떻게\s?되는지\s?알지)/ },
  { cat: 'money', re: /(돈\s?(가져|내놔|보내|줘|빌려|갚아)|기프티콘|깊티|셔틀|핫스팟|데이터\s?(좀|줘|켜|내놔|보내)|계좌\s?(보내|불러)|입금\s?해|사\s?와|사\s?오라고|빵\s?사|만\s?원만|오천\s?원만|천\s?원만)/, not: /(사와서|사왔어|사와야지)/ },
  { cat: 'sexual', re: /(가슴\s?(크|작|만져|보여)|몸매|섹스|섹시|야동|벗어|벗겨|몸\s?사진|알몸|따먹|창녀|걸레|성희롱|만져\s?봐|엉덩이)/, not: /걸레질|걸레\s?(빨|로\s?닦)/ },
  { cat: 'exposure', re: /((사진|영상|동영상|번호|주소|카톡|얼굴|신상).{0,6}(뿌린|뿌릴|뿌려|퍼뜨|퍼트|유포|올린다|올릴|박제)|(단톡|반톡|인스타|페북|전교|sns|스토리|학교).{0,4}(뿌린|뿌릴|뿌려|퍼뜨|올린다|올릴게|올려버)|박제|신상\s?(털|턴))/ },
  { cat: 'exclude', re: /(너\s?(빼고|말고\s?다)|니\s?빼고|꺼져|꺼지라|(좀|빨리|제발|그냥)\s?나가|나가라|나가\s?줄래|왜\s?안\s?나가|왕따|은따|투명\s?인간|아무도\s?(너|널|니|네)|친구\s?없|끼지\s?마|오지\s?마|말\s?걸지\s?마|쟤랑\s?놀지|걔랑\s?놀지|강퇴|차단\s?해|없는\s?사람\s?취급|낄끼빠빠)/ },
  { cat: 'looks', re: /(돼지|뚱뚱|뚱땡|뚱녀|뚱남|뚱보|못생|오크|여드름|얼굴\s?(테러|꼴|상태|왜\s?그래)|냄새\s?(나|난|쩔)|더러운|더러워|거지\s?(같|꼴)|키\s?작|난쟁이|멸치|대머리|존못|개못생|얼평)/ },
  { cat: 'curse', re: /(시발|씨발|씨빨|시빨|ㅅㅂ|ㅆㅂ|ㅅ발|씹|좆|개새|개색|개세|새끼|ㅅㄲ|병신|븅신|빙신|ㅂㅅ|미친\s?(놈|년|새|것)|ㅁㅊ|지랄|ㅈㄹ|닥쳐|ㄷㅊ|엠창|느금|니애미|니\s?엄마|니미|애미|애비|등신|찐따|쓰레기|한심|역겨|토\s?나와|꼴\s?보기\s?싫|재수\s?없|관종|급식충|[가-힣]충이|좆밥|호구|노답)/, not: /(씹어|씹는|씹고|씹을|씹었|새끼\s?(고양이|강아지|손가락)|분리수거|쓰레기\s?(통|봉투|버리|장|분리))/ },
];

/** 나를 가리키는 말: 2인칭 */
const YOU = /(^|[^가-힣])(너|니|넌|널|네가|니가|너는|니는|너도|니도|너네|느그|너희|니네|너만|너랑|니랑|너한테|니한테|너를|니를|너의|니꺼|너꺼|너같은|니같은|너따위|니따위|넌데)(?=[^가-힣]|$)/;

export interface Flag {
  msg: Msg;
  cats: Category[];
  level: Level;
  /** 규칙에 걸린 말(원문 그대로가 아니라 다듬은 말에서) */
  hits: string[];
  /** 모델 점수 0~1 */
  score: number;
  /** 나를 향한 말로 보이나, 그 까닭 */
  toMe: false | 'name' | 'you' | 'reply' | 'thread';
}

export type EventType = 'prison' | 'roomBomb' | 'gang' | 'kicked';
export const EVENT: Record<EventType, { label: string; hint: string }> = {
  prison: { label: '카톡감옥', hint: '나간 뒤 다시 초대됨' },
  roomBomb: { label: '방폭', hint: '내가 들어오거나 말하자 여럿이 한꺼번에 나감' },
  gang: { label: '떼카', hint: '짧은 시간에 여러 명이 나를 향해 공격적인 말' },
  kicked: { label: '강퇴', hint: '방에서 내보내짐' },
};
export interface ChatEvent { type: EventType; t: number; msgs: Msg[]; people: string[]; detail: string }

export interface Analysis {
  flags: Flag[];
  events: ChatEvent[];
  /** 내가 쓴 말 중 위험 신호(보고서엔 안 넣고, 도움 연락처를 먼저 보여 준다) */
  selfRisk: Msg[];
}

export interface Options {
  me: string;
  /** 별명 등 나를 부르는 말 */
  aliases?: string[];
  score?: (text: string) => number;
  threshold?: number;
}

const MIN = 60_000;

export function ruleHits(text: string): { cat: Category; hit: string }[] {
  const t = normalize(text);
  const out: { cat: Category; hit: string }[] = [];
  for (const r of RULES) {
    const m = t.match(r.re);
    if (!m) continue;
    if (r.not && r.not.test(t) && !t.replace(new RegExp(r.not.source, 'g'), ' ').match(r.re)) continue;
    out.push({ cat: r.cat, hit: m[0] });
  }
  return out;
}

const SELF_RISK = /(죽고\s?싶|죽을래\s?나|살기\s?싫|사라지고\s?싶|없어지고\s?싶|자해|손목|학교\s?가기\s?싫어\s?죽|다\s?끝내고\s?싶|뛰어내리고\s?싶)/;

export function analyze(chat: Chat, opt: Options): Analysis {
  const me = opt.me;
  const names = [me, ...(opt.aliases ?? [])].map((s) => s.trim()).filter((s) => s.length >= 1);
  // 이름은 성을 뗀 부르는 이름도 찾는다(김민지 → 민지)
  const callNames = new Set(names.flatMap((n) => (/^[가-힣]{3}$/.test(n) ? [n, n.slice(1)] : [n])).map((n) => normalize(n)));
  const score = opt.score ?? (() => 0);
  const threshold = opt.threshold ?? 0.5;
  const msgs = chat.messages;

  const flags: Flag[] = [];
  const selfRisk: Msg[] = [];
  let lastMine = -Infinity;
  // 이름·'너'로 나를 부른 공격이 이어지는 중인가(3분 안에 다음 말이 오면 같은 흐름)
  let lastAimed = -Infinity;
  for (const m of msgs) {
    if (m.kind !== 'msg') continue;
    if (m.sender === me) {
      lastMine = m.t;
      if (SELF_RISK.test(normalize(m.text))) selfRisk.push(m);
      continue;
    }
    const hits = ruleHits(m.text);
    const s = score(m.text);
    if (!hits.length && s < threshold) continue;
    const nt = normalize(m.text);
    const toMe: Flag['toMe'] = [...callNames].some((n) => n && nt.includes(n)) ? 'name'
      : YOU.test(nt) ? 'you'
        : m.t - lastMine <= 3 * MIN ? 'reply'
          : m.t - lastAimed <= 3 * MIN ? 'thread' : false;
    if (toMe) lastAimed = m.t;
    const cats = hits.length ? [...new Set(hits.map((h) => h.cat))] : ['hostile' as Category];
    const level = Math.max(...cats.map((c) => CATEGORY[c].level)) as Level;
    flags.push({ msg: m, cats, level, hits: hits.map((h) => h.hit), score: s, toMe });
  }

  const events: ChatEvent[] = [];
  const sys = msgs.filter((m) => m.kind === 'system' && m.sys);
  const isMe = (n: string) => n === me || names.includes(n);

  // 카톡감옥: 내가 나가거나 강퇴된 뒤 다시 초대된 것. 두 번째부터 센다.
  let left = false;
  for (const m of sys) {
    const s = m.sys!;
    if ((s.type === 'leave' || s.type === 'kick') && s.targets.some(isMe)) left = true;
    if (s.type === 'kick' && s.targets.some(isMe)) events.push({ type: 'kicked', t: m.t, msgs: [m], people: s.actor ? [s.actor] : [], detail: `${s.actor ?? '누군가'}님이 나를 내보냄` });
    if (s.type === 'invite' && s.targets.some(isMe) && left) {
      events.push({ type: 'prison', t: m.t, msgs: [m], people: s.actor ? [s.actor] : [], detail: `나간 뒤 ${s.actor ?? '누군가'}님이 다시 초대` });
      left = false;
    }
  }

  // 방폭: 내가 들어오거나(초대) 말한 뒤 5분 안에 3명 이상이 나감
  const triggers = msgs.filter((m) => (m.kind === 'msg' && m.sender === me) || (m.sys && (m.sys.type === 'invite' || m.sys.type === 'join') && m.sys.targets.some(isMe)));
  let lastBomb = -Infinity;
  for (const tr of triggers) {
    if (tr.t < lastBomb) continue;
    const leaves = sys.filter((m) => m.sys!.type === 'leave' && m.i > tr.i && m.t - tr.t <= 5 * MIN && !m.sys!.targets.some(isMe));
    const people = [...new Set(leaves.flatMap((m) => m.sys!.targets))];
    if (people.length >= 3) {
      events.push({ type: 'roomBomb', t: tr.t, msgs: [tr, ...leaves], people, detail: `${people.length}명이 5분 안에 나감` });
      lastBomb = leaves[leaves.length - 1].t + 1;
    }
  }

  // 떼카: 10분 안에 3명 이상이 나를 향한 공격적인 말
  const mine = flags.filter((f) => f.toMe).sort((a, b) => a.msg.t - b.msg.t);
  let from = 0;
  let lastGang = -Infinity;
  for (let k = 0; k < mine.length; k++) {
    while (mine[k].msg.t - mine[from].msg.t > 10 * MIN) from++;
    const win = mine.slice(from, k + 1);
    const people = [...new Set(win.map((f) => f.msg.sender))];
    if (people.length >= 3 && win[0].msg.t > lastGang) {
      // 이 창을 끝까지 넓힌다
      let end = k;
      while (end + 1 < mine.length && mine[end + 1].msg.t - win[0].msg.t <= 10 * MIN) end++;
      const all = mine.slice(from, end + 1);
      const ps = [...new Set(all.map((f) => f.msg.sender))];
      events.push({ type: 'gang', t: all[0].msg.t, msgs: all.map((f) => f.msg), people: ps, detail: `${ps.length}명이 10분 동안 ${all.length}번` });
      lastGang = all[all.length - 1].msg.t;
      from = end + 1;
      k = end;
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { flags, events, selfRisk };
}

/** 사람 × 유형 표 */
export function tally(flags: Flag[]) {
  // total은 메시지 수(한 메시지가 여러 유형이어도 한 번), row는 유형별 수
  const people = new Map<string, { row: Map<Category, number>; total: number; worst: number }>();
  for (const f of flags) {
    const p = people.get(f.msg.sender) ?? { row: new Map(), total: 0, worst: 0 };
    for (const c of f.cats) p.row.set(c, (p.row.get(c) ?? 0) + 1);
    p.total++;
    p.worst = Math.max(p.worst, f.level);
    people.set(f.msg.sender, p);
  }
  return [...people].map(([name, p]) => ({ name, ...p })).sort((a, b) => b.total - a.total || b.worst - a.worst || a.name.localeCompare(b.name));
}

/** 앞뒤 대화: 잘라낸 것처럼 보이지 않게 표시된 말의 앞 n개·뒤 n개 */
export function context(chat: Chat, m: Msg, n = 2): Msg[] {
  return chat.messages.slice(Math.max(0, m.i - n), m.i + n + 1);
}
