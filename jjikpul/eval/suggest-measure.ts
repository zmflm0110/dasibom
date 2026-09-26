// 두 가지를 잰다.
//  ① 글자 찾기: 핵심어가 OCR 글자에 들어 있나(띄어쓰기 무시)
//  ② 빈칸 추천: 추천이 핵심어를 얼마나 덮나(재현율), 추천 중 핵심어인 비율(정밀도)
//   npx tsx eval/suggest-measure.ts                           개발용(규칙을 고칠 때 보는 것)
//   npx tsx eval/suggest-measure.ts heldout eval/heldout-ocr.json  시험용(한 번만)
import { readFileSync } from 'node:fs';
import { fromTesseract } from '../src/core/ocrWords';
import { suggestBlanks } from '../src/core/blanks';
const dir = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'fixtures';
const dump = process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : 'tests/fixtures-ocr.json';
const verbose = process.argv.includes('-v');
const idx = JSON.parse(readFileSync(`eval/${dir}/index.json`, 'utf8'));
const ocr = JSON.parse(readFileSync(dump, 'utf8'));
const match = (c: string, k: string) => c.includes(k) || (k.includes(c) && [...c].length >= 2);

type Acc = { found: number; hit: number; keys: number; good: number; picked: number; n: number };
const groups = new Map<string, Acc>();
const add = (key: string, a: Omit<Acc, 'n'>) => {
  const g = groups.get(key) ?? { found: 0, hit: 0, keys: 0, good: 0, picked: 0, n: 0 };
  for (const k of Object.keys(a) as (keyof typeof a)[]) g[k] += a[k];
  g.n++;
  groups.set(key, g);
};
for (const f of idx) {
  const o = ocr[f.file];
  const words = fromTesseract(o.blocks, o.width, o.height);
  const flat = words.map((w) => w.text).join('');
  const s = suggestBlanks(words);
  const r = {
    found: f.keys.filter((k: string) => flat.includes(k)).length,
    hit: f.keys.filter((k: string) => s.some((c) => match(c.text, k))).length,
    keys: f.keys.length,
    good: s.filter((c) => f.keys.some((k: string) => match(c.text, k))).length,
    picked: s.length,
  };
  for (const key of ['전체', `판:${f.style}`, `조건:${f.cond}`]) add(key, r);
  if (verbose) console.log(f.file.padEnd(30), `${r.hit}/${r.keys}`, s.map((c) => c.text).join(' '));
}
const p = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1) : '-'}%`;
console.log(`| 묶음 | 사진 | 글자 찾기 | 추천 재현율 | 추천 정밀도 | 사진당 추천 | 고치는 누름(추천 없이) |`);
console.log(`|---|---|---|---|---|---|---|`);
for (const [k, g] of groups) console.log(`| ${k} | ${g.n} | ${p(g.found, g.keys)} | ${p(g.hit, g.keys)} | ${p(g.good, g.picked)} | ${(g.picked / g.n).toFixed(1)} | ${(((g.keys - g.hit) + (g.picked - g.good)) / g.n).toFixed(1)} (${(g.keys / g.n).toFixed(1)}) |`);
