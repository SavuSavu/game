import { test, expect } from '@playwright/test';

async function begin(page, reason = 'Create something') {
  await page.goto('/');
  await page.getByRole('button', { name: reason }).click();
  await expect(page.getByRole('heading', { name: /your walk/i })).toBeVisible();
}
function fixture(reason = 'create', values = {}) {
  return JSON.stringify({ version:1,reason,energy:0,distance:0,experience:0,insight:0,connection:0,joy:0,perspective:0,chapter:1,boostUntil:0,restReadyAt:0,upgrades:{steadyShoes:0,trailNotes:0,openWindow:0},permanent:{patience:0,curiosity:0,momentum:0},decisionHistory:[],unlockedDecisions:[],milestonesSeen:[],runDecision:null,canPrestige:false,lastSavedAt:Date.now(),totalRealSeconds:0,runs:0,...values });
}
async function importFixture(page, text) { await page.locator('#save-data').fill(text); await page.getByRole('button', { name:'Import save' }).click(); }

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.evaluate(() => localStorage.clear()); });

test('onboarding offers six beginnings and starts selected identity', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-reason]')).toHaveCount(6);
  await page.getByRole('button', { name:'Rediscover joy' }).click();
  await expect(page.locator('#reason-label')).toHaveText('Rediscover joy'); await expect(page.locator('#onboarding')).toBeHidden();
  await expect(page.locator('#walker')).toHaveAttribute('data-walking','true');
});

test('all six beginnings show a distinct opening and chapter goal', async ({ page }) => {
  const reasons=['create','reconnect','new','rhythm','joy','direction']; const openings=new Set();
  await begin(page);
  for(const reason of reasons){ await importFixture(page,fixture(reason)); openings.add(await page.locator('#story-line').textContent()); await expect(page.locator('#chapter-goal')).toContainText('Goal:'); await expect(page.locator('#chapter-goal')).toContainText(/\d+\/\d+/); }
  expect(openings.size).toBe(6);
});

test('visible boost spends energy and marks a temporary quicker step', async ({ page }) => {
  await begin(page); await importFixture(page,fixture('create',{energy:20})); const before=await page.locator('[data-stat="energy"]').textContent();
  await page.getByRole('button',{name:/quicker step/i}).click(); await expect(page.locator('#walker')).toHaveAttribute('data-boosted','true'); await expect(page.locator('[data-stat="energy"]')).not.toHaveText(before);
});

test('rest cooldown and play visibly improve resources', async ({ page }) => {
  await begin(page,'Find a rhythm'); await page.getByRole('button',{name:/^Rest/}).click(); await expect(page.getByText(/You rested/)).toBeVisible();
  await page.getByRole('button',{name:/^Rest/}).click(); await expect(page.getByText(/Rest is ready in/)).toBeVisible();
  await importFixture(page,fixture('rhythm',{energy:20,restReadyAt:Date.now()+60000})); await page.getByRole('button',{name:/^Play/}).click(); await expect(page.locator('[data-stat="joy"]')).not.toHaveText('0');
});

test('ordinary upgrade can be bought through visible control', async ({ page }) => {
  await begin(page); await importFixture(page,fixture('create',{energy:100})); await page.getByRole('button',{name:/Buy Steady shoes/}).click(); await expect(page.getByRole('button',{name:/Buy Steady shoes/})).toContainText('Level 1');
});

test('reload restores a valid local save', async ({ page }) => {
  await begin(page,'Try something new'); await importFixture(page,fixture('new',{energy:77,joy:9})); await page.reload(); await expect(page.locator('#reason-label')).toHaveText('Try something new'); await expect(page.locator('[data-stat="joy"]')).toHaveText('9');
});

test('export/import round trip works and invalid import preserves state', async ({ page }) => {
  await begin(page); await importFixture(page,fixture('create',{energy:88,insight:6})); await page.getByRole('button',{name:'Export save'}).click(); const save=await page.locator('#save-data').inputValue(); expect(save).toContain('"insight":6');
  await page.locator('#save-data').fill('broken'); await page.getByRole('button',{name:'Import save'}).click(); await expect(page.getByText(/no changes were made/i)).toBeVisible(); await page.locator('#save-data').fill(save); await page.getByRole('button',{name:'Import save'}).click(); await expect(page.locator('[data-stat="insight"]')).toHaveText('6');
});

test('production debug API is absent unless localhost explicitly opts in', async ({ page }) => {
  await page.goto('/'); expect(await page.evaluate(() => window.gameDebug)).toBeUndefined(); await page.goto('/?test=1'); expect(await page.evaluate(() => typeof window.gameDebug?.get)).toBe('function');
});

test('visible decision, prestige, permanent purchase and next-run decision work through imported saves', async ({ page }) => {
  await begin(page); await importFixture(page,fixture('create',{energy:100,distance:300,experience:20,joy:15,unlockedDecisions:['crossroads']})); await expect(page.locator('#decision')).toBeVisible();
  await page.getByRole('button',{name:/Follow one thread/}).click(); await expect(page.locator('#prestige')).toBeEnabled(); await page.locator('#prestige').click(); await expect(page.locator('#chapter')).toHaveText('2'); await expect(page.locator('[data-stat="perspective"]')).toHaveText('1');
  await page.getByRole('button',{name:/Buy permanent Patience/}).click(); await expect(page.getByRole('button',{name:/Buy permanent Patience/})).toContainText('Level 1');
  await importFixture(page,fixture('create',{chapter:2,distance:60,permanent:{patience:1,curiosity:0,momentum:0},decisionHistory:['1:focus'],unlockedDecisions:['crossroads']})); await expect(page.locator('#decision')).toBeVisible(); await page.getByRole('button',{name:/Stay open to company/}).click(); await page.getByRole('button',{name:'Export save'}).click(); await expect(page.locator('#save-data')).toHaveValue(/"decisionHistory":\["1:focus","2:open"\]/);
});

test('mobile layout keeps primary controls visible and has no console errors', async ({ page }) => {
  const errors=[]; page.on('console',message=>{if(message.type()==='error')errors.push(message.text());}); await page.setViewportSize({width:390,height:844}); await begin(page,'Find direction'); await expect(page.getByRole('button',{name:/quicker step/i})).toBeVisible(); await expect(page.locator('#coop')).toBeVisible(); expect(errors).toEqual([]);
});
