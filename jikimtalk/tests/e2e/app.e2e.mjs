// 화면 테스트: 진짜 Chromium에서 예시 → 나 고르기 → 검토 → 기록, 파일 넣기, 폰 폭, 밖으로 나간 요청.
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import assert from 'node:assert/strict';

const server = await preview({ preview: { port: 4188, strictPort: true }, logLevel: 'silent' });
const BASE = 'http://localhost:4188/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errors = [], foreign = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u); });

let passed = 0;
const step = async (name, fn) => { const t = Date.now(); await fn(); passed++; console.log(`  ✓ ${name} (${Date.now() - t}ms)`); };
const shot = (n) => page.screenshot({ path: `docs/img/${n}.png`, fullPage: false });

await page.goto(BASE);

await step('처음: 파일 넣기·예시·내보내는 법·도움 번호', async () => {
  await page.getByText('대화 파일 넣기').waitFor();
  await page.getByText('카톡에서 대화 내보내기').waitFor();
  await page.getByRole('button', { name: '117 복사' }).waitFor();
  await shot('start');
});

await step('예시 → 나 고르기(예시는 김민지가 골라져 있음)', async () => {
  await page.getByTestId('sample').click();
  await page.getByText('누가 나예요?').waitFor();
  assert.equal(await page.getByRole('radio', { name: /김민지/ }).getAttribute('aria-checked'), 'true');
  await page.getByText('예시 대화 — 지어낸 이름이에요').waitFor();
  await shot('pick');
});

await step('정리: 심각·주의·사건·사람별, 나를 향한 말만 기본', async () => {
  await page.getByTestId('analyze').click();
  await page.getByText('방에서 일어난 일').first().waitFor();
  for (const t of ['카톡감옥', '방폭', '떼카']) await page.locator('.ename', { hasText: t }).first().waitFor();
  const n = await page.getByTestId('flag').count();
  assert.ok(n >= 12, `표시 ${n}건`);
  assert.equal(await page.locator('.said', { hasText: '아 시발 나 보고서' }).count(), 0); // 친구끼리 장난은 기본 목록에 없음
  await shot('review');
  await page.getByText(/^모든 표시/).click();
  await page.locator('.said', { hasText: '아 시발 나 보고서' }).waitFor();
  await page.getByText(/^나를 향한 말/).click();
});

await step('체크를 풀면 기록에서 빠진다', async () => {
  const before = Number((await page.locator('.count').textContent()).match(/\d+/)[0]);
  const first = page.getByTestId('flag').filter({ hasText: '너 말고 다 알아' });
  await first.getByRole('checkbox').uncheck();
  const after = Number((await page.locator('.count').textContent()).match(/\d+/)[0]);
  assert.equal(after, before - 1);
  await first.getByText('앞뒤 대화 보기').click();
  await first.getByText(/박서준: 아무도 안 물어봄/).waitFor();
});

await step('기록: 원문·지문·사건이 들어가고, 뺀 말은 ▶ 표시 없음, 복사된다', async () => {
  await page.getByTestId('to-report').click();
  const text = await page.getByTestId('report').textContent();
  assert.match(text, /SHA-256: [0-9a-f]{64}/);
  assert.ok(text.includes('▶ [14:21] 박서준: 그럼 학교에서 보자'));
  assert.ok(!text.includes('▶ [16:13] 최도윤: 너 말고 다 알아'));
  assert.ok(text.includes('카톡감옥'));
  await shot('report');
  await page.getByText('글 복사').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clip, text);
});

await step('내 파일 넣기(아이폰 모양) + 내 말에 위험 신호가 있으면 도움부터', async () => {
  await page.goto(BASE);
  const ios = [
    '우리반 님과 카카오톡 대화', '저장한 날짜 : 2026. 9. 15. 오후 9:02', '',
    '2026. 9. 2. 오후 9:30, 나 : 그만해',
    '2026. 9. 2. 오후 9:31, 가 : 너 진짜 꺼져',
    '2026. 9. 2. 오후 9:32, 나 : 진짜 죽고 싶다',
    '2026. 9. 2. 오후 9:33, 다 : 뛰어내려',
  ].join('\n');
  await page.locator('#file').setInputFiles({ name: 'KakaoTalk_우리반.txt', mimeType: 'text/plain', buffer: Buffer.from(ios) });
  await page.getByRole('radio', { name: /^나/ }).click();
  await page.getByTestId('analyze').click();
  await page.getByText('많이 힘들었겠어요.').waitFor();
  await page.locator('.sev.l3').first().waitFor();
  await shot('care');
});

await step('카톡 파일이 아니면 알려 준다', async () => {
  await page.goto(BASE);
  await page.locator('#file').setInputFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('그냥 메모\n장보기 목록') });
  await page.getByText(/카톡 대화 파일로 읽지 못했어요/).waitFor();
});

await step('폰 폭 360px에서 가로 스크롤 없음', async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(BASE);
  await page.getByTestId('sample').click();
  const check = async (where) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${where} 가로 넘침 ${over}px`);
  };
  await check('나 고르기');
  await page.getByTestId('analyze').click();
  await page.getByText('방에서 일어난 일').first().waitFor();
  await check('검토');
  await page.getByTestId('to-report').click();
  await check('기록');
});

await step('밖으로 나간 요청 0건, 콘솔 오류 0건', async () => {
  assert.deepEqual(foreign, []);
  assert.deepEqual(errors, []);
});

await browser.close();
await new Promise((r) => server.httpServer.close(r));
console.log(`\n화면 테스트 ${passed}개 통과`);
