import './style.css';
import type { Blank, OcrWord, Photo, Rect } from './core/types';
import { newSchedule, grade, dueQueue, DAY } from './core/schedule';
import { subjectAt, subjects, type Timetable } from './core/timetable';
import { suggestBlanks, iou } from './core/blanks';
import { assignGroups, summarize, toCsv, FINAL_AFTER } from './core/experiment';
import { reminderIcs } from './core/ics';
import { streak, learned, nextDue } from './core/stats';
import * as db from './db';
import { prepare } from './image';
import { findWords, warmUp } from './ocr';

// ───────────── 작은 도구 ─────────────

type Child = Node | string | null | undefined | false | Child[];
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = v as string;
    else if (k === 'style') el.setAttribute('style', v as string);
    else if (k in el && typeof v !== 'string') (el as never as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  const add = (c: Child) => { if (Array.isArray(c)) c.forEach(add); else if (c != null && c !== false) el.append(c); };
  kids.forEach(add);
  return el;
}
const $app = document.getElementById('app')!;
const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDate = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일(${DAYS[d.getDay()]})`; };
const fmtWhen = (t: number, now = Date.now()) => {
  const d = new Date(t), n = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / DAY);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return days === 0 ? `오늘 ${hm}` : days === 1 ? '내일' : `${days}일 뒤`;
};
const pct = (r: Rect) => `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;

const urls = new Map<string, string>();
async function imageUrl(id: string) {
  if (!urls.has(id)) { const b = await db.getImage(id); if (b) urls.set(id, URL.createObjectURL(b)); }
  return urls.get(id) ?? '';
}

function toast(msg: string) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

