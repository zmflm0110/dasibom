"""말 다듬기와 n-그램. src/core/normalize.ts와 글자 하나까지 같아야 한다(tests/parity가 확인)."""
import re
import unicodedata

ZW = re.compile('[​-‏⁠﻿]')
# 한글 사이에 끼운 숫자·기호(시1발, 씨.발, ㅅ-ㅂ)를 뺀다
GAP = re.compile(r'(?<=[가-힣ㄱ-ㅎㅏ-ㅣ])[0-9.,\-_*~!@#^+=/\\|:;\'"`]+(?=[가-힣ㄱ-ㅎㅏ-ㅣ])')
REPEAT = re.compile(r'(.)\1{2,}')
WS = re.compile(r'\s+')


def normalize(text: str) -> str:
    # NFKC는 전각 글자 등을 풀어 주지만 'ㅅㅂ' 같은 자음(호환 자모)까지 다른 글자로 바꿔 버린다.
    # 그래서 먼저 NFC로 합치고, 호환 자모만 빼고 NFKC를 한다.
    t = unicodedata.normalize('NFC', text)
    t = ''.join(c if '\u3130' <= c <= '\u318f' else unicodedata.normalize('NFKC', c) for c in t).lower()
    t = ZW.sub('', t)
    t = GAP.sub('', t)
    t = REPEAT.sub(r'\1\1', t)
    return WS.sub(' ', t).strip()


def ngrams(text: str, lo: int = 1, hi: int = 3) -> list:
    """낱말마다 앞뒤에 빈칸을 붙이고 글자 n-그램(sklearn char_wb와 같은 방식)."""
    out = []
    for w in normalize(text).split(' '):
        if not w:
            continue
        w = ' ' + w + ' '
        for n in range(lo, hi + 1):
            if len(w) < n:
                break
            for i in range(len(w) - n + 1):
                out.append(w[i:i + n])
    return out
