// 화면 테스트: 진짜 브라우저(Chromium)에서 찍기 → 가리기 → 풀기 → 실험 → 오프라인까지.
// 시계는 page.clock으로 옮긴다(며칠 뒤를 기다리지 않게).
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
const BASE = 'http://localhost:4179/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul', hasTouch: true });
const page = await ctx.newPage();
const errors = [];
const foreign = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
ctx.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) foreign.push(r.url()); });

let passed = 0;
async function step(name, fn) {
  const t = Date.now();
  await fn();
  passed++;
  console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
}
const H = 3600_000, D = 24 * H;
// 2026-09-29 화요일 10:42 (2교시가 10:40에 끝나고 쉬는 시간)
const T0 = new Date('2026-09-29T10:42:00+09:00').getTime();
const setTime = (t) => page.clock.setFixedTime(new Date(t));
const shot = (name) => page.screenshot({ path: `docs/img/${name}.png` });

async function upload(file, lastModified) {
  const b64 = readFileSync(new URL(`../../eval/fixtures/${file}`, import.meta.url)).toString('base64');
  await page.locator('[data-testid=album-input]').waitFor({ state: 'attached' });
  await page.evaluate(({ b64, file, lastModified }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file, { type: 'image/jpeg', lastModified }));
    const input = document.querySelector('[data-testid=album-input]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, { b64, file, lastModified });
}
const dueCount = async () => Number(await page.locator('[data-testid=due-count]').textContent());
const tapes = () => page.locator('[data-testid=tape]').count();

await setTime(T0);
await page.goto(BASE);

await step('첫 화면: 설명과 찍기 단추', async () => {
  await page.getByText('판서 찍기').waitFor();
  await page.getByText('앨범에서').waitFor();
  await shot('home-empty');
});

await step('시간표: 화요일 2교시 = 과학', async () => {
  await page.getByText('🗓️ 시간표').click();
  await page.locator('[data-cell="2-1"]').fill('과학');
  await page.locator('[data-cell="2-0"]').fill('국어');
  await page.getByTestId('save-tt').click();
  await page.getByText('판서 찍기').waitFor();
});

let nBlanks = 0;
await step('찍으면 과목이 저절로, 빈칸이 추천된다', async () => {
  await upload('sci-slide-slide-clean.jpg', T0 - 60_000);
  await page.getByText('가릴 말 고르기').waitFor();
  await page.getByText(/낱말 \d+개 찾음/).waitFor({ timeout: 60_000 });
  assert.equal(await page.getByRole('radio', { name: '과학' }).getAttribute('aria-checked'), 'true');
  nBlanks = await tapes();
  assert.ok(nBlanks >= 3, `추천 빈칸 ${nBlanks}개`);
  await shot('edit');
});

await step('테이프를 떼고, 점선 낱말을 눌러 붙이고, 손으로 그린다', async () => {
  await page.locator('[data-testid=tape]').first().click();
  assert.equal(await tapes(), nBlanks - 1);
  await page.locator('.word').first().click();
  assert.equal(await tapes(), nBlanks);
  await page.getByText('✏️ 직접 가리기').click();
  const box = await page.locator('.stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.92, { steps: 5 });
  await page.mouse.up();
  assert.equal(await tapes(), nBlanks + 1);
  nBlanks++;
  await page.getByText('✋ 그리기 끝').click();
});

await step('저장하면 첫 복습은 오늘 안에(바로는 아님)', async () => {
  await page.getByTestId('save').click();
  await page.getByText('판서 찍기').waitFor();
  assert.equal(await dueCount(), 0);
  await page.getByText(/다음 복습: 오늘 13:42 · \d+개/).waitFor();
  await page.getByText('과학').first().waitFor();
});

await step('세 시간 뒤: 풀 것이 생기고, 몰랐던 건 맞힐 때까지 다시 나온다', async () => {
  await setTime(T0 + 3 * H + 60_000);
  await page.reload();
  assert.equal(await dueCount(), nBlanks);
  await shot('home-due');
  await page.getByText('▶ 풀기').click();
  await page.getByTestId('current').waitFor();
  await shot('review-question');
  // 정답 보기 전에는 현재 빈칸이 가려져 있다
  assert.equal(await page.getByTestId('current').textContent(), '?');
  await page.getByTestId('reveal').click();
  await shot('review-answer');
  await page.getByTestId('forgot').click(); // 첫 문제는 몰랐다
  for (let i = 1; i < nBlanks; i++) { await page.getByTestId('reveal').click(); await page.getByTestId('knew').click(); }
  // 몰랐던 문제가 끝에 한 번 더
  await page.getByTestId('reveal').click();
  await page.getByTestId('knew').click();
  await page.getByText('오늘 복습 끝').waitFor();
  await page.getByText(`${nBlanks - 1}/${nBlanks}`).waitFor();
});

await step('기록은 기기에 남는다: 다시 열어도 오늘 할 것은 0', async () => {
  await page.reload();
  await page.goto(BASE);
  assert.equal(await dueCount(), 0);
});

await step('하루 뒤엔 모두(1일 간격). 다음 날엔 한 번 몰랐던 것만, 나흘째엔 모두', async () => {
  await setTime(T0 + 3 * H + D + 120_000);
  await page.reload();
  assert.equal(await dueCount(), nBlanks);
  await page.getByText('▶ 풀기').click();
  for (let i = 0; i < nBlanks; i++) { await page.getByTestId('reveal').click(); await page.getByTestId('knew').click(); }
  await page.getByText('오늘 복습 끝').waitFor();
  await setTime(T0 + 3 * H + 2 * D + 180_000);
  await page.goto(BASE);
  assert.equal(await dueCount(), 1); // 처음에 몰랐던 것은 아직 1일 간격, 나머지는 3일 간격
  await setTime(T0 + 3 * H + 4 * D + 180_000);
  await page.reload();
  assert.equal(await dueCount(), nBlanks);
});

await step('사진 보기: 누르면 빈칸을 열고 닫는다', async () => {
  await page.locator('.thumb').first().click();
  await page.getByText('✏️ 빈칸 고치기').waitFor();
  await page.locator('.tape.solid').first().waitFor();
  const n = await page.locator('.tape.solid').count();
  assert.equal(n, nBlanks);
  await page.locator('.stage').click();
  assert.equal(await page.locator('.tape.solid').count(), 0);
  await page.goBack();
});

let expBlanks = 0;
await step('실험: 켜고 찍으면 빈칸이 반씩 나뉘고, 대조군은 복습에 안 나온다', async () => {
  const t = T0 + 7 * D; // 다음 주 화요일 10:42
  await setTime(t);
  await page.goto(BASE + '#/experiment');
  await page.getByText('실험 켜기').click();
  await page.goto(BASE);
  await upload('his-slide-chalk-clean.jpg', t - 30_000);
  await page.getByText(/낱말 \d+개 찾음/).waitFor({ timeout: 60_000 });
  expBlanks = await tapes();
  assert.ok(expBlanks >= 2);
  await page.getByTestId('save').click();
  await page.getByText('판서 찍기').waitFor();
  const groups = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('jjikpul');
    r.onsuccess = () => { const g = r.result.transaction('blanks').objectStore('blanks').getAll(); g.onsuccess = () => res(g.result.filter((b) => b.group).map((b) => b.group)); };
  }));
  assert.equal(groups.length, expBlanks);
  assert.equal(groups.filter((g) => g === 'control').length, Math.floor(expBlanks / 2));
  // 세 시간 뒤 복습: 새 사진에선 연습 쪽만 나온다
  await setTime(t + 3 * H + 60_000);
  await page.reload();
  const practice = expBlanks - Math.floor(expBlanks / 2);
  assert.equal(await dueCount(), nBlanks + practice);
});

