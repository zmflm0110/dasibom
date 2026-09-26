/** 말 다듬기와 n-그램. model/normalize.py와 글자 하나까지 같아야 한다(tests/core.test.ts의 짝 맞춤 검사). */
const ZW = /[​-‏⁠﻿]/g;
// 한글 사이에 끼운 숫자·기호(시1발, 씨.발, ㅅ-ㅂ)를 뺀다
const GAP = /(?<=[가-힣ㄱ-ㅎㅏ-ㅣ])[0-9.,\-_*~!@#^+=/\\|:;'"`]+(?=[가-힣ㄱ-ㅎㅏ-ㅣ])/g;
const REPEAT = /(.)\1{2,}/gsu;
const WS = /\s+/g;

export function normalize(text: string): string {
  // NFKC는 전각 글자 등을 풀어 주지만 'ㅅㅂ' 같은 자음(호환 자모)까지 다른 글자로 바꿔 버린다.
  // 그래서 먼저 NFC로 합치고, 호환 자모만 빼고 NFKC를 한다.
  let t = [...text.normalize('NFC')].map((c) => (c >= '\u3130' && c <= '\u318f' ? c : c.normalize('NFKC'))).join('').toLowerCase();
  t = t.replace(ZW, '').replace(GAP, '').replace(REPEAT, '$1$1');
  return t.replace(WS, ' ').trim();
}

export function ngrams(text: string, lo = 1, hi = 3): string[] {
  const out: string[] = [];
  for (const word of normalize(text).split(' ')) {
    if (!word) continue;
    const w = [...(' ' + word + ' ')];
    for (let n = lo; n <= hi; n++) {
      if (w.length < n) break;
      for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(''));
    }
  }
  return out;
}
