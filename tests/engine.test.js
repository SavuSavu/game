import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, chooseReason, tick, activateBoost, performActivity,
  buyUpgrade, perspectiveCost, chooseDecision, prestige,
  serializeState, importState, applyOffline, getWorldEvent, getMilestones,
  getReasonStory, getChapterGoal, validateState, migrateState
} from '../engine.js';

test('a chosen beginning starts the walk and ticking earns distance and energy', () => {
  let state = chooseReason(createState(0), 'create');
  state = tick(state, 10, 10_000);
  assert.equal(state.reason, 'create');
  assert.ok(state.distance >= 10);
  assert.ok(state.energy > 10);
});

test('a step boost is temporary and expires', () => {
  let state = chooseReason(createState(0), 'joy');
  state.energy = 20;
  state = activateBoost(state, 0);
  assert.equal(state.energy, 15);
  const during = tick(state, 5, 5_000);
  const after = tick(during, 20, 25_000);
  assert.ok(during.distance > 10);
  assert.equal(after.boostUntil, 0);
});

test('all six activities grant meaningful rewards including rest and play', () => {
  for (const activity of ['learn', 'create', 'rest', 'help', 'reflect', 'play']) {
    let state = chooseReason(createState(0), 'rhythm');
    state.energy = 100;
    const next = performActivity(state, activity);
    assert.ok(next.energy !== state.energy || next.joy > state.joy);
    assert.ok(next.experience + next.insight + next.connection + next.joy > 0);
  }
  let tired = chooseReason(createState(0), 'direction');
  tired.energy = 0;
  assert.ok(performActivity(tired, 'rest').energy > 0);
  tired.energy = 20;
  assert.ok(performActivity(tired, 'play').joy > 0);
});

test('ordinary upgrades idle faster, reject insufficient funds, and increase costs', () => {
  let state = chooseReason(createState(0), 'new');
  const unchanged = buyUpgrade(state, 'steadyShoes');
  assert.deepEqual(unchanged, state);
  state.energy = 100;
  const upgraded = buyUpgrade(state, 'steadyShoes');
  assert.equal(upgraded.upgrades.steadyShoes, 1);
  assert.ok(upgraded.energy < 100);
  const upgradedGain = tick(upgraded, 10, 10_000).energy - upgraded.energy;
  const baseGain = tick(state, 10, 10_000).energy - state.energy;
  assert.ok(upgradedGain > baseGain);
});

test('decisions unlock through milestones and choices make different tradeoffs', () => {
  let state = chooseReason(createState(0), 'reconnect');
  state.distance = 60;
  const before = structuredClone(state);
  const focused = chooseDecision(state, 'focus');
  const open = chooseDecision(before, 'open');
  assert.equal(focused.runDecision, 'focus');
  assert.equal(open.runDecision, 'open');
  assert.notEqual(focused.insight, open.insight);
  assert.ok(getMilestones(focused).some(m => m.reached));
});

test('perspective costs rise and prestige fully resets run state while preserving identity and permanent progress', () => {
  let state = chooseReason(createState(0), 'create');
  state.distance = 300;
  state.energy = 500;
  state.experience = 50;
  state.upgrades.steadyShoes = 4;
  state.experience = 20;
  state.joy = 15;
  state = chooseDecision(state, 'focus');
  state = tick(state, 0, 998);
  state.perspective = 3;
  state.permanent.patience = 1;
  assert.ok(perspectiveCost('patience', 2) > perspectiveCost('patience', 1));
  const next = prestige(state, 999);
  assert.equal(next.reason, 'create');
  assert.deepEqual(next.decisionHistory, ['1:focus']);
  assert.equal(next.permanent.patience, 1);
  assert.ok(next.perspective > 3);
  assert.equal(next.distance, 0);
  assert.equal(next.energy, 0);
  assert.equal(next.upgrades.steadyShoes, 0);
  assert.equal(next.chapter, 2);
});

test('fast forwarding reaches the first decision but goal and choice gate prestige', () => {
  let state = chooseReason(createState(0), 'direction');
  state = tick(state, 310, 310_000);
  assert.ok(state.distance >= 300);
  assert.ok(state.unlockedDecisions.includes('crossroads'));
  assert.equal(state.canPrestige, false);
});

test('save import validates data and refuses corruption', () => {
  const state = chooseReason(createState(10), 'joy');
  const restored = importState(serializeState(state), 100);
  assert.equal(restored.reason, 'joy');
  assert.throws(() => importState('{"version":1,"energy":"many"}', 100), /Invalid save/);
  assert.throws(() => importState('not json', 100), /Invalid save/);
  assert.throws(() => importState(JSON.stringify({ ...state, upgrades: {} }), 100), /Invalid save/);
});

