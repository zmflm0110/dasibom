import { defineConfig } from 'vite';

// `vite build --mode artifact`: 한 파일로 묶어 클로드 아티팩트(폰에서 링크로 여는 판)로 낸다.
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    target: 'es2022',
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    rollupOptions: mode === 'artifact' ? { output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' } } : {},
  },
}));
