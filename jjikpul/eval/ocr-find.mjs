import { createWorker } from 'tesseract.js';
import { LANG } from './lang.mjs';
import { readFileSync } from 'node:fs';
const idx = JSON.parse(readFileSync('eval/fixtures/index.json'));
const w = await createWorker(['kor','eng'], 1, { langPath: LANG, cacheMethod: 'none' });
for (const f of idx) {
  const t0 = Date.now();
  const { data } = await w.recognize('eval/fixtures/' + f.file);
  const txt = data.text.replace(/\s+/g, '');
  const hit = f.keys.filter(k => txt.includes(k)).length;
  console.log(f.file.padEnd(32), `${hit}/${f.keys.length}`, Date.now()-t0+'ms', data.text.replace(/\n/g,' | ').slice(0,70));
}
await w.terminate();
