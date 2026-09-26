// 측정 사진의 OCR 결과를 JSON으로 저장한다(테스트·측정이 OCR을 다시 돌리지 않게).
//   node eval/dump-ocr.mjs                 → eval/fixtures → tests/fixtures-ocr.json (개발용)
//   node eval/dump-ocr.mjs heldout out.json → eval/heldout → out.json            (시험용)
import { createWorker } from 'tesseract.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { LANG } from './lang.mjs';
const dir = `eval/${process.argv[2] ?? 'fixtures'}`;
const out = process.argv[3] ?? 'tests/fixtures-ocr.json';
const idx = JSON.parse(readFileSync(`${dir}/index.json`));
const w = await createWorker(['kor', 'eng'], 1, { langPath: LANG, cacheMethod: 'none' });
const all = {};
const times = [];
for (const f of idx) {
  const t = Date.now();
  const { data } = await w.recognize(`${dir}/${f.file}`, {}, { blocks: true });
  times.push(Date.now() - t);
  const slim = data.blocks.map((b) => ({ paragraphs: b.paragraphs.map((p) => ({ lines: p.lines.map((l) => ({ text: l.text, words: l.words.map((x) => ({
    text: x.text, confidence: Math.round(x.confidence), bbox: x.bbox, symbols: x.symbols.map((s) => ({ text: s.text, bbox: s.bbox })) })) })) })) }));
  all[f.file] = { width: 1600, height: 1000, blocks: slim, text: data.text };
}
writeFileSync(out, JSON.stringify(all));
await w.terminate();
times.sort((a, b) => a - b);
console.log(`${Object.keys(all).length}장 저장 → ${out} (OCR 중앙값 ${times[times.length >> 1]}ms, 노드·CPU 1코어)`);
