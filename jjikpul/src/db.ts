import type { Blank, Photo } from './core/types';
import { emptyTimetable, type Timetable } from './core/timetable';

/** 모든 기록은 이 기기의 IndexedDB에만. 서버·계정 없음. */
const DB = 'jjikpul';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('photos', { keyPath: 'id' });
      db.createObjectStore('images'); // id → Blob
      const b = db.createObjectStore('blanks', { keyPath: 'id' });
      b.createIndex('photoId', 'photoId');
      db.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await open();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const out = await fn(t);
  await done;
  return out;
}

export async function savePhoto(photo: Photo, image: Blob, blanks: Blank[]) {
  await tx(['photos', 'images', 'blanks'], 'readwrite', (t) => {
    t.objectStore('photos').put(photo);
    t.objectStore('images').put(image, photo.id);
    const bs = t.objectStore('blanks');
    for (const b of blanks) bs.put(b);
  });
}

export async function replaceBlanks(photoId: string, blanks: Blank[]) {
  await tx(['blanks'], 'readwrite', async (t) => {
    const s = t.objectStore('blanks');
    const old = await req(s.index('photoId').getAllKeys(photoId));
    for (const k of old) s.delete(k);
    for (const b of blanks) s.put(b);
  });
}

export async function deletePhoto(id: string) {
  await tx(['photos', 'images', 'blanks'], 'readwrite', async (t) => {
    t.objectStore('photos').delete(id);
    t.objectStore('images').delete(id);
    const s = t.objectStore('blanks');
    for (const k of await req(s.index('photoId').getAllKeys(id))) s.delete(k);
  });
}

export const allPhotos = () => tx(['photos'], 'readonly', (t) => req(t.objectStore('photos').getAll() as IDBRequest<Photo[]>));
export const allBlanks = () => tx(['blanks'], 'readonly', (t) => req(t.objectStore('blanks').getAll() as IDBRequest<Blank[]>));
export const getPhoto = (id: string) => tx(['photos'], 'readonly', (t) => req(t.objectStore('photos').get(id) as IDBRequest<Photo | undefined>));
export const getImage = (id: string) => tx(['images'], 'readonly', (t) => req(t.objectStore('images').get(id) as IDBRequest<Blob | undefined>));
export const blanksOf = (photoId: string) => tx(['blanks'], 'readonly', (t) => req(t.objectStore('blanks').index('photoId').getAll(photoId) as IDBRequest<Blank[]>));
export const putBlank = (b: Blank) => tx(['blanks'], 'readwrite', (t) => { t.objectStore('blanks').put(b); });
export const putPhoto = (p: Photo) => tx(['photos'], 'readwrite', (t) => { t.objectStore('photos').put(p); });

async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const v = await tx(['kv'], 'readonly', (t) => req(t.objectStore('kv').get(key)));
  return (v ?? fallback) as T;
}
const kvSet = (key: string, v: unknown) => tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').put(v, key); });

export const getTimetable = () => kvGet<Timetable>('timetable', emptyTimetable());
export const setTimetable = (t: Timetable) => kvSet('timetable', t);
export interface Settings { experiment: boolean }
export const getSettings = () => kvGet<Settings>('settings', { experiment: false });
export const setSettings = (s: Settings) => kvSet('settings', s);
