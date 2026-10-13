import {
  REASONS, ACTIVITIES, UPGRADES, PERMANENT, createState, chooseReason, tick,
  activateBoost, performActivity, buyUpgrade, upgradeCost, buyPermanent,
  perspectiveCost, chooseDecision, prestige, getMilestones, serializeState,
  importState, validateState, migrateState, applyOffline, getWorldEvent, getReasonStory, getChapterGoal
} from './engine.js';
import { mountCoop } from './coop.js';

const SAVE_KEY = 'one-small-step-save-v1';
const $ = selector => document.querySelector(selector);
let state = load();
let lastFrame = Date.now();

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createState();
    const parsed = JSON.parse(raw);
    const valid = validateState(parsed) ? parsed : migrateState(parsed);
    return valid ? applyOffline(valid, Date.now()) : createState();
  } catch { return createState(); }
}
function save() { localStorage.setItem(SAVE_KEY, serializeState(state)); }
function notify(message) { $('#notice').textContent = message; }
function whole(value) { return Math.floor(value).toLocaleString(); }

function renderReasons() {
  $('#reasons').innerHTML = REASONS.map(([id, label]) => `<button type="button" data-reason="${id}">${label}</button>`).join('');
  $('#reasons').addEventListener('click', event => {
    const button = event.target.closest('[data-reason]'); if (!button) return;
    state = chooseReason(state, button.dataset.reason); save(); render();
  });
}
function renderActivities() {
  $('#activities').innerHTML = Object.entries(ACTIVITIES).map(([id, item]) => {
    const reward = ['experience','insight','connection','joy'].filter(k => item[k]).map(k => `+${item[k]} ${k}`).join(' · ');
    const cost = item.cost < 0 ? `Restores ${-item.cost} energy` : `${item.cost} energy`;
    return `<button type="button" data-activity="${id}"><b>${item.label}</b><span>${cost}</span><small>${reward || 'A useful pause'}</small></button>`;
  }).join('');
  $('#activities').addEventListener('click', event => {
    const button = event.target.closest('[data-activity]'); if (!button) return;
    const previous = state; state = performActivity(state, button.dataset.activity, Date.now());
    if (state === previous) {
      if (button.dataset.activity === 'rest' && Date.now() < state.restReadyAt) return notify(`Rest is ready in ${Math.ceil((state.restReadyAt-Date.now())/1000)} seconds.`);
      return notify('Not enough energy yet. The walk will keep gathering some.');
    }
    const label = ACTIVITIES[button.dataset.activity].label;
    notify(label === 'Rest' ? 'You rested. Pauses belong on the path too.' : `You chose ${label.toLowerCase()}.`);
    save(); render();
  });
}
function renderUpgrades() {
  $('#upgrades').innerHTML = Object.entries(UPGRADES).map(([id, item]) => `<button type="button" data-upgrade="${id}" aria-label="Buy ${item.label}"><b>${item.label}</b><span>${upgradeCost(id,state.upgrades[id])} energy</span><small>${item.detail} · Level ${state.upgrades[id]}</small></button>`).join('');
  $('#upgrades').onclick = event => { const button=event.target.closest('[data-upgrade]'); if(!button)return; const old=state;state=buyUpgrade(state,button.dataset.upgrade);notify(state===old?'That needs a little more energy.':'A useful thing joins this run.');save();render(); };
}
function renderPermanent() {
  $('#permanent-upgrades').innerHTML = Object.entries(PERMANENT).map(([id,item]) => `<button type="button" data-permanent="${id}" aria-label="Buy permanent ${item.label}"><b>${item.label}</b><span>${perspectiveCost(id,state.permanent[id])} Perspective</span><small>${item.detail} · Level ${state.permanent[id]}</small></button>`).join('');
  $('#permanent-upgrades').onclick = event => { const button=event.target.closest('[data-permanent]');if(!button)return;const old=state;state=buyPermanent(state,button.dataset.permanent);notify(state===old?'Not enough Perspective yet.':'This understanding will remain.');save();render(); };
}
function render() {
  const playing = Boolean(state.reason);
  $('#onboarding').hidden = playing; $('#game').hidden = !playing;
  if (!playing) return;
  $('#reason-label').textContent = REASONS.find(([id]) => id === state.reason)?.[1] || '';
  $('#chapter').textContent = state.chapter;
  for (const key of ['energy','experience','insight','connection','joy','perspective']) document.querySelector(`[data-stat="${key}"]`).textContent = whole(state[key]);
  $('[data-stat="distance"]').textContent = `${whole(state.distance)} m`;
  $('#walker').dataset.boosted = String(state.boostUntil > Date.now());
  $('#boost').disabled = state.energy < 5;
  renderUpgrades(); renderPermanent();
  const milestones = getMilestones(state);
  $('#milestones').innerHTML = milestones.map(m => `<li class="${m.reached?'reached':''}"><b>${m.distance} m</b><br>${m.title}</li>`).join('');
  $('#decision').hidden = !state.unlockedDecisions.includes('crossroads') || Boolean(state.runDecision);
  $('#prestige').disabled = !state.canPrestige;
  const story = getReasonStory(state), goal = getChapterGoal(state);
  $('#story-line').textContent = story.opening;
  const progress = Object.entries(goal.requirements).map(([key, amount]) => `${key}: ${Math.min(amount, Math.floor(state[key]))}/${amount}`).join(' · ');
  $('#chapter-goal').textContent = `Goal: ${goal.description} ${progress} ${goal.complete ? '✓ Complete' : ''}`;
}

renderReasons(); renderActivities();
$('#boost').onclick = () => { const old=state;state=activateBoost(state,Date.now());if(state!==old)notify('For fifteen seconds, your steps come a little easier.');save();render(); };
$('#decision').onclick = event => { const button=event.target.closest('[data-choice]');if(!button)return;state=chooseDecision(state,button.dataset.choice);notify('You chose a direction, not a verdict. Chapter two begins.');save();render(); };
$('#prestige').onclick = () => { state=prestige(state,Date.now());notify('The road begins again, with Perspective carried forward.');save();render(); };
$('#export').onclick = () => { $('#save-data').value=serializeState(state);notify('Save exported below. Keep it somewhere you trust.'); };
$('#import').onclick = () => { try{state=importState($('#save-data').value,Date.now());save();notify('Save imported. Welcome back to this path.');render();}catch(error){notify(error.message);} };

let eventId;
function renderWorldEvent(now=Date.now()){const event=getWorldEvent(now);eventId=event.id;$('#event-title').textContent=event.title;$('#event-description').textContent=event.description;$('#event-end').textContent=`Ends ${event.endsAt} (UTC)`;}
renderWorldEvent();
mountCoop($('#coop'), {
  getEnergy: () => state.energy,
  spendEnergy: amount => { if (state.energy >= amount) { state.energy -= amount; save(); render(); return true; } return false; },
  award: () => { state.joy += 20; state.connection += 10; save(); render(); },
  notify
});

if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).get('test') === '1') window.gameDebug = { get:()=>structuredClone(state) };
setInterval(() => {
  const now=Date.now(), seconds=Math.min(30,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
  if(state.reason){state=tick(state,seconds,now);render();}
  if(getWorldEvent(now).id!==eventId)renderWorldEvent(now);
},500);
setInterval(save,5000);
window.addEventListener('beforeunload',save);
render();
if(state.offlineSeconds>2) notify(`While you were away, the path continued for ${Math.floor(state.offlineSeconds/60)} minutes. No break penalty.`);
