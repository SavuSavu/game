export const REASONS = [
  ['create', 'Create something'], ['reconnect', 'Reconnect'], ['new', 'Try something new'],
  ['rhythm', 'Find a rhythm'], ['joy', 'Rediscover joy'], ['direction', 'Find direction']
];

export const ACTIVITIES = {
  learn: { cost: 12, experience: 8, insight: 3, label: 'Learn' },
  create: { cost: 15, experience: 5, joy: 4, label: 'Create' },
  rest: { cost: -18, joy: 2, label: 'Rest' },
  help: { cost: 14, connection: 10, experience: 2, label: 'Help someone' },
  reflect: { cost: 10, insight: 9, label: 'Reflect' },
  play: { cost: 8, joy: 12, experience: 1, label: 'Play' }
};

export const UPGRADES = {
  steadyShoes: { label: 'Steady shoes', detail: '+0.35 energy / sec', base: 25, scale: 1.65 },
  trailNotes: { label: 'Trail notes', detail: '+0.2 m / sec', base: 45, scale: 1.75 },
  openWindow: { label: 'Open window', detail: '+1 to activity rewards', base: 70, scale: 1.8 }
};

export const PERMANENT = {
  patience: { label: 'Patience', detail: '+15% energy each run', base: 1 },
  curiosity: { label: 'Curiosity', detail: '+15% activity rewards', base: 1 },
  momentum: { label: 'Momentum', detail: '+10% walking speed', base: 2 }
};

const STORIES = {
  create: { opening: 'An unfinished idea keeps pace beside you.', goal: 'Gather material for something only you can shape.', requirements: { experience: 20, joy: 12 } },
  reconnect: { opening: 'The path bends toward people you have missed.', goal: 'Make enough room for a genuine point of contact.', requirements: { connection: 25 } },
  new: { opening: 'Today the familiar road has an unmarked turning.', goal: 'Learn enough to take the unfamiliar turn with curiosity.', requirements: { experience: 15, insight: 15 } },
  rhythm: { opening: 'You listen for a pace that can welcome both effort and rest.', goal: 'Balance reflection with moments that restore you.', requirements: { insight: 12, joy: 12 } },
  joy: { opening: 'Small bright details begin to return to view.', goal: 'Collect moments of joy without needing to justify them.', requirements: { joy: 25 } },
  direction: { opening: 'You do not need the whole map to notice the next landmark.', goal: 'Build a clearer view with both reflection and connection.', requirements: { insight: 20, connection: 10 } }
};

const numeric = ['energy','distance','experience','insight','connection','joy','perspective','chapter','boostUntil','restReadyAt','lastSavedAt','totalRealSeconds','runs'];
const arrays = ['decisionHistory','unlockedDecisions','milestonesSeen'];
const copy = state => structuredClone(state);
const finite = (value, max = 1e15) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const integer = (value, max = 1e6) => Number.isInteger(value) && value >= 0 && value <= max;

export function createState(now = Date.now()) {
  return {
    version: 1, reason: null, energy: 0, distance: 0, experience: 0, insight: 0,
    connection: 0, joy: 0, perspective: 0, chapter: 1, boostUntil: 0, restReadyAt: 0,
    upgrades: { steadyShoes: 0, trailNotes: 0, openWindow: 0 },
    permanent: { patience: 0, curiosity: 0, momentum: 0 },
    decisionHistory: [], unlockedDecisions: [], milestonesSeen: [], runDecision: null,
    canPrestige: false, lastSavedAt: now, totalRealSeconds: 0, runs: 0
  };
}

export function chooseReason(state, reason) {
  if (!REASONS.some(([id]) => id === reason) || state.reason) return state;
  const next = copy(state); next.reason = reason; return next;
}

export function getReasonStory(state) { return STORIES[state.reason] || { opening: '', goal: '', requirements: {} }; }
export function getChapterGoal(state) {
  const story = getReasonStory(state);
  const complete = Object.entries(story.requirements).every(([key, amount]) => state[key] >= amount);
  return { description: story.goal, requirements: { ...story.requirements }, complete };
}