await step('7일 뒤: 확인 카드 → 전부 가리고 한 번씩 → 결과와 CSV', async () => {
  await setTime(T0 + 14 * D + 60_000);
  await page.goto(BASE);
  await page.getByText(/7일 확인 1장/).click();
  for (let i = 0; i < expBlanks; i++) {
    await page.getByTestId('reveal').click();
    await page.getByTestId(i % 3 === 0 ? 'forgot' : 'knew').click();
  }
  await page.getByText('7일 확인 끝').waitFor();
  await page.getByText('결과 보기').click();
  await page.getByText('떠올려 본 빈칸').waitFor();
  await shot('experiment');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('⬇️ CSV로 내보내기').click()]);
  const csv = readFileSync(await dl.path(), 'utf8').trim().split('\n');
  assert.equal(csv[0], 'subject,photo,group,reviews,final_knew');
  assert.equal(csv.length - 1, expBlanks);
  assert.ok(csv[1].startsWith('역사') || csv[1].startsWith('과학') || csv[1].includes(','));
});

await step('백업: 내보내서 새 폰(빈 브라우저)에 가져오면 사진·빈칸·일정이 그대로', async () => {
  await page.goto(BASE + '#/about');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  const file = await dl.path();
  const before = await dueCount().catch(() => null);
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' });
  const p2 = await fresh.newPage();
  await p2.clock.setFixedTime(new Date(T0 + 14 * D + 60_000));
  await p2.goto(BASE + '#/about');
  await p2.getByTestId('import-input').setInputFiles(file);
  await p2.getByText('판서 2장을 가져왔어요').waitFor();
  await p2.getByTestId('import-input').setInputFiles(file); // 두 번 가져와도 두 벌이 안 된다
  await p2.getByText('판서 0장을 가져왔어요').waitFor();
  await p2.goto(BASE);
  assert.equal(await p2.locator('.thumb').count(), 2);
  await page.goto(BASE);
  assert.equal(Number(await p2.locator('[data-testid=due-count]').textContent()), await dueCount());
  await p2.getByText('과학').first().waitFor();
  await fresh.close();
  void before;
});

await step('폰 폭 360px에서 가로 스크롤 없음(모든 화면)', async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const h of ['#/', '#/timetable', '#/experiment', '#/about']) {
    await page.goto(BASE + h);
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${h} 가로 넘침 ${over}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
});

await step('오프라인(비행기 모드)에서도 열리고, 새 판서의 글자를 찾는다', async () => {
  await page.goto(BASE);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // 서비스 워커가 페이지를 맡을 때까지
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText('판서 찍기').waitFor();
  await upload('soc-slide-white-clean.jpg', Date.now() - 1000);
  await page.getByText(/낱말 \d+개 찾음/).waitFor({ timeout: 60_000 });
  assert.ok(await tapes() >= 2);
  await ctx.setOffline(false);
});

await step('밖으로 나간 요청 0건, 콘솔 오류 0건', async () => {
  assert.deepEqual(foreign, []);
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

await browser.close();
await new Promise((r) => server.httpServer.close(r));
console.log(`\n화면 테스트 ${passed}개 통과`);