function download(name: string, text: string, type: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// ───────────── 화면 이동 ─────────────

const routes: [RegExp, (...m: string[]) => Promise<void> | void][] = [
  [/^#?\/?$/, home],
  [/^#\/edit\/(.+)$/, edit],
  [/^#\/photo\/(.+)$/, photoView],
  [/^#\/review$/, () => review('daily')],
  [/^#\/final$/, () => review('final')],
  [/^#\/timetable$/, timetable],
  [/^#\/experiment$/, experiment],
  [/^#\/about$/, about],
];
let leaving: (() => void) | null = null;
async function route() {
  leaving?.(); leaving = null;
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { window.scrollTo(0, 0); await fn(...m.slice(1)); return; }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);
const go = (hash: string) => { if (location.hash === hash) route(); else location.hash = hash; };

function screen(title: string | null, ...body: Child[]) {
  $app.replaceChildren(
    title === null ? '' : h('header', { class: 'bar' },
      h('button', { class: 'back', 'aria-label': '처음으로', onclick: () => go('#/') }, '‹'),
      h('h1', {}, title)),
    h('main', {}, ...body));
}

// ───────────── 찍기 ─────────────

function captureButtons() {
  const pick = (capture: boolean) => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: !capture, class: 'hidden', 'data-testid': capture ? 'camera-input' : 'album-input' });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => { if (input.files?.length) addPhotos([...input.files]); input.value = ''; });
    return input;
  };
  const cam = pick(true), album = pick(false);
  return h('div', { class: 'capture' },
    cam, album,
    h('button', { class: 'big primary', onclick: () => cam.click() }, h('span', { class: 'ico' }, '📷'), '판서 찍기'),
    h('button', { class: 'big ghost', onclick: () => album.click() }, h('span', { class: 'ico' }, '🖼️'), '앨범에서'));
}

/** 여러 장을 고르면 차례로 빈칸을 고른다. 사진은 먼저 저장해 둔다 — 도중에 닫아도 안 잃게. */
let editQueue: string[] = [];
async function addPhotos(files: File[]) {
  const tt = await db.getTimetable();
  const ids: string[] = [];
  const busy = h('div', { class: 'overlay' }, h('div', { class: 'spinner' }), h('p', {}, '사진 넣는 중…'));
  document.body.append(busy);
  try {
    for (const f of files) {
      const { blob, width, height } = await prepare(f);
      // 앨범에서 고른 사진은 파일 시각이 곧 찍은 시각이다(카메라로 바로 찍으면 지금)
      // (파일 시각이 미래이거나 너무 옛날이면 믿지 않는다)
      const takenAt = f.lastModified && f.lastModified <= Date.now() + 60_000 && Date.now() - f.lastModified < 400 * DAY ? f.lastModified : Date.now();
      const photo: Photo = { id: uid(), subject: subjectAt(tt, new Date(takenAt)) ?? '', takenAt, width, height };
      await db.savePhoto(photo, blob, []);
      ids.push(photo.id);
    }
  } catch (e) {
    toast('사진을 읽지 못했어요. 다른 사진으로 해 볼까요?');
    console.error(e);
  } finally { busy.remove(); }
  if (!ids.length) return;
  editQueue = ids.slice(1);
  go(`#/edit/${ids[0]}`);
}

// ───────────── 처음 화면 ─────────────

async function home() {
  const [photos, blanks, settings] = await Promise.all([db.allPhotos(), db.allBlanks(), db.getSettings()]);
  const now = Date.now();
  const due = dueQueue(blanks, now);
  const finals = photos.filter((p) => p.finalDue && p.finalDue <= now && blanks.some((b) => b.photoId === p.id && b.group && !b.final));
  const s = streak(blanks, now);
  const next = nextDue(blanks, now);

  const hero = due.length
    ? h('section', { class: 'hero due' },
      h('p', { class: 'eyebrow' }, '오늘 풀 빈칸'),
      h('p', { class: 'count', 'data-testid': 'due-count' }, String(due.length)),
      h('p', { class: 'sub' }, `약 ${Math.max(1, Math.round(due.length * 6 / 60))}분이면 끝나요`),
      h('button', { class: 'big primary', onclick: () => go('#/review') }, '▶ 풀기'))
    : h('section', { class: 'hero' },
      photos.length
        ? [h('p', { class: 'eyebrow' }, '오늘 복습 끝'), h('p', { class: 'count small', 'data-testid': 'due-count' }, '0'),
          h('p', { class: 'sub' }, next ? `다음 복습: ${fmtWhen(next.at, now)} · ${next.count}개` : '새 판서를 찍어 보세요')]
        : [h('p', { class: 'eyebrow' }, '찍기만 하면 안 남아요'),
          h('p', { class: 'lead' }, '판서를 찍으면 중요한 말이 ', h('mark', {}, '빈칸'), '이 돼요.', h('br'), '잊을 때쯤 다시 풀면 진짜 내 것이 돼요.'),
          h('ol', { class: 'how' }, h('li', {}, '📷 수업 끝에 판서를 찍고'), h('li', {}, '👆 가릴 말을 톡톡 확인하고'), h('li', {}, '🧠 저녁·3일·7일 뒤에 풀어요'))]);

  const finalCard = finals.length ? h('button', { class: 'card final', onclick: () => go('#/final') },
    h('b', {}, `🧪 7일 확인 ${finals.length}장`), h('span', {}, '도움 없이 한 번만 풀어요')) : null;

  // 과목별 사진
  const bySubject = new Map<string, Photo[]>();
  for (const p of photos.sort((a, b) => b.takenAt - a.takenAt)) {
    const k = p.subject || '과목 없음';
    bySubject.set(k, [...(bySubject.get(k) ?? []), p]);
  }
  const shelf = h('section', { class: 'shelf' });
  for (const [subj, ps] of bySubject) {
    const grid = h('div', { class: 'grid' });
    for (const p of ps) {
      const bs = blanks.filter((b) => b.photoId === p.id && b.group !== 'control');
      const img = h('img', { alt: `${subj} 판서 ${fmtDate(p.takenAt)}`, loading: 'lazy' });
      imageUrl(p.id).then((u) => (img.src = u));
      grid.append(h('button', { class: 'thumb', onclick: () => go(`#/photo/${p.id}`) }, img,
        h('span', { class: 'meta' }, fmtDate(p.takenAt), h('b', {}, bs.length ? `빈칸 ${bs.length}` : '빈칸 없음'))));
    }
    shelf.append(h('h2', {}, subj, h('small', {}, ` ${ps.length}장`)), grid);
  }

  screen(null,
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '찍', h('mark', {}, '풀')), h('span', { class: 'tag' }, '찍고, 풀고, 내 것으로')),
    hero,
    finalCard,
    captureButtons(),
    photos.length ? h('section', { class: 'stats' },
      h('div', {}, h('b', {}, `${s}일`), h('span', {}, '연속 복습')),
      h('div', {}, h('b', {}, String(learned(blanks))), h('span', {}, '외운 빈칸')),
      h('div', {}, h('b', {}, String(photos.length)), h('span', {}, '판서'))) : null,
    shelf,
    h('nav', { class: 'links' },
      h('a', { href: '#/timetable' }, '🗓️ 시간표'),
      h('a', { href: '#/experiment' }, settings.experiment ? '🧪 실험 중' : '🧪 실험'),
      h('a', { href: '#/about' }, '❔ 도움말')));
  warmUp();
}

// ───────────── 빈칸 고르기 ─────────────

interface Box { id?: string; rect: Rect; guess: string }

async function edit(photoId: string) {
  const photo = await db.getPhoto(photoId);
  if (!photo) return go('#/');
  const [tt, existing, settings] = await Promise.all([db.getTimetable(), db.blanksOf(photoId), db.getSettings()]);
  const boxes: Box[] = existing.map((b) => ({ id: b.id, rect: b.rect, guess: b.guess }));
  let words: OcrWord[] = photo.words ?? [];
  let subject = photo.subject;
  let alive = true;
  leaving = () => { alive = false; };

  const img = h('img', { alt: '판서 사진', draggable: false });
  img.src = await imageUrl(photoId);
  const layer = h('div', { class: 'layer' });
  const stage = h('div', { class: 'stage edit', style: `aspect-ratio:${photo.width}/${photo.height}` }, img, layer);
  const scroller = h('div', { class: 'scroller' }, stage);
  const status = h('p', { class: 'status', 'aria-live': 'polite' });
  const saveBtn = h('button', { class: 'big primary', 'data-testid': 'save' });
  let zoom = 1;
  const setZoom = (z: number) => { zoom = Math.max(1, Math.min(4, z)); stage.style.width = `${zoom * 100}%`; };

  const render = () => {
    layer.replaceChildren();
    // 찾은 낱말 중 아직 안 가린 것: 점선. 톡 누르면 가린다.
    for (const w of words) {
      if (boxes.some((b) => iou(b.rect, w.rect) > 0.3 || contains(w.rect, b.rect))) continue;
      layer.append(h('button', { class: 'word', style: pct(w.rect), 'aria-label': `${w.text} 가리기`,
        onclick: (e: Event) => { e.stopPropagation(); boxes.push({ rect: pad(w.rect), guess: w.text }); render(); } }));
    }
    boxes.forEach((b, i) => layer.append(h('button', { class: 'tape', style: pct(b.rect), 'aria-label': `${b.guess || '빈칸'} 가림 풀기`, 'data-testid': 'tape',
      onclick: (e: Event) => { e.stopPropagation(); boxes.splice(i, 1); render(); } })));
    saveBtn.replaceChildren(boxes.length ? `저장 · 빈칸 ${boxes.length}개` : '빈칸 없이 저장');
  };

  // 손가락으로 끌어 직접 가리기(OCR이 못 찾은 손글씨·그림)
  let drag: { x: number; y: number; el: HTMLElement } | null = null;
  const at = (e: PointerEvent) => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  let drawMode = false;
  stage.addEventListener('pointerdown', (e) => {
    if (!drawMode || (e.target as HTMLElement).closest('.tape,.word')) return;
    const p = at(e);
    drag = { ...p, el: h('div', { class: 'tape drawing' }) };
    layer.append(drag.el);
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = at(e);
    drag.el.setAttribute('style', pct(norm(drag, p)));
  });
  stage.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const r = norm(drag, at(e));
    drag.el.remove(); drag = null;
    if (r.w > 0.01 && r.h > 0.008) { boxes.push({ rect: r, guess: '' }); render(); }
  });
  const drawBtn = h('button', { class: 'chip', 'aria-pressed': 'false', onclick: () => {
    drawMode = !drawMode;
    drawBtn.setAttribute('aria-pressed', String(drawMode));
    stage.classList.toggle('drawing-mode', drawMode);
    drawBtn.textContent = drawMode ? '✋ 그리기 끝' : '✏️ 직접 가리기';
  } }, '✏️ 직접 가리기');

  // 과목
  const subjList = [...new Set([...subjects(tt), '국어', '수학', '영어', '사회', '역사', '과학', '기타'])];
  const subjSel = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': '과목' });
  const renderSubj = () => {
    subjSel.replaceChildren(...subjList.map((s) => h('button', { class: 'chip', role: 'radio', 'aria-checked': String(s === subject),
      onclick: () => { subject = s; renderSubj(); } }, s)),
    h('button', { class: 'chip', onclick: () => { const s = prompt('과목 이름'); if (s?.trim()) { subject = s.trim(); if (!subjList.includes(subject)) subjList.splice(-1, 0, subject); renderSubj(); } } }, '＋'));
  };
  renderSubj();

  saveBtn.addEventListener('click', async () => {
    if (!subject) { toast('과목을 골라 주세요'); subjSel.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const now = Date.now();
    const kept = new Map(existing.map((b) => [b.id, b]));
    const list: Blank[] = boxes.map((b) => kept.get(b.id!) ?? {
      id: uid(), photoId, rect: b.rect, guess: b.guess, createdAt: now, history: [], ...newSchedule(now),
    });
    const next: Photo = { ...photo, subject, words };
    // 실험: 처음 저장할 때만 반씩 나눈다
    if (settings.experiment && !photo.finalDue && list.length >= 2) {
      const sorted = [...list].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
      const groups = assignGroups(photoId, sorted.map((b) => b.id));
      for (const b of list) b.group = groups.get(b.id);
      next.finalDue = photo.takenAt + FINAL_AFTER;
    }
    await db.putPhoto(next);
    await db.replaceBlanks(photoId, list);
    toast(list.length ? `빈칸 ${list.length}개 저장! ${fmtWhen(now + 3 * 3600_000)}에 풀어요` : '저장했어요');
    const nextId = editQueue.shift();
    go(nextId ? `#/edit/${nextId}` : '#/');
  });

  screen('가릴 말 고르기',
    h('p', { class: 'hint' }, '노란 테이프가 빈칸이 돼요. 테이프를 누르면 떼고, 점선 낱말을 누르면 붙여요.'),
    subjSel,
    h('div', { class: 'tools' }, drawBtn,
      h('button', { class: 'chip', 'aria-label': '작게', onclick: () => setZoom(zoom - 1) }, '－'),
      h('button', { class: 'chip', 'aria-label': '크게', onclick: () => setZoom(zoom + 1) }, '＋'),
      status),
    scroller,
    h('div', { class: 'dock' }, saveBtn));
  render();

  if (!photo.words) {
    status.textContent = '글자 찾는 중…';
    try {
      const canvas = await toCanvas(img);
      words = await findWords(canvas, (p) => { if (alive) status.textContent = `글자 찾는 중… ${Math.round(p * 100)}%`; });
      if (!alive) return;
      await db.putPhoto({ ...photo, words, subject });
      // 추천: 아직 아무것도 안 가렸을 때만(학생이 먼저 고친 걸 덮지 않게)
      if (!boxes.length) for (const c of suggestBlanks(words)) boxes.push({ rect: c.rect, guess: c.text });
      status.textContent = words.length ? `낱말 ${words.length}개 찾음` : '글자를 못 찾았어요 — 직접 가려 주세요';
      if (!words.length) drawBtn.click();
      render();
    } catch (e) {
      console.error(e);
      if (alive) { status.textContent = '글자 찾기 실패 — 직접 가려 주세요'; if (!drawMode) drawBtn.click(); }
    }
  }
}

const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x - 0.005 && inner.y >= outer.y - 0.01 && inner.x + inner.w <= outer.x + outer.w + 0.005 && inner.y + inner.h <= outer.y + outer.h + 0.01;
const pad = (r: Rect): Rect => { const p = r.h * 0.12; return { x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), w: r.w + 2 * p, h: r.h + 2 * p }; };
const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => {
  const c = (v: number) => Math.max(0, Math.min(1, v));
  const x0 = c(Math.min(a.x, b.x)), y0 = c(Math.min(a.y, b.y));
  return { x: x0, y: y0, w: c(Math.max(a.x, b.x)) - x0, h: c(Math.max(a.y, b.y)) - y0 };
};
async function toCanvas(img: HTMLImageElement) {
  if (!img.complete) await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

// ───────────── 사진 한 장 ─────────────

async function photoView(photoId: string) {
  const photo = await db.getPhoto(photoId);
  if (!photo) return go('#/');
  const blanks = await db.blanksOf(photoId);
  const img = h('img', { alt: '판서 사진' });
  img.src = await imageUrl(photoId);
  let hidden = true;
  const layer = h('div', { class: 'layer' });
  const render = () => layer.replaceChildren(...(hidden ? blanks.filter((b) => b.group !== 'control' || !photo.finalDue || (photo.finalDue <= Date.now())).map((b) =>
    h('div', { class: 'tape solid', style: pct(b.rect) })) : []));
  render();
  const stage = h('div', { class: 'stage', style: `aspect-ratio:${photo.width}/${photo.height}`, onclick: () => { hidden = !hidden; render(); } }, img, layer);
  screen(`${photo.subject || '과목 없음'} · ${fmtDate(photo.takenAt)}`,
    h('p', { class: 'hint' }, '사진을 누르면 빈칸을 열고 닫아요.'),
    h('div', { class: 'scroller' }, stage),
    h('div', { class: 'row' },
      h('button', { class: 'big ghost', onclick: () => go(`#/edit/${photoId}`) }, '✏️ 빈칸 고치기'),
      h('button', { class: 'big danger', onclick: async () => {
        if (!confirm('이 판서와 빈칸 기록을 지울까요?')) return;
        await db.deletePhoto(photoId);
        const u = urls.get(photoId); if (u) URL.revokeObjectURL(u); urls.delete(photoId);
        go('#/');
      } }, '🗑️ 지우기')),
    h('ul', { class: 'blanklist' }, ...blanks.sort((a, b) => a.rect.y - b.rect.y).map((b) => h('li', {},
      h('span', {}, b.guess || '(직접 가린 칸)'),
      h('small', {}, b.group === 'control' && !b.final ? '실험: 7일 확인에서만' : b.history.length ? `${b.history.filter((x) => x.knew).length}/${b.history.length} 맞힘 · 다음 ${fmtWhen(b.due)}` : `첫 복습 ${fmtWhen(b.due)}`)))));
}

// ───────────── 풀기 ─────────────

async function review(mode: 'daily' | 'final') {
  const now = Date.now();
  const [photos, blanks] = await Promise.all([db.allPhotos(), db.allBlanks()]);
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  let queue: Blank[];
  if (mode === 'daily') queue = dueQueue(blanks, now);
  else {
    const ready = new Set(photos.filter((p) => p.finalDue && p.finalDue <= now).map((p) => p.id));
    queue = blanks.filter((b) => ready.has(b.photoId) && b.group && !b.final).sort((a, b) => a.photoId.localeCompare(b.photoId) || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  }
  if (!queue.length) { toast(mode === 'final' ? '7일 확인할 사진이 없어요' : '오늘 풀 빈칸이 없어요'); return go('#/'); }

  const total = queue.length;
  const firstTry = new Map<string, boolean>(); // 이번에 처음 답한 결과(일정은 이것만 반영)
  const doneInSession = new Set<string>();
  let current: Blank | null = null;
  let revealed = false;
  let wide = false;

  const bar = h('div', { class: 'progress' }, h('i'));
  const label = h('p', { class: 'where' });
  const img = h('img', { alt: '판서 사진' });
  const layer = h('div', { class: 'layer' });
  const stage = h('div', { class: 'stage review' }, img, layer);
  const viewport = h('div', { class: 'viewport', onclick: () => { if (!revealed) reveal(); } }, stage);
  const actions = h('div', { class: 'dock answer' });
  const wideBtn = h('button', { class: 'chip', onclick: (e: Event) => { e.stopPropagation(); wide = !wide; place(); wideBtn.textContent = wide ? '🔍 빈칸 크게' : '🗺️ 전체 보기'; } }, '🗺️ 전체 보기');

  const place = () => {
    if (!current) return;
    const p = photoMap.get(current.photoId)!;
    const vw = viewport.clientWidth || 360, vh = viewport.clientHeight || 300;
    const aspect = p.width / p.height;
    // 전체 보기: 사진을 창에 맞춘다. 빈칸 크게: 빈칸 둘레가 창의 절반쯤 되게 키우고 빈칸을 가운데로.
    let W = Math.min(vw, vh * aspect);
    if (!wide) {
      const r = current.rect;
      const ctxW = Math.max(r.w * 3, 0.35), ctxH = Math.max(r.h * 5, 0.2);
      W = Math.max(W, Math.min(vw / ctxW, (vh / ctxH) * aspect, W * 5));
    }
    const H = W / aspect;
    stage.style.width = `${W}px`; stage.style.height = `${H}px`;
    const cx = (current.rect.x + current.rect.w / 2) * W, cy = (current.rect.y + current.rect.h / 2) * H;
    const x = W <= vw ? (vw - W) / 2 : Math.min(0, Math.max(vw - W, vw / 2 - cx));
    const y = H <= vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H, vh / 2 - cy));
    stage.style.transform = `translate(${x}px, ${y}px)`;
  };
  const onResize = () => place();
  window.addEventListener('resize', onResize);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') { if (!revealed) { e.preventDefault(); reveal(); } }
    else if (revealed && (e.key === '1' || e.key === 'ArrowLeft')) answer(false);
    else if (revealed && (e.key === '2' || e.key === 'ArrowRight')) answer(true);
  };
  window.addEventListener('keydown', onKey);
  leaving = () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };

  const drawLayer = () => {
    const p = photoMap.get(current!.photoId)!;
    const same = blanks.filter((b) => b.photoId === p.id);
    layer.replaceChildren(...same.map((b) => {
      // 매일 복습: 대조군은 가리지 않는다(다시 읽기만). 최종 확인: 전부 가린다.
      if (mode === 'daily' && b.group === 'control') return null;
      const isCur = b.id === current!.id;
      if (isCur) return h('div', { class: `tape current${revealed ? ' open' : ''}`, style: pct(b.rect), 'data-testid': 'current' }, revealed ? '' : '?');
      if (doneInSession.has(b.id)) return null; // 이번에 푼 것은 열어 둔다
      return h('div', { class: 'tape solid', style: pct(b.rect) });
    }).filter(Boolean) as HTMLElement[]);
  };

  const show = async () => {
    current = queue[0] ?? null;
    if (!current) return finish();
    revealed = false;
    const p = photoMap.get(current.photoId)!;
    const u = await imageUrl(p.id);
    if (img.src !== u) { img.src = u; await img.decode().catch(() => {}); }
    const n = firstTry.size;
    (bar.firstChild as HTMLElement).style.width = `${(n / total) * 100}%`;
    label.textContent = `${p.subject || '과목 없음'} · ${fmtDate(p.takenAt)} · ${Math.min(n + 1, total)}/${total}`;
    drawLayer();
    place();
    actions.replaceChildren(h('button', { class: 'big primary', 'data-testid': 'reveal', onclick: reveal }, '정답 보기'));
  };

  function reveal() {
    revealed = true;
    drawLayer();
    actions.replaceChildren(
      h('button', { class: 'big no', 'data-testid': 'forgot', onclick: () => answer(false) }, '😵 몰랐어'),
      h('button', { class: 'big yes', 'data-testid': 'knew', onclick: () => answer(true) }, '😎 알았어'));
  }

  async function answer(knew: boolean) {
    const b = queue.shift()!;
    const now = Date.now();
    if (mode === 'final') {
      firstTry.set(b.id, knew);
      b.final = { at: now, knew };
      await db.putBlank(b);
    } else {
      if (!firstTry.has(b.id)) {
        firstTry.set(b.id, knew);
        Object.assign(b, grade(b, knew, now));
        await db.putBlank(b);
      }
      // 모르면 이번 판 끝에 한 번 더(맞힐 때까지). 일정은 처음 답만 반영.
      if (!knew) queue.push(b); else doneInSession.add(b.id);
    }
    if (mode === 'final') doneInSession.add(b.id);
    show();
  }

  function finish() {
    leaving?.(); leaving = null;
    const knew = [...firstTry.values()].filter(Boolean).length;
    const later = nextDue(blanks, Date.now());
    screen(mode === 'final' ? '7일 확인 끝' : '오늘 복습 끝',
      h('section', { class: 'hero done' },
        h('p', { class: 'count' }, `${knew}/${firstTry.size}`),
        h('p', { class: 'sub' }, mode === 'final' ? '결과는 🧪 실험 화면에서 볼 수 있어요' : '처음에 알았던 빈칸'),
        mode === 'daily' && later ? h('p', { class: 'sub' }, `다음 복습: ${fmtWhen(later.at)} · ${later.count}개`) : null,
        h('button', { class: 'big primary', onclick: () => go(mode === 'final' ? '#/experiment' : '#/') }, mode === 'final' ? '결과 보기' : '처음으로')));
  }

  screen(mode === 'final' ? '🧪 7일 확인' : '풀기', bar,
    h('div', { class: 'row between' }, label, wideBtn),
    mode === 'final' ? h('p', { class: 'hint' }, '실험용이에요. 한 번씩만 물어봐요. 솔직하게 눌러 주세요.') : null,
    viewport, actions);
  show();
}