function updateUnlocks(state) {
  if (state.distance >= 60 && !state.runDecision && !state.unlockedDecisions.includes('crossroads')) state.unlockedDecisions.push('crossroads');
  state.canPrestige = state.distance >= 300 && Boolean(state.runDecision) && getChapterGoal(state).complete;
  return state;
}

export function tick(state, seconds, now = Date.now()) {
  if (!state.reason || !finite(seconds, 14_400)) return state;
  const next = copy(state);
  const boostedSeconds = Math.min(seconds, Math.max(0, (next.boostUntil - (now - seconds * 1000)) / 1000));
  const speed = (1 + next.upgrades.trailNotes * .2) * (1 + next.permanent.momentum * .1);
  const energyRate = (1.1 + next.upgrades.steadyShoes * .35) * (1 + next.permanent.patience * .15);
  next.distance += speed * (seconds + boostedSeconds * 2);
  next.energy += energyRate * (seconds + boostedSeconds * .5);
  next.totalRealSeconds += seconds;
  if (now >= next.boostUntil) next.boostUntil = 0;
  next.lastSavedAt = now;
  return updateUnlocks(next);
}

export function activateBoost(state, now = Date.now()) {
  if (state.energy < 5) return state;
  const next = copy(state); next.energy -= 5; next.boostUntil = now + 15_000; return next;
}

export function getWorldEvent(now = Date.now()) {
  const date = new Date(now); const day = Math.floor(now / 86_400_000); const index = ((day % 3) + 3) % 3;
  const events = [
    { id: 'quiet-hour', title: 'Quiet hour', description: 'Rest restores 5 extra energy today.', activity: 'rest', bonus: { energy: 5 } },
    { id: 'open-skies', title: 'Open skies', description: 'Play grants 4 extra joy today.', activity: 'play', bonus: { joy: 4 } },
    { id: 'shared-notes', title: 'Shared notes', description: 'Learning grants 3 extra insight today.', activity: 'learn', bonus: { insight: 3 } }
  ];
  const ends = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return { ...events[index], bonus: { ...events[index].bonus }, endsAt: ends.toISOString() };
}

export function performActivity(state, id, now = Date.now()) {
  const activity = ACTIVITIES[id];
  if (!activity || (activity.cost > 0 && state.energy < activity.cost) || (id === 'rest' && now < state.restReadyAt)) return state;
  const next = copy(state);
  next.energy = Math.max(0, next.energy - activity.cost);
  const multiplier = 1 + next.permanent.curiosity * .15;
  const bonus = next.upgrades.openWindow;
  for (const key of ['experience','insight','connection','joy']) if (activity[key]) next[key] += Math.round(activity[key] * multiplier + bonus);
  const event = getWorldEvent(now);
  if (event.activity === id) for (const [key, amount] of Object.entries(event.bonus)) next[key] += amount;
  if (id === 'rest') next.restReadyAt = now + 10_000;
  return updateUnlocks(next);
}

export const upgradeCost = (id, level) => Math.ceil(UPGRADES[id].base * UPGRADES[id].scale ** level);
export function buyUpgrade(state, id) {
  if (!UPGRADES[id]) return state;
  const cost = upgradeCost(id, state.upgrades[id]);
  if (state.energy < cost) return state;
  const next = copy(state); next.energy -= cost; next.upgrades[id]++; return next;
}

export const perspectiveCost = (id, level) => Math.ceil(PERMANENT[id].base * 1.75 ** level);
export function buyPermanent(state, id) {
  if (!PERMANENT[id]) return state;
  const cost = perspectiveCost(id, state.permanent[id]);
  if (state.perspective < cost) return state;
  const next = copy(state); next.perspective -= cost; next.permanent[id]++; return next;
}

