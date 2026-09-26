import { defineConfig, type Plugin } from 'vite';
import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** OCR 엔진·한국어 데이터를 앱 안에 넣는다(CDN을 안 쓴다 — 학교 와이파이가 막는 일이 잦고, 오프라인이어야 하니까). */
function tesseractAssets(): Plugin {
  const copy = () => {
    const out = 'public/tess';
    mkdirSync(out, { recursive: true });
    cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`);
    for (const f of readdirSync('node_modules/tesseract.js-core')) if (/lstm\.wasm\.js$/.test(f)) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/${f}`);
    cpSync('node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz', `${out}/kor.traineddata.gz`);
    cpSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/eng.traineddata.gz`);
  };
  return { name: 'tesseract-assets', buildStart: copy, configureServer: copy };
}

/** 서비스 워커: 빌드한 파일 전부를 미리 담아 둔다 → 한 번 열면 비행기 모드에서도 찍고 푼다. */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', './index.html', ...Object.keys(bundle).map((f) => './' + f)];
      const pub = ['manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png',
        ...readdirSync('public/tess').map((f) => 'tess/' + f)].map((f) => './' + f);
      const version = createHash('sha1').update(JSON.stringify(files) + readFileSync('src/sw.js', 'utf8')).digest('hex').slice(0, 10);
      const code = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify([...new Set([...files, ...pub])]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [tesseractAssets(), serviceWorker()],
  build: { target: 'es2022' },
});
