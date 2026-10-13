import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const supplied = process.argv[2] || process.env.BASE_URL;
if (!supplied) throw new Error('Usage: node coop-browser-test.mjs <BASE_URL> (or set BASE_URL)');
const parsed = new URL(supplied);
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
if (isLocal && !parsed.searchParams.has('coopIce')) parsed.searchParams.set('coopIce', 'local');
const baseURL = parsed.href;
const livePublic = !isLocal;

const fixture = () => JSON.stringify({
  version: 1, reason: 'rhythm', energy: 200, distance: 0, experience: 0, insight: 0,
  connection: 4, joy: 3, perspective: 0, chapter: 1, boostUntil: 0, restReadyAt: 0,
  upgrades: { steadyShoes: 0, trailNotes: 0, openWindow: 0 },
  permanent: { patience: 0, curiosity: 0, momentum: 0 },
  decisionHistory: [], unlockedDecisions: [], milestonesSeen: [], runDecision: null, canPrestige: false,
  lastSavedAt: Date.now(), totalRealSeconds: 0, runs: 0,
});

const browser = await chromium.launch({ headless: true });
const contexts = [await browser.newContext(), await browser.newContext()];
const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
const errors = [];
for (const [name, page] of [['host', host], ['guest', guest]]) {
  page.on('pageerror', (error) => errors.push(`${name} pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${name} console: ${message.text()}`); });
}

const status = (page) => page.locator('[data-status]');
const offer = (page) => page.locator('[data-offer]');
const answer = (page) => page.locator('[data-answer]');
const total = (page) => page.locator('[data-total]');
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const stat = (page, name) => page.locator(`[data-stat="${name}"]`);
const waitText = async (locator, expression, timeout = 15_000) => {
  await locator.waitFor({ state: 'visible', timeout });
  await locator.page().waitForFunction(({ selector, source, flags }) => {
    const node = document.querySelector(selector);
    return node && new RegExp(source, flags).test(node.textContent || '');
  }, { selector: await locator.evaluate((node) => node.matches('[data-status]') ? '[data-status]' : '[data-total]'), source: expression.source, flags: expression.flags }, { timeout });
};
const waitValue = async (locator, type, timeout = 15_000) => {
  await locator.page().waitForFunction(({ selector, type }) => {
    const node = document.querySelector(selector);
    if (!node?.value) return false;
    try { return JSON.parse(atob(node.value)).type === type; } catch { return false; }
  }, { selector: type === 'offer' ? '[data-offer]' : '[data-answer]', type }, { timeout });
  return locator.inputValue();
};

async function enterAndFund(page) {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  const reason = page.getByRole('button', { name: 'Find a rhythm' });
  if (await reason.isVisible()) await reason.click();
  await page.locator('#save-data').fill(fixture());
  await page.getByRole('button', { name: 'Import save' }).click();
  await page.getByText('Save imported. Welcome back to this path.').waitFor({ state: 'visible' });
  assert.equal((await stat(page, 'joy').textContent()).trim(), '3');
  assert.equal((await stat(page, 'connection').textContent()).trim(), '4');
}

async function connect(hostPage, guestPage) {
  await action(hostPage, 'host').click();
  const invitation = await waitValue(offer(hostPage), 'offer');
  await action(guestPage, 'guest').click();
  await offer(guestPage).fill(invitation);
  await action(guestPage, 'answer').click();
  const response = await waitValue(answer(guestPage), 'answer');
  await answer(hostPage).fill(response);
  await action(hostPage, 'apply-answer').click();
  await Promise.all([
    status(hostPage).filter({ hasText: 'Peer identity validated' }).waitFor({ timeout: 20_000 }),
    status(guestPage).filter({ hasText: 'Peer identity validated' }).waitFor({ timeout: 20_000 }),
  ]);
}

try {
  await Promise.all([enterAndFund(host), enterAndFund(guest)]);

  // Visible-control signaling mistakes: empty, self-offer, and wrong type all reject locally.
  await action(guest, 'guest').click();
  await action(guest, 'answer').click();
  assert.match(await status(guest).textContent(), /Invalid invitation text/i);
  await action(guest, 'host').click();
  const selfOffer = await waitValue(offer(guest), 'offer');
  await action(guest, 'guest').click();
  await offer(guest).fill(selfOffer);
  await action(guest, 'answer').click();
  assert.match(await status(guest).textContent(), /own invitation/i);
  await action(guest, 'host').click();
  const wrongKind = await waitValue(offer(guest), 'offer');
  await answer(guest).fill(wrongKind);
  await action(guest, 'apply-answer').click();
  assert.match(await status(guest).textContent(), /valid answer invitation/i);
  await action(guest, 'disconnect').click();

  await connect(host, guest);
  for (let i = 1; i <= 10; i += 1) {
    const page = i % 2 ? host : guest;
    await action(page, 'contribute').click();
    await Promise.all([waitText(total(host), new RegExp(`^${i * 10} / 100 energy$`)), waitText(total(guest), new RegExp(`^${i * 10} / 100 energy$`))]);
  }
  for (const page of [host, guest]) {
    assert.equal((await stat(page, 'joy').textContent()).trim(), '23');
    assert.equal((await stat(page, 'connection').textContent()).trim(), '14');
  }
  await action(host, 'reset-round').click();
  await Promise.all([waitText(total(host), /^0 \/ 100 energy$/), waitText(total(guest), /^0 \/ 100 energy$/)]);

  await action(guest, 'disconnect').click();
  await status(host).filter({ hasText: /disconnected/i }).waitFor({ timeout: 10_000 });
  await action(host, 'host').click();
  await waitValue(offer(host), 'offer');
  assert.match(await status(host).textContent(), /Invitation ready/i);
  assert.equal(errors.length, 0, errors.join('\n'));

  if (livePublic) await host.screenshot({ path: '/home/hp/game/proof-live.png', fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    url: baseURL,
    mode: livePublic ? 'public-production-stun' : 'local-no-stun',
    verified: ['visible onboarding/import', 'empty/self/wrong-type local rejection', 'manual offer/answer', 'two-way contributions to 100', 'Joy +20 and Connection +10 exactly once', 'round reset', 'disconnect and re-host cleanup', 'zero page/console errors'],
    screenshot: livePublic ? '/home/hp/game/proof-live.png' : null,
  }, null, 2));
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser.close();
}
