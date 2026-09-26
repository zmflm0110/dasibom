"""공격적인 말 점수 모델을 만든다.

학습: kocohub/korean-hate-speech train (CC BY-SA 4.0) + 2runo/Curse-detection-data 80% (MIT)
검증: kocohub dev(같은 분야), 욕설 데이터 나머지 20%, Smilegate UnSmile valid(다른 분야, 학습에 안 씀)
결과: public/model.json (브라우저에서 돈다. 서버 없음)
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

sys.path.insert(0, str(Path(__file__).parent))
from normalize import ngrams  # noqa: E402

D = Path(__file__).parent / 'data'
OUT = Path(__file__).parent.parent / 'public' / 'model.json'


def kocohub(name):
    rows = [l.split('\t') for l in (D / name).read_text(encoding='utf-8').splitlines()[1:]]
    return [(r[0], int(r[3].strip() != 'none')) for r in rows if len(r) >= 4]


def curse():
    rows = []
    for l in (D / 'dataset.txt').read_text(encoding='utf-8').splitlines():
        if '|' not in l:
            continue
        t, y = l.rsplit('|', 1)
        if y.strip() in ('0', '1'):
            rows.append((t.strip(), int(y)))
    random.Random(42).shuffle(rows)
    k = int(len(rows) * .8)
    return rows[:k], rows[k:]


def chat():
    """일상 대화(songys/Chatbot_data, MIT) — 전부 공격적이지 않은 말. 80%는 학습, 20%는 오탐률 측정."""
    import csv
    rows = list(csv.DictReader((D / 'ChatbotData.csv').open(encoding='utf-8')))
    texts = sorted({r['Q'].strip() for r in rows} | {r['A'].strip() for r in rows})
    random.Random(7).shuffle(texts)
    k = int(len(texts) * .8)
    return [(t, 0) for t in texts[:k]], [(t, 0) for t in texts[k:]]


def unsmile():
    rows = [l.split('\t') for l in (D / 'unsmile_valid_v1.0.tsv').read_text(encoding='utf-8').splitlines()[1:]]
    # clean 열이 1이면 깨끗한 말. 나머지(혐오·악플/욕설)는 공격적인 말.
    return [(r[0], 1 - int(r[10])) for r in rows if len(r) >= 12]


def report(name, y, p, thr):
    pred = (p >= thr).astype(int)
    pr, rc, f1, _ = precision_recall_fscore_support(y, pred, average='binary', zero_division=0)
    auc = roc_auc_score(y, p)
    return {'set': name, 'n': len(y), 'pos': int(sum(y)), 'precision': round(pr, 3), 'recall': round(rc, 3), 'f1': round(f1, 3), 'auc': round(auc, 3)}


def main():
    c_train, c_test = curse()
    d_train, d_test = chat()
    train = kocohub('train.tsv') + c_train + d_train
    vec = CountVectorizer(analyzer=ngrams, binary=True, min_df=3)
    X = vec.fit_transform([t for t, _ in train])
    y = np.array([l for _, l in train])
    clf = LogisticRegression(C=0.5, max_iter=3000, class_weight='balanced')
    clf.fit(X, y)

    # 무게가 거의 0인 n-그램은 버린다(파일 크기)
    w = clf.coef_[0]
    vocab = vec.vocabulary_
    keep = {g: round(float(w[i]), 4) for g, i in vocab.items() if abs(w[i]) >= 0.02}
    bias = round(float(clf.intercept_[0]), 4)

    def score(texts):
        out = []
        for t in texts:
            s = bias + sum(keep.get(g, 0.0) for g in set(ngrams(t)))
            out.append(1 / (1 + np.exp(-s)))
        return np.array(out)

    # 기준값은 kocohub dev에서만 고른다. 단톡방은 대부분 평범한 말이라 정밀도를 더 친다(F0.5 최대).
    dev = kocohub('dev.tsv')
    p_dev = score([t for t, _ in dev])
    y_dev = np.array([l for _, l in dev])
    best = max(np.arange(0.3, 0.95, 0.01), key=lambda th: precision_recall_fscore_support(y_dev, (p_dev >= th).astype(int), average='binary', beta=0.5, zero_division=0)[2])
    thr = round(float(best), 2)

    results = [report('kocohub dev (같은 분야, 기준값 고른 곳)', y_dev, p_dev, thr)]
    results.append(report('욕설 데이터 20% (학습에 안 씀)', np.array([l for _, l in c_test]), score([t for t, _ in c_test]), thr))
    us = unsmile()
    results.append(report('UnSmile valid (다른 분야, 학습에 안 씀)', np.array([l for _, l in us]), score([t for t, _ in us]), thr))

    p_chat = score([t for t, _ in d_test])
    results.append({'set': '일상 대화 20% (학습에 안 씀) — 잘못 표시한 비율', 'n': len(d_test), 'false_positive_rate': round(float((p_chat >= thr).mean()), 4),
                    'examples': [t for (t, _), p in zip(d_test, p_chat) if p >= thr][:10]})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'about': '공격적인 말 점수. 학습: kocohub/korean-hate-speech(CC BY-SA 4.0), 2runo/Curse-detection-data(MIT). 모델 파일도 CC BY-SA 4.0.',
        'ngram': [1, 3], 'bias': bias, 'threshold': thr, 'weights': keep,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (Path(__file__).parent / 'splits.json').write_text(json.dumps({'chat_test': [t for t, _ in d_test], 'curse_test': c_test}, ensure_ascii=False), encoding='utf-8')
    (Path(__file__).parent / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'n-그램 {len(keep)}개, 기준값 {thr}, 파일 {OUT.stat().st_size // 1024}KB')
    for r in results:
        print(r)


if __name__ == '__main__':
    main()
