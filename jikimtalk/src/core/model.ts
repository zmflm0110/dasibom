import { ngrams } from './normalize';

export interface ModelData { bias: number; threshold: number; weights: Record<string, number> }

/** 공격적인 말 점수(0~1). 글자 n-그램 로지스틱 회귀 — 기기 안에서 한 문장 0.1ms 안쪽. */
export function makeScorer(m: ModelData) {
  return (text: string) => {
    let s = m.bias;
    for (const g of new Set(ngrams(text))) s += m.weights[g] ?? 0;
    return 1 / (1 + Math.exp(-s));
  };
}
