// 규칙+모델을 합친 "표시"가 학습·규칙 작성에 안 쓴 말에서 얼마나 맞나.
//  - 일상 대화 20%(모델 학습에서 뺀 몫): 잘못 표시하는 비율
//  - 욕설 데이터 20%, kocohub dev, UnSmile valid: 공격적인 말을 몇 % 표시하나 / 표시한 것 중 몇 %가 진짜인가
import { readFileSync, writeFileSync } from 'node:fs';
import { ruleHits } from '../src/core/detect';
import { makeScorer } from '../src/core/model';

const model = JSON.parse(readFileSync('public/model.json', 'utf8'));
const score = makeScorer(model);
const D = 'model/data/';

// train.py와 같은 섞기(파이썬 random과 다르므로 파이썬이 나눈 목록을 그대로 쓴다)
const split = JSON.parse(readFileSync('model/splits.json', 'utf8')) as { chat_test: string[]; curse_test: [string, number][] };
const koco = readFileSync(D + 'dev.tsv', 'utf8').split('\n').slice(1).map((l) => l.split('\t')).filter((r) => r.length >= 4).map((r) => [r[0], r[3].trim() !== 'none' ? 1 : 0] as [string, number]);
const uns = readFileSync(D + 'unsmile_valid_v1.0.tsv', 'utf8').split('\n').slice(1).map((l) => l.split('\t')).filter((r) => r.length >= 12).map((r) => [r[0], 1 - +r[10]] as [string, number]);

type Mode = 'rules' | 'model' | 'both';
const flagged = (t: string, mode: Mode) => {
  const r = ruleHits(t).length > 0, m = score(t) >= model.threshold;
  return mode === 'rules' ? r : mode === 'model' ? m : r || m;
};
const rows: string[] = ['| 데이터 | 방법 | 문장 | 표시 재현율 | 표시 정밀도 | 일상 말 오탐 |', '|---|---|---|---|---|---|'];
for (const mode of ['rules', 'model', 'both'] as Mode[]) {
  const name = { rules: '규칙만', model: '모델만', both: '규칙+모델(앱)' }[mode];
  const fp = split.chat_test.filter((t) => flagged(t, mode)).length;
  rows.push(`| 일상 대화 20% | ${name} | ${split.chat_test.length} | – | – | ${(100 * fp / split.chat_test.length).toFixed(2)}% |`);
  for (const [label, set] of [['욕설 데이터 20%', split.curse_test], ['kocohub dev', koco], ['UnSmile valid', uns]] as [string, [string, number][]][]) {
    let tp = 0, pos = 0, pred = 0;
    for (const [t, y] of set) { const f = flagged(t, mode); if (y) pos++; if (f) pred++; if (f && y) tp++; }
    rows.push(`| ${label} | ${name} | ${set.length} | ${(100 * tp / pos).toFixed(1)}% | ${(100 * tp / pred).toFixed(1)}% | – |`);
  }
}
const out = rows.join('\n');
console.log(out);
writeFileSync('eval/measure-table.md', out + '\n');
