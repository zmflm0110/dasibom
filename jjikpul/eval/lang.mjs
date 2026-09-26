// tesseract는 한 폴더에서 언어 데이터를 찾는다. npm으로 받은 kor·eng를 한 곳에 모은다.
import { mkdirSync, cpSync } from 'node:fs';
export const LANG = 'eval/.lang';
mkdirSync(LANG, { recursive: true });
for (const l of ['kor', 'eng']) cpSync(`node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `${LANG}/${l}.traineddata.gz`);