// ───────────── 시간표 ─────────────

async function timetable() {
  const t: Timetable = await db.getTimetable();
  const table = h('table', { class: 'tt' });
  const head = h('tr', {}, h('th', {}, ''), ...[1, 2, 3, 4, 5].map((d) => h('th', {}, DAYS[d])));
  table.append(head);
  t.periods.forEach((p, i) => {
    const time = h('th', {}, h('span', {}, `${i + 1}교시`),
      h('input', { type: 'time', value: p.start, 'aria-label': `${i + 1}교시 시작`, oninput: (e: Event) => (p.start = (e.target as HTMLInputElement).value) }),
      h('input', { type: 'time', value: p.end, 'aria-label': `${i + 1}교시 끝`, oninput: (e: Event) => (p.end = (e.target as HTMLInputElement).value) }));
    table.append(h('tr', {}, time, ...[1, 2, 3, 4, 5].map((d) =>
      h('td', {}, h('input', { value: t.grid[d]?.[i] ?? '', list: 'subjects', 'aria-label': `${DAYS[d]} ${i + 1}교시`, 'data-cell': `${d}-${i}`,
        oninput: (e: Event) => { (t.grid[d] ??= [])[i] = (e.target as HTMLInputElement).value.trim(); } })))));
  });
  const addPeriod = h('button', { class: 'chip', onclick: () => { const l = t.periods[t.periods.length - 1]; t.periods.push({ start: l.end, end: l.end }); db.setTimetable(t).then(() => timetable()); } }, '＋ 교시');
  screen('시간표',
    h('p', { class: 'hint' }, '한 번만 적어 두면, 찍은 시각으로 과목이 저절로 정해져요. 쉬는 시간(끝나고 10분)에 찍어도 그 수업이에요.'),
    h('datalist', { id: 'subjects' }, ...['국어', '수학', '영어', '사회', '역사', '도덕', '과학', '기술·가정', '정보', '음악', '미술', '체육', '한문'].map((s) => h('option', { value: s }))),
    h('div', { class: 'tt-wrap' }, table),
    h('div', { class: 'row' }, addPeriod),
    h('div', { class: 'dock' }, h('button', { class: 'big primary', 'data-testid': 'save-tt', onclick: async () => { await db.setTimetable(t); toast('시간표 저장!'); go('#/'); } }, '저장')));
}

