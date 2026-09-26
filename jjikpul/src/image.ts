/** 폰 사진(4000px, 5MB)을 저장·OCR에 알맞은 크기로. 긴 변 2000px이면 판서 글자가 충분히 읽힌다. */
export const MAX_SIDE = 2000;

export async function prepare(file: Blob): Promise<{ blob: Blob; width: number; height: number; canvas: HTMLCanvasElement }> {
  // imageOrientation: 폰 사진의 EXIF 회전을 적용한다(안 하면 누운 사진이 된다).
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale), height = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('사진을 저장하지 못했어요'))), 'image/jpeg', 0.85));
  return { blob, width, height, canvas };
}
