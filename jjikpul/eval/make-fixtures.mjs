// 측정용 판서 사진을 만든다. 진짜 교실 사진이 아니라는 한계는 eval/RESULTS.md에 적는다.
// 세 가지 판: 인쇄체 슬라이드(PPT를 찍은 것), 손글씨 화이트보드, 분필 칠판.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const font = (p) => readFileSync(new URL(`../node_modules/${p}`, import.meta.url)).toString('base64');
const PEN = font('@fontsource/nanum-pen-script/files/nanum-pen-script-korean-400-normal.woff2');
const SANS = font('@fontsource/nanum-gothic/files/nanum-gothic-korean-400-normal.woff2');
const SANSB = font('@fontsource/nanum-gothic/files/nanum-gothic-korean-700-normal.woff2');

// 정답: 각 판에 적힌 줄. 측정은 OCR이 이 줄의 핵심어를 몇 개 찾는지 본다.
export const BOARDS = [
  { id: 'sci-slide', subject: '과학', lines: ['광합성', '빛에너지를 이용해 포도당을 만드는 과정', '장소: 엽록체', '재료: 이산화 탄소 + 물', '결과: 포도당 + 산소'], keys: ['광합성', '빛에너지', '포도당', '엽록체', '이산화', '산소'] },
  { id: 'his-slide', subject: '역사', lines: ['3·1 운동 (1919년)', '민족 대표 33인 독립 선언서 발표', '탑골 공원에서 만세 시위', '→ 대한민국 임시 정부 수립'], keys: ['1919년', '33인', '독립', '탑골', '임시'] },
  { id: 'kor-slide', subject: '국어', lines: ['비유법', '직유법: ~같이, ~처럼', '은유법: A는 B이다', '의인법: 사람이 아닌 것을 사람처럼'], keys: ['비유법', '직유법', '은유법', '의인법'] },
  { id: 'soc-slide', subject: '사회', lines: ['수요와 공급', '가격이 오르면 수요량은 감소', '가격이 오르면 공급량은 증가', '균형 가격: 수요량 = 공급량'], keys: ['수요', '공급', '감소', '증가', '균형'] },
];
// 시험용: 추천 규칙을 고칠 때 한 번도 보지 않은 판. 마지막에 한 번만 잰다(eval/RESULTS.md).
export const HELDOUT = [
  { id: 'sci2', subject: '과학', lines: ['세포 분열', '체세포 분열: 염색체 수가 같은 두 세포', '감수 분열: 염색체 수가 절반', '생식세포를 만들 때 일어남'], keys: ['세포', '체세포', '염색체', '감수', '절반', '생식세포'] },
  { id: 'geo', subject: '사회', lines: ['기후', '열대 기후: 1년 내내 덥고 비가 많음', '건조 기후: 강수량이 증발량보다 적음', '온대 기후 → 사계절이 뚜렷함'], keys: ['기후', '열대', '건조', '강수량', '증발량', '온대', '사계절'] },
  { id: 'his2', subject: '역사', lines: ['조선 건국 (1392년)', '이성계가 위화도 회군으로 권력 장악', '한양으로 도읍을 옮김', '성리학을 통치 이념으로'], keys: ['1392년', '이성계', '위화도', '한양', '성리학'] },
  { id: 'eng', subject: '영어', lines: ['현재완료', 'have + p.p.', '경험: I have visited Jeju.', '계속: She has lived here for 3 years.'], keys: ['현재완료', 'have', '경험', '계속', 'visited', 'lived'] },
  { id: 'math', subject: '수학', lines: ['일차함수', 'y = ax + b', '기울기: a', 'y절편: b (x = 0일 때 y의 값)'], keys: ['일차함수', '기울기', '절편'] },
];
const STYLES = {
  slide: { bg: '#ffffff', fg: '#1b1b1b', font: 'S', size: 44, title: 64 },
  white: { bg: '#f3f3ef', fg: '#1d3fa8', font: 'P', size: 60, title: 80 },
  chalk: { bg: '#2f4a3a', fg: '#eef2ea', font: 'P', size: 60, title: 80 },
};

// hard: 교실 뒤쪽 비스듬한 자리에서 찍은 것처럼 — 원근, 한쪽 그늘, 형광등 반사, 흔들림
function html(board, style, tilt, extra = '') {
  const s = STYLES[style];
  const fam = s.font === 'P' ? 'Pen' : 'Sans';
  return `<html><head><style>
  @font-face{font-family:Pen;src:url(data:font/woff2;base64,${PEN})}
  @font-face{font-family:Sans;src:url(data:font/woff2;base64,${SANS})}
  @font-face{font-family:Sans;font-weight:700;src:url(data:font/woff2;base64,${SANSB})}
  body{margin:0;background:#777}
  #b{width:1600px;height:1000px;background:${s.bg};color:${s.fg};font-family:${fam};padding:70px 90px;box-sizing:border-box;
     transform:${extra === 'hard' ? 'perspective(1400px) rotateY(-18deg) rotateX(6deg) scale(.9)' : `rotate(${tilt}deg) scale(.96)`};transform-origin:center;${extra === 'hard' ? 'filter:blur(1.2px);' : ''}${style === 'chalk' ? 'text-shadow:0 0 2px rgba(255,255,255,.5);' : ''}}
  h1{font-size:${s.title}px;margin:0 0 40px;font-weight:700} p{font-size:${s.size}px;margin:0 0 28px}
  #g{position:fixed;inset:0;z-index:2;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.45),transparent 55%),radial-gradient(circle at 70% 30%,rgba(255,255,255,.55),transparent 18%)}
  </style></head><body>${extra === 'hard' ? '<div id="g"></div>' : ''}<div id="b"><h1>${board.lines[0]}</h1>${board.lines.slice(1).map((l) => `<p>${l}</p>`).join('')}</div></body></html>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
const heldout = process.argv.includes('--heldout');
const dir = heldout ? './heldout/' : './fixtures/';
mkdirSync(new URL(dir, import.meta.url), { recursive: true });
const CONDS = heldout
  ? [['clean', 0, 92, ''], ['tilt-jpeg', 2.5, 35, ''], ['hard', 0, 40, 'hard']]
  : [['clean', 0, 92, ''], ['tilt-jpeg', 2.5, 35, '']];
const index = [];
for (const b of heldout ? HELDOUT : BOARDS) for (const style of Object.keys(STYLES)) for (const [cond, tilt, q, extra] of CONDS) {
  await page.setContent(html(b, style, tilt, extra));
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'jpeg', quality: q });
  const file = `${b.id}-${style}-${cond}.jpg`;
  writeFileSync(new URL(`${dir}${file}`, import.meta.url), buf);
  index.push({ file, board: b.id, style, cond, keys: b.keys, subject: b.subject });
}
writeFileSync(new URL(`${dir}index.json`, import.meta.url), JSON.stringify(index, null, 1));
await browser.close();
console.log(`${index.length}장 생성`);
