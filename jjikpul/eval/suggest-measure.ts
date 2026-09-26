// 추천 빈칸이 "선생님이 중요하다고 할 말"(fixtures의 keys)을 얼마나 골랐나.
import { readFileSync } from 'node:fs';
import { fromTesseract } from '../src/core/ocrWords';
import { suggestBlanks } from '../src/core/blanks';
const idx = JSON.parse(readFileSync('eval/fixtures/index.json', 'utf8'));
const ocr = JSON.parse(readFileSync('tests/fixtures-ocr.json', 'utf8'));
let tp = 0, picked = 0, keys = 0;
const verbose = process.argv.includes('-v');
for (const f of idx) {
  const o = ocr[f.file];
  const words = fromTesseract(o.blocks, o.width, o.height);
  const s = suggestBlanks(words);
  const hitKeys = f.keys.filter((k: string) => s.some((c) => c.text.includes(k) || k.includes(c.text) && c.text.length >= 2));
  const goodPicks = s.filter((c) => f.keys.some((k: string) => c.text.includes(k) || k.includes(c.text)));
  tp += hitKeys.length; keys += f.keys.length; picked += s.length;
  if (verbose) console.log(f.file.padEnd(30), `${hitKeys.length}/${f.keys.length}`, s.map((c) => `${c.text}(${c.score})`).join(' '));
  (globalThis as any).good = ((globalThis as any).good ?? 0) + goodPicks.length;
}
const good = (globalThis as any).good;
console.log(`핵심어 재현율 ${tp}/${keys} = ${(100 * tp / keys).toFixed(1)}%`);
console.log(`추천 정밀도 ${good}/${picked} = ${(100 * good / picked).toFixed(1)}%  (사진당 평균 ${(picked / idx.length).toFixed(1)}개)`);
