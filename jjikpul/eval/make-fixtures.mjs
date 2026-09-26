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
const STYLES = {
  slide: { bg: '#ffffff', fg: '#1b1b1b', font: 'S', size: 44, title: 64 },
  white: { bg: '#f3f3ef', fg: '#1d3fa8', font: 'P', size: 60, title: 80 },
  chalk: { bg: '#2f4a3a', fg: '#eef2ea', font: 'P', size: 60, title: 80 },
};

function html(board, style, tilt) {
  const s = STYLES[style];
  const fam = s.font === 'P' ? 'Pen' : 'Sans';
  return `<html><head><style>
  @font-face{font-family:Pen;src:url(data:font/woff2;base64,${PEN})}
  @font-face{font-family:Sans;src:url(data:font/woff2;base64,${SANS})}
  @font-face{font-family:Sans;font-weight:700;src:url(data:font/woff2;base64,${SANSB})}
  body{margin:0;background:#777}
  #b{width:1600px;height:1000px;background:${s.bg};color:${s.fg};font-family:${fam};padding:70px 90px;box-sizing:border-box;
     transform:rotate(${tilt}deg) scale(.96);transform-origin:center;${style === 'chalk' ? 'text-shadow:0 0 2px rgba(255,255,255,.5);' : ''}}
  h1{font-size:${s.title}px;margin:0 0 40px;font-weight:700} p{font-size:${s.size}px;margin:0 0 28px}
  </style></head><body><div id="b"><h1>${board.lines[0]}</h1>${board.lines.slice(1).map((l) => `<p>${l}</p>`).join('')}</div></body></html>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
const index = [];
for (const b of BOARDS) for (const style of Object.keys(STYLES)) for (const [cond, tilt, q] of [['clean', 0, 92], ['tilt-jpeg', 2.5, 35]]) {
  await page.setContent(html(b, style, tilt));
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'jpeg', quality: q });
  const file = `${b.id}-${style}-${cond}.jpg`;
  writeFileSync(new URL(`./fixtures/${file}`, import.meta.url), buf);
  index.push({ file, board: b.id, style, cond, keys: b.keys, subject: b.subject });
}
writeFileSync(new URL('./fixtures/index.json', import.meta.url), JSON.stringify(index, null, 1));
await browser.close();
console.log(`${index.length}장 생성`);
