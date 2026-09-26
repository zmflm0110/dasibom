/** 사진 안의 위치. 0~1로 정규화해서 사진 크기가 바뀌어도 그대로다. */
export interface Rect { x: number; y: number; w: number; h: number }

/** OCR이 찾은 낱말 하나. text는 틀릴 수 있다 — 정답은 언제나 사진 픽셀이다. */
export interface OcrWord {
  text: string;
  rect: Rect;
  /** 0~100 */
  confidence: number;
  /** 몇 번째 줄인지 */
  line: number;
  /** 글자마다의 위치(있으면). 조사를 빼고 가릴 때 쓴다. */
  chars?: Rect[];
}

export type Group = 'practice' | 'control';

export interface Blank {
  id: string;
  photoId: string;
  rect: Rect;
  /** OCR 추정 글자. 검색·목록용일 뿐 채점에 쓰지 않는다. */
  guess: string;
  box: number;
  due: number;
  createdAt: number;
  history: { at: number; knew: boolean }[];
  /** 실험 모드일 때만: 'control'은 복습에 안 나오고 최종 확인에만 나온다. */
  group?: Group;
  /** 실험 최종 확인 결과 */
  final?: { at: number; knew: boolean };
}

export interface Photo {
  id: string;
  subject: string;
  takenAt: number;
  width: number;
  height: number;
  /** 실험 모드로 찍은 사진이면 최종 확인 예정 시각 */
  finalDue?: number;
  /** OCR이 찾은 낱말(다시 고칠 때 OCR을 또 돌리지 않게) */
  words?: OcrWord[];
}