test('offline catchup is capped and never penalizes absence', () => {
  let state = chooseReason(createState(0), 'rhythm');
  state.lastSavedAt = 0;
  const caught = applyOffline(state, 99_999_999);
  assert.ok(caught.offlineSeconds <= 14_400);
  assert.ok(caught.energy >= state.energy);
  assert.ok(caught.distance >= state.distance);
});

test('UTC world events are deterministic and contain no fake contribution count', () => {
  const a = getWorldEvent(Date.UTC(2026, 0, 1));
  const b = getWorldEvent(Date.UTC(2026, 0, 1, 12));
  assert.equal(a.id, b.id);
  assert.equal('globalContributions' in a, false);
  assert.match(a.endsAt, /Z$/);
});

test('UTC event bonuses are applied to their advertised activity', () => {
  const now = Date.UTC(2026, 0, 1, 12);
  const event = getWorldEvent(now);
  let state = chooseReason(createState(now), 'create');
  state.energy = 100;
  const normal = performActivity(state, event.activity, now + 86_400_000);
  const featured = performActivity(state, event.activity, now);
  assert.ok(featured.energy > normal.energy || featured.insight > normal.insight || featured.joy > normal.joy);
});

test('rest has a short cooldown and becomes available again after time passes', () => {
  let state = chooseReason(createState(0), 'rhythm');
  const rested = performActivity(state, 'rest', 1_000);
  assert.ok(rested.energy > 0);
  assert.equal(performActivity(rested, 'rest', 2_000), rested);
  assert.ok(performActivity(rested, 'rest', rested.restReadyAt).energy > rested.energy);
});

test('each reason has distinct opening copy and a meaningful chapter goal', () => {
  const stories = new Set();
  for (const reason of ['create','reconnect','new','rhythm','joy','direction']) {
    const state = chooseReason(createState(0), reason);
    stories.add(getReasonStory(state).opening);
    const goal = getChapterGoal(state);
    assert.ok(goal.description.length > 10);
    assert.ok(Object.keys(goal.requirements).length > 0);
  }
  assert.equal(stories.size, 6);
});

test('a completed decision and reason goal are both required before prestige', () => {
  let state = chooseReason(createState(0), 'joy');
  state.distance = 300;
  state = tick(state, 0, 1);
  assert.equal(state.canPrestige, false);
  state.joy = 25;
  state = chooseDecision(state, 'open');
  state = tick(state, 0, 2);
  assert.equal(state.canPrestige, true);
});

test('each new chapter offers another decision while preserving prior history', () => {
  let state = chooseReason(createState(0), 'create');
  state.distance = 300; state.experience = 20; state.joy = 15;
  state = chooseDecision(state, 'focus');
  state = tick(state, 0, 1);
  state = prestige(state, 2);
  assert.equal(state.chapter, 2);
  assert.deepEqual(state.decisionHistory, ['1:focus']);
  state.distance = 60;
  state = tick(state, 0, 3);
  assert.ok(state.unlockedDecisions.includes('crossroads'));
  state = chooseDecision(state, 'open');
  assert.deepEqual(state.decisionHistory, ['1:focus', '2:open']);
});

test('validation rejects every missing or malformed engine field', () => {
  const valid = chooseReason(createState(0), 'create');
  assert.equal(validateState(valid), true);
  for (const key of Object.keys(valid)) {
    const broken = structuredClone(valid); delete broken[key];
    assert.equal(validateState(broken), false, `missing ${key}`);
  }
  for (const key of ['energy','boostUntil','totalRealSeconds','runs','chapter']) {
    const broken = structuredClone(valid); broken[key] = NaN;
    assert.equal(validateState(broken), false, key);
  }
  for (const key of ['decisionHistory','unlockedDecisions','milestonesSeen']) {
    const broken = structuredClone(valid); broken[key] = [3];
    assert.equal(validateState(broken), false, key);
  }
  assert.equal(validateState({ ...valid, canPrestige: 1 }), false);
  assert.equal(validateState({ ...valid, chapter: 1.5 }), false);
  assert.equal(validateState({ ...valid, upgrades: { ...valid.upgrades, steadyShoes: 1.2 } }), false);
});

test('explicit migration upgrades a valid prior v1 save but not arbitrary missing data', () => {
  const old = chooseReason(createState(0), 'create');
  delete old.restReadyAt; delete old.runDecision;
  old.decisionHistory = ['focus']; old.chapter = 2;
  const migrated = migrateState(old);
  assert.equal(validateState(migrated), true);
  assert.deepEqual(migrated.decisionHistory, ['1:focus']);
  const corrupt = structuredClone(old); delete corrupt.energy;
  assert.equal(migrateState(corrupt), null);
});
