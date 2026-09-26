// 테스트용: 측정 사진의 OCR 결과를 JSON으로 저장한다(테스트가 OCR을 다시 돌리지 않게).
import { LANG } from './lang.mjs';
import { createWorker } from 'tesseract.js';
import { readFileSync, writeFileSync } from 'node:fs';
const idx = JSON.parse(readFileSync('eval/fixtures/index.json'));
const w = await createWorker(['kor', 'eng'], 1, { langPath: LANG, cacheMethod: 'none' });
const all = {};
for (const f of idx) {
  const { data } = await w.recognize('eval/fixtures/' + f.file, {}, { blocks: true });
  const slim = data.blocks.map((b) => ({ paragraphs: b.paragraphs.map((p) => ({ lines: p.lines.map((l) => ({ text: l.text, words: l.words.map((x) => ({
    text: x.text, confidence: Math.round(x.confidence), bbox: x.bbox, symbols: x.symbols.map((s) => ({ text: s.text, bbox: s.bbox })) })) })) })) }));
  all[f.file] = { width: 1600, height: 1000, blocks: slim };
}
writeFileSync('tests/fixtures-ocr.json', JSON.stringify(all));
await w.terminate();
console.log('saved', Object.keys(all).length);