// ───────────── 실험 ─────────────

async function experiment() {
  const [settings, blanks, photos] = await Promise.all([db.getSettings(), db.allBlanks(), db.allPhotos()]);
  const r = summarize(blanks);
  const rate = (x: { n: number; knew: number }) => (x.n ? Math.round((x.knew / x.n) * 100) : 0);
  const waiting = photos.filter((p) => p.finalDue && p.finalDue > Date.now());
  const toggle = h('input', { type: 'checkbox', checked: settings.experiment, onchange: async (e: Event) => {
    await db.setSettings({ ...settings, experiment: (e.target as HTMLInputElement).checked });
    toast((e.target as HTMLInputElement).checked ? '실험을 켰어요. 이제 찍는 판서부터 적용돼요' : '실험을 껐어요');
  } });
  const subjOf = new Map(photos.map((p) => [p.id, p.subject]));
  screen('🧪 우리 반 실험',
    h('section', { class: 'card prose' },
      h('p', {}, h('b', {}, '질문: '), '판서를 다시 ', h('i', {}, '읽기만'), ' 하는 것과, 가리고 ', h('i', {}, '떠올려 보는'), ' 것 중 뭐가 더 오래 남을까?'),
      h('p', {}, '실험을 켜면 새로 찍는 사진의 빈칸을 반씩 나눠요. 반은 복습 문제로 나오고, 반은 복습 때 가려지지 않고 그대로 보여요(다시 읽기). 찍고 7일 뒤 둘 다 가리고 한 번씩 물어봐요.'),
      h('p', { class: 'muted' }, '한 사람 안에서 비교하니 반 친구를 두 무리로 나눌 필요가 없어요. 스스로 채점이라 후하게 매길 수 있지만, 두 무리에 똑같이 적용되니 차이는 비교할 수 있어요.')),
    h('label', { class: 'switch' }, toggle, h('span', {}, '실험 켜기')),
    h('section', { class: 'card result', 'data-testid': 'exp-result' },
      h('h2', {}, '내 결과'),
      r.practice.n + r.control.n === 0
        ? h('p', { class: 'muted' }, waiting.length ? `7일 확인을 기다리는 사진 ${waiting.length}장 — 첫 확인: ${fmtWhen(Math.min(...waiting.map((p) => p.finalDue!)))}` : '아직 7일 확인을 한 빈칸이 없어요.')
        : h('div', {},
          h('div', { class: 'barrow' }, h('span', {}, '떠올려 본 빈칸'), h('div', { class: 'meter' }, h('i', { style: `width:${rate(r.practice)}%` })), h('b', {}, `${rate(r.practice)}%`), h('small', {}, `${r.practice.knew}/${r.practice.n}`)),
          h('div', { class: 'barrow ctl' }, h('span', {}, '읽기만 한 빈칸'), h('div', { class: 'meter' }, h('i', { style: `width:${rate(r.control)}%` })), h('b', {}, `${rate(r.control)}%`), h('small', {}, `${r.control.knew}/${r.control.n}`)),
          h('p', {}, r.diff === null ? '양쪽 다 5개 이상 모이면 차이를 말해 줄게요.' : `떠올려 본 쪽이 ${r.diff >= 0 ? `${r.diff}%p 더` : `${-r.diff}%p 덜`} 기억났어요 (사진 ${r.photos}장).`)),
      h('button', { class: 'big ghost', onclick: () => download(`찍풀-실험-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(blanks.map((b) => ({ ...b, subject: subjOf.get(b.photoId) ?? '' }))), 'text/csv') }, '⬇️ CSV로 내보내기')),
    h('p', { class: 'muted' }, '여러 명의 CSV를 모으면 반 전체 결과가 돼요. 이름은 들어가지 않아요.'));
}

// ───────────── 도움말 ─────────────

function about() {
  const restoreInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', 'data-testid': 'import-input' });
  restoreInput.addEventListener('change', async () => {
    const f = restoreInput.files?.[0];
    if (!f) return;
    try { const n = await db.importAll(JSON.parse(await f.text())); toast(`판서 ${n}장을 가져왔어요`); }
    catch (e) { toast(e instanceof Error && e.message.includes('백업') ? e.message : '파일을 읽지 못했어요'); }
    restoreInput.value = '';
  });
  const time = h('input', { type: 'time', value: '19:00', 'aria-label': '알림 시각' });
  screen('도움말',
    h('section', { class: 'card prose' },
      h('h2', {}, '왜 빈칸인가요?'),
      h('p', {}, '판서를 찍기만 하면 머리는 "저장했다"고 믿고 잊어버려요. 사진을 다시 ', h('b', {}, '읽는 것'), '보다 가리고 ', h('b', {}, '떠올려 보는 것'), '이 훨씬 오래 남아요. 잊을 때쯤(저녁 → 1일 → 3일 → 7일 → 14일) 다시 떠올리면 더 오래가요.'),
      h('h2', {}, '정답이 틀릴 수는 없나요?'),
      h('p', {}, '정답은 AI가 쓴 글자가 아니라 ', h('b', {}, '선생님 판서 사진 그 자체'), '예요. 글자 찾기는 "어디를 가릴지" 추천만 해요. 추천이 틀리면 톡 눌러 고치면 돼요.'),
      h('h2', {}, '내 사진은 어디로 가나요?'),
      h('p', {}, '아무 데도 안 가요. 사진·기록은 이 폰 안에만 있어요. 계정도 없어요. 한 번 연 뒤로는 인터넷 없이도 돼요.')),
    h('section', { class: 'card' },
      h('h2', {}, '⏰ 복습 알림'),
      h('p', { class: 'muted' }, '폰 캘린더에 매일 복습 일정을 넣어요.'),
      h('div', { class: 'row' }, time, h('button', { class: 'big ghost', onclick: () => download('찍풀-복습-알림.ics', reminderIcs(time.value, location.href.split('#')[0]), 'text/calendar') }, '캘린더에 넣기'))),
    h('section', { class: 'card' },
      h('h2', {}, '💾 폰 바꿀 때'),
      h('p', { class: 'muted' }, '기록은 이 폰에만 있어요. 백업 파일로 내보내서 새 폰에서 가져오세요.'),
      h('div', { class: 'row' },
        h('button', { class: 'big ghost', 'data-testid': 'export', onclick: async () => {
          const data = await db.exportAll();
          download(`찍풀-백업-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
        } }, '내보내기'),
        restoreInput,
        h('button', { class: 'big ghost', onclick: () => restoreInput.click() }, '가져오기'))));
}

route();
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});
