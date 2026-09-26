import type { OcrWord } from './core/types';
import { fromTesseract } from './core/ocrWords';

/**
 * 글자 찾기는 전부 이 기기 안에서. 엔진·한국어 데이터는 앱과 함께 내려받아 두므로
 * 한 번 연 뒤로는 인터넷이 없어도 된다(비행기 모드에서 시험함 — tests/e2e).
 */
type Worker = import('tesseract.js').Worker;
let wp: Promise<Worker> | null = null;
let onProgress: ((p: number) => void) | null = null;

function worker(): Promise<Worker> {
  return (wp ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const base = new URL('./tess/', document.baseURI).href;
    return createWorker(['kor', 'eng'], 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
    });
  })());
}

/** 앱을 열자마자 미리 데워 둔다 — 첫 사진에서 기다리지 않게. */
export function warmUp() { worker().catch(() => { wp = null; }); }

export async function findWords(canvas: HTMLCanvasElement, progress?: (p: number) => void): Promise<OcrWord[]> {
  const w = await worker();
  onProgress = progress ?? null;
  try {
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
    return fromTesseract(data.blocks as never, canvas.width, canvas.height);
  } finally { onProgress = null; }
}