export function chooseDecision(state, choice) {
  const next = updateUnlocks(copy(state));
  if (!next.unlockedDecisions.includes('crossroads') || next.runDecision || !['focus','open'].includes(choice)) return state;
  next.runDecision = choice; next.decisionHistory.push(`${next.chapter}:${choice}`); next.unlockedDecisions = [];
  if (choice === 'focus') { next.insight += 15; next.connection += 2; }
  else { next.connection += 15; next.joy += 8; }
  return updateUnlocks(next);
}

export function prestige(state, now = Date.now()) {
  if (!state.canPrestige) return state;
  const points = Math.max(1, Math.floor(state.distance / 300));
  const next = createState(now);
  next.reason = state.reason; next.chapter = state.chapter + 1; next.decisionHistory = [...state.decisionHistory];
  next.perspective = state.perspective + points; next.permanent = copy(state.permanent); next.runs = state.runs + 1;
  return next;
}

export function getMilestones(state) {
  return [
    { distance: 10, title: 'The path appears', reached: state.distance >= 10 },
    { distance: 60, title: 'A crossroads', reached: state.distance >= 60 },
    { distance: 150, title: 'A wider view', reached: state.distance >= 150 },
    { distance: 300, title: 'One small step', reached: state.distance >= 300 }
  ];
}

export function serializeState(state) { return JSON.stringify({ ...state, lastSavedAt: Date.now() }); }
export function validateState(candidate) {
  if (!candidate || candidate.version !== 1 || !REASONS.some(([id]) => id === candidate.reason)) return false;
  if (!numeric.every(key => Object.hasOwn(candidate, key) && finite(candidate[key]))) return false;
  if (!integer(candidate.chapter) || candidate.chapter < 1 || !integer(candidate.runs)) return false;
  if (typeof candidate.canPrestige !== 'boolean' || !Object.hasOwn(candidate, 'runDecision') || ![null,'focus','open'].includes(candidate.runDecision)) return false;
  if (!arrays.every(key => Array.isArray(candidate[key]) && candidate[key].every(value => typeof value === 'string' && value.length <= 100))) return false;
  if (!candidate.upgrades || !candidate.permanent) return false;
  if (!Object.keys(UPGRADES).every(key => Object.hasOwn(candidate.upgrades, key) && integer(candidate.upgrades[key], 10_000))) return false;
  if (!Object.keys(PERMANENT).every(key => Object.hasOwn(candidate.permanent, key) && integer(candidate.permanent[key], 10_000))) return false;
  return true;
}
export function migrateState(candidate) {
  if (!candidate || candidate.version !== 1 || Object.hasOwn(candidate, 'restReadyAt') || Object.hasOwn(candidate, 'runDecision')) return null;
  const required = ['reason','energy','distance','experience','insight','connection','joy','perspective','chapter','boostUntil','upgrades','permanent','decisionHistory','unlockedDecisions','milestonesSeen','canPrestige','lastSavedAt','totalRealSeconds','runs'];
  if (!required.every(key => Object.hasOwn(candidate, key))) return null;
  const next = copy(candidate);
  next.restReadyAt = 0;
  next.runDecision = next.decisionHistory.length ? next.decisionHistory.at(-1) : null;
  next.decisionHistory = next.decisionHistory.map((choice, index) => `${index + 1}:${choice}`);
  next.canPrestige = false;
  return validateState(next) ? next : null;
}
export function importState(text, now = Date.now()) {
  try {
    const parsed = JSON.parse(text);
    const value = validateState(parsed) ? parsed : migrateState(parsed);
    if (!value) throw new Error();
    return applyOffline(copy(value), now);
  } catch { throw new Error('Invalid save: no changes were made.'); }
}
export function applyOffline(state, now = Date.now()) {
  if (!validateState(state)) return state;
  const elapsed = Math.max(0, Math.min(14_400, (now - state.lastSavedAt) / 1000));
  const next = tick(state, elapsed, now); next.offlineSeconds = elapsed; return next;
}
