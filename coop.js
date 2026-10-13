const VERSION = 1;
const TARGET = 100;
const STEP = 10;
const MAX_PACKET_BYTES = 1024;
const MAX_SIGNAL_CHARS = 90_000;
const PACKET_LIMIT = 120;
const PACKET_WINDOW_MS = 10_000;
const ID_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const TYPES = new Set(['hello', 'contribute', 'state', 'reset']);

const bytes = (text) => new TextEncoder().encode(text).length;
const reject = (reason, session) => ({ session, effects: [{ type: 'reject', reason }] });

export function parsePacket(raw) {
  if (typeof raw !== 'string' || bytes(raw) > MAX_PACKET_BYTES) throw new Error('Packet is missing or too large.');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('Packet is not valid JSON.'); }
  if (!value || value.v !== VERSION) throw new Error('Unsupported co-op protocol version.');
  if (!TYPES.has(value.type)) throw new Error('Unknown co-op packet type.');
  if (value.type === 'hello') {
    if (!ID_RE.test(value.id ?? '')) throw new Error('Invalid co-op hello identity.');
    return { v: VERSION, type: 'hello', id: value.id };
  }
  if (value.type === 'contribute') {
    if (!Number.isSafeInteger(value.seq) || value.seq < 1 || value.seq > 1_000_000) throw new Error('Invalid contribution sequence.');
    if (!Number.isSafeInteger(value.amount) || value.amount !== STEP) throw new Error('Invalid contribution amount.');
    return { v: VERSION, type: 'contribute', seq: value.seq, amount: STEP };
  }
  if (value.type === 'state') {
    if (!Number.isSafeInteger(value.seq) || value.seq < 1 || value.seq > 1_000_000) throw new Error('Invalid state sequence.');
    if (!Number.isSafeInteger(value.total) || value.total < 0 || value.total > TARGET || value.total % STEP) throw new Error('Invalid shared total.');
    if (value.target !== TARGET || typeof value.achieved !== 'boolean' || !ID_RE.test(value.hostId ?? '')) throw new Error('Invalid authoritative state.');
    if (value.achieved !== (value.total === TARGET)) throw new Error('Inconsistent goal state.');
    return { v: VERSION, type: 'state', seq: value.seq, total: value.total, target: TARGET, achieved: value.achieved, hostId: value.hostId };
  }
  if (!Number.isSafeInteger(value.seq) || value.seq < 1 || value.seq > 1_000_000 || !ID_RE.test(value.hostId ?? '')) throw new Error('Invalid reset packet.');
  return { v: VERSION, type: 'reset', seq: value.seq, hostId: value.hostId };
}

export function createHostSession(hostId) {
  if (!ID_RE.test(hostId)) throw new Error('Invalid host identity.');
  return { role: 'host', hostId, guestId: null, total: 0, guestSeq: 0, stateSeq: 0, awarded: false };
}

export function receiveAsHost(session, raw) {
  let packet;
  try { packet = parsePacket(raw); } catch (error) { return reject(error.message, session); }
  if (packet.type === 'hello') {
    if (session.guestId) return reject('duplicate hello', session);
    if (packet.id === session.hostId) return reject('duplicate identity', session);
    return { session: { ...session, guestId: packet.id }, effects: [{ type: 'bound', id: packet.id }, { type: 'broadcast' }] };
  }
  if (!session.guestId) return reject('identity', session);
  if (packet.type !== 'contribute') return reject('authority', session);
  if (packet.seq <= session.guestSeq) return reject('sequence', session);
  if (packet.amount !== STEP || session.total >= TARGET) return reject('amount', session);
  const total = Math.min(TARGET, session.total + packet.amount);
  const achievedNow = total === TARGET && !session.awarded;
  const next = { ...session, guestSeq: packet.seq, total, awarded: session.awarded || achievedNow };
  return { session: next, effects: [{ type: 'broadcast' }, ...(achievedNow ? [{ type: 'award' }] : [])] };
}

export function createGuestSession() {
  return { role: 'guest', hostId: null, total: 0, stateSeq: 0, awarded: false };
}

export function receiveAsGuest(session, raw) {
  let packet;
  try { packet = parsePacket(raw); } catch (error) { return reject(error.message, session); }
  if (packet.type === 'hello') {
    if (session.hostId) return reject('duplicate hello', session);
    return { session: { ...session, hostId: packet.id }, effects: [{ type: 'bound', id: packet.id }] };
  }
  if (!session.hostId) return reject('identity', session);
  if ((packet.type !== 'state' && packet.type !== 'reset') || packet.hostId !== session.hostId) return reject('authority', session);
  if (packet.seq <= session.stateSeq) return reject('sequence', session);
  if (packet.type === 'reset') {
    if (!session.awarded || session.total !== TARGET) return reject('reset', session);
    return { session: { ...session, total: 0, stateSeq: packet.seq, awarded: false }, effects: [{ type: 'reset' }] };
  }
  if (packet.total < session.total) return reject('total', session);
  const achievedNow = packet.achieved && !session.awarded;
  return {
    session: { ...session, total: packet.total, stateSeq: packet.seq, awarded: session.awarded || achievedNow },
    effects: [...(achievedNow ? [{ type: 'award' }] : [])],
  };
}

export function consumePacketBudget(budget = { startedAt: 0, count: 0 }, now = Date.now(), limit = PACKET_LIMIT, windowMs = PACKET_WINDOW_MS) {
  const current = !budget.startedAt || now - budget.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : budget;
  const next = { startedAt: current.startedAt, count: current.count + 1 };
  return { accepted: next.count <= limit, budget: next };
}

export function isActiveTransport(active, generation, peer, dataChannel) {
  return active.generation === generation && active.peer === peer && active.channel === dataChannel;
}

function base64Encode(text) {
  if (typeof btoa === 'function') return btoa(text);
  return Buffer.from(text, 'utf8').toString('base64');
}
function base64Decode(text) {
  if (typeof atob === 'function') return atob(text);
  return Buffer.from(text, 'base64').toString('utf8');
}

export function encodeSignal(description) {
  if (!description || !['offer', 'answer'].includes(description.type) || typeof description.sdp !== 'string' || !description.sdp) throw new Error('Invalid session description.');
  if (description.from !== undefined && !ID_RE.test(description.from)) throw new Error('Invalid signal sender.');
  if (description.attempt !== undefined && !ID_RE.test(description.attempt)) throw new Error('Invalid signal attempt.');
  return base64Encode(JSON.stringify({
    type: description.type,
    sdp: description.sdp,
    ...(description.from ? { from: description.from } : {}),
    ...(description.attempt ? { attempt: description.attempt } : {}),
  }));
}

export function decodeSignal(text, expectedType) {
  if (typeof text !== 'string' || text.length > MAX_SIGNAL_CHARS) throw new Error('Invitation is too long.');
  let value;
  try { value = JSON.parse(base64Decode(text.trim())); } catch { throw new Error('Invalid invitation text. Copy the complete text and try again.'); }
  if (!value || value.type !== expectedType || typeof value.sdp !== 'string' || !value.sdp || value.sdp.length > 80_000) {
    throw new Error(`This is not a valid ${expectedType} invitation.`);
  }
  if (value.from !== undefined && !ID_RE.test(value.from)) throw new Error('Invalid invitation sender.');
  if (value.attempt !== undefined && !ID_RE.test(value.attempt)) throw new Error('Invalid invitation attempt.');
  return {
    type: value.type,
    sdp: value.sdp,
    ...(value.from ? { from: value.from } : {}),
    ...(value.attempt ? { attempt: value.attempt } : {}),
  };
}

export function waitForIce(pc, timeoutMs = 4000) {
  return new Promise((resolve, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener('icecandidate', onCandidate);
      pc.removeEventListener('icegatheringstatechange', onState);
    };
    const finish = (status) => {
      if (settled) return;
      settled = true; cleanup();
      const description = pc.localDescription;
      if (!description || typeof description.sdp !== 'string' || !description.sdp) return rejectPromise(new Error('No local session description; reset and retry.'));
      resolve({ status, description: { type: description.type, sdp: description.sdp } });
    };
    const onCandidate = (event) => { if (!event.candidate) finish('complete'); };
    const onState = () => { if (pc.iceGatheringState === 'complete') finish('complete'); };
    pc.addEventListener('icecandidate', onCandidate);
    pc.addEventListener('icegatheringstatechange', onState);
    const timer = setTimeout(() => finish('partial'), timeoutMs);
    if (pc.iceGatheringState === 'complete') queueMicrotask(() => finish('complete'));
  });
}

function makeId(prefix) {
  const random = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(2)).join('') : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return `${prefix}-${random}`.slice(0, 32).toLowerCase();
}

export function mountCoop(container, { getEnergy, spendEnergy, award, notify }) {
  if (!container || typeof getEnergy !== 'function' || typeof spendEnergy !== 'function' || typeof award !== 'function' || typeof notify !== 'function') throw new Error('mountCoop requires a container and game callbacks.');
  const root = document.createElement('section');
  root.className = 'coop-panel';
  root.setAttribute('aria-labelledby', 'coop-title');
  root.innerHTML = `
    <h2 id="coop-title">Invite co-op (optional)</h2>
    <p>Share a direct WebRTC invitation with one person. There is no lobby or global total. Direct connections can fail across networks; STUN discovers routes but is not a relay, so some pairs need a future TURN service.</p>
    <p>Worldwide timed events are calculated by the main game. Persistent global contributions need a future backend.</p>
    <div role="group" aria-label="Choose co-op role">
      <button type="button" data-action="host">Host: create invitation</button>
      <button type="button" data-action="guest">Guest: answer invitation</button>
      <button type="button" data-action="disconnect" disabled>Disconnect / clear session</button>
    </div>
    <p role="status" aria-live="polite" data-status>Choose Host or Guest.</p>
    <label>Invitation from host<textarea data-offer rows="5" spellcheck="false" aria-describedby="offer-help"></textarea></label>
    <small id="offer-help">Host sends this text to the guest. Guest pastes it here.</small>
    <button type="button" data-action="answer">Guest: use invitation and create answer</button>
    <label>Answer from guest<textarea data-answer rows="5" spellcheck="false" aria-describedby="answer-help"></textarea></label>
    <small id="answer-help">Guest sends this answer to the host. Host pastes it here.</small>
    <button type="button" data-action="apply-answer">Host: apply answer</button>
    <hr>
    <p>Session goal: <strong data-total>0 / ${TARGET} energy</strong></p>
    <button type="button" data-action="contribute" disabled>Contribute ${STEP} energy</button>
    <button type="button" data-action="reset-round" disabled>Host: start another round</button>
    <p><small>Each player spends their own energy. When the host-authoritative total reaches ${TARGET}, both players receive Joy +20 and Connection +10 once.</small></p>`;
  container.append(root);

  const el = (name) => root.querySelector(`[data-${name}]`);
  const action = (name) => root.querySelector(`[data-action="${name}"]`);
  const status = el('status');
  const offerArea = el('offer');
  const answerArea = el('answer');
  const totalEl = el('total');
  let role = null, pc = null, channel = null, session = null, outboundSeq = 0, generation = 0, attemptId = null, appliedAnswer = false;
  const localId = makeId('peer');
  const iceServers = new URLSearchParams(location.search).get('coopIce') === 'local' ? [] : [{ urls: 'stun:stun.l.google.com:19302' }];

  const say = (message) => { status.textContent = message; notify(message); };
  const sendOn = (target, packet) => { if (target?.readyState === 'open') target.send(JSON.stringify(packet)); };
  const send = (packet) => sendOn(channel, packet);
  const update = () => {
    totalEl.textContent = `${session?.total ?? 0} / ${TARGET} energy`;
    action('contribute').disabled = channel?.readyState !== 'open' || !session?.hostId && role === 'guest' || !session?.guestId && role === 'host' || (session?.total ?? 0) >= TARGET;
    action('reset-round').disabled = role !== 'host' || channel?.readyState !== 'open' || session?.total !== TARGET;
    action('disconnect').disabled = !pc;
  };
  const hostState = () => {
    session = { ...session, stateSeq: session.stateSeq + 1 };
    send({ v: VERSION, type: 'state', seq: session.stateSeq, total: session.total, target: TARGET, achieved: session.total === TARGET, hostId: session.hostId });
    update();
  };
  const runEffects = (effects) => {
    for (const effect of effects) {
      if (effect.type === 'award') { award(); say('Goal achieved. Both players earned Joy +20 and Connection +10.'); }
      if (effect.type === 'broadcast' && role === 'host') hostState();
      if (effect.type === 'reject') say(`Ignored invalid peer message (${effect.reason}).`);
    }
    update();
  };
  const bindChannel = (nextChannel, ownerPeer, ownerGeneration) => {
    if (ownerGeneration !== generation || ownerPeer !== pc) { try { nextChannel.close(); } catch {} return; }
    channel = nextChannel;
    let packetBudget;
    const active = () => isActiveTransport({ generation, peer: pc, channel }, ownerGeneration, ownerPeer, nextChannel);
    nextChannel.addEventListener('open', () => {
      if (!active()) return;
      sendOn(nextChannel, { v: VERSION, type: 'hello', id: localId });
      say('Connected. Waiting for validated peer identity.'); update();
    });
    nextChannel.addEventListener('message', (event) => {
      if (!active()) return;
      const budgetResult = consumePacketBudget(packetBudget);
      packetBudget = budgetResult.budget;
      if (!budgetResult.accepted) {
        say('Peer disconnected: packet budget exceeded. Clear and exchange a fresh invitation.');
        try { nextChannel.close(); } catch {}
        try { ownerPeer.close(); } catch {}
        return;
      }
      if (typeof event.data !== 'string' || bytes(event.data) > MAX_PACKET_BYTES) { say('Ignored an oversized peer message.'); return; }
      const result = role === 'host' ? receiveAsHost(session, event.data) : receiveAsGuest(session, event.data);
      if (result.session) session = result.session;
      runEffects(result.effects);
      if (result.effects.some((effect) => effect.type === 'bound')) say('Peer identity validated. Contributions are enabled.');
    });
    nextChannel.addEventListener('close', () => {
      if (!active()) return;
      try { ownerPeer.close(); } catch {}
      if (role === 'host' && session) session = { ...session, guestId: null };
      if (role === 'guest' && session) session = createGuestSession();
      channel = null; pc = null;
      say('Peer disconnected. Clear the session and exchange a fresh invitation to reconnect.'); update();
    });
  };
  const newPeer = (ownerGeneration) => {
    if (!globalThis.RTCPeerConnection) throw new Error('This browser does not support WebRTC.');
    const peer = new RTCPeerConnection({ iceServers });
    pc = peer;
    peer.addEventListener('connectionstatechange', () => {
      if (ownerGeneration !== generation || pc !== peer) return;
      if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
        try { channel?.close(); } catch {}
        try { peer.close(); } catch {}
        channel = null; pc = null;
        if (role === 'host' && session) session = { ...session, guestId: null };
        if (role === 'guest' && session) session = createGuestSession();
        say('Direct connection failed or disconnected. Clear and exchange a fresh invitation; different networks may require TURN.');
        update();
      }
    });
    update(); return peer;
  };
  const resetTransport = () => {
    generation += 1;
    const oldChannel = channel, oldPeer = pc;
    channel = null; pc = null;
    try { oldChannel?.close(); } catch {}
    try { oldPeer?.close(); } catch {}
    role = null; session = null; outboundSeq = 0; attemptId = null; appliedAnswer = false;
    offerArea.value = ''; answerArea.value = '';
    status.textContent = 'Session cleared. Choose Host or Guest.'; update();
  };

  action('host').addEventListener('click', async () => {
    resetTransport(); role = 'host'; session = createHostSession(localId); attemptId = makeId('attempt'); const ownerGeneration = generation;
    try {
      const peer = newPeer(ownerGeneration); bindChannel(peer.createDataChannel('one-small-step'), peer, ownerGeneration);
      await peer.setLocalDescription(await peer.createOffer());
      const gathered = await waitForIce(peer);
      if (ownerGeneration !== generation || pc !== peer) return;
      offerArea.value = encodeSignal({ ...gathered.description, from: localId, attempt: attemptId });
      say(`Invitation ready (${gathered.status === 'partial' ? 'PARTIAL CANDIDATES: direct connection may fail; retry or TURN may be needed' : 'ICE complete'}). Send it to your guest.`);
    } catch (error) { if (ownerGeneration === generation) say(error.message); }
  });
  action('guest').addEventListener('click', () => { resetTransport(); role = 'guest'; session = createGuestSession(); say('Guest mode ready. Paste the host invitation, then create an answer.'); });
  action('answer').addEventListener('click', async () => {
    if (role !== 'guest') { say('Choose Guest first.'); return; }
    if (pc) { say('An answer already exists. Clear the session before applying another invitation.'); return; }
    const ownerGeneration = generation;
    try {
      const description = decodeSignal(offerArea.value, 'offer');
      if (description.from === localId) throw new Error('You pasted your own invitation. Send it to the other player instead.');
      attemptId = description.attempt || makeId('attempt');
      const peer = newPeer(ownerGeneration);
      peer.addEventListener('datachannel', (event) => bindChannel(event.channel, peer, ownerGeneration));
      await peer.setRemoteDescription({ type: description.type, sdp: description.sdp });
      await peer.setLocalDescription(await peer.createAnswer());
      const gathered = await waitForIce(peer);
      if (ownerGeneration !== generation || pc !== peer) return;
      answerArea.value = encodeSignal({ ...gathered.description, from: localId, attempt: attemptId });
      say(`Answer ready (${gathered.status === 'partial' ? 'PARTIAL CANDIDATES: retry or TURN may be needed' : 'ICE complete'}). Send it to the host.`);
    } catch (error) {
      if (ownerGeneration === generation) {
        const failedPeer = pc; pc = null; channel = null; try { failedPeer?.close(); } catch {}
        say(error.message); update();
      }
    }
  });
  action('apply-answer').addEventListener('click', async () => {
    if (role !== 'host' || !pc) { say('Create a host invitation first.'); return; }
    if (appliedAnswer || pc.remoteDescription) { say('That answer was already applied. Clear or re-host before applying another answer.'); return; }
    const ownerGeneration = generation, peer = pc;
    try {
      const description = decodeSignal(answerArea.value, 'answer');
      if (description.from === localId) throw new Error('You pasted your own signal. Paste the guest answer instead.');
      if (description.attempt && description.attempt !== attemptId) throw new Error('That answer belongs to an old invitation. Paste the answer for the current host invitation.');
      await peer.setRemoteDescription({ type: description.type, sdp: description.sdp });
      if (ownerGeneration !== generation || pc !== peer) return;
      appliedAnswer = true;
      say('Answer applied. Waiting for the direct data channel to open.');
    } catch (error) { if (ownerGeneration === generation && pc === peer) say(error.message); }
  });
  action('contribute').addEventListener('click', () => {
    if (channel?.readyState !== 'open') return say('Connect and validate a peer first.');
    if ((role === 'guest' && !session?.hostId) || (role === 'host' && !session?.guestId) || session?.total >= TARGET) return say('The peer is not ready or this goal is complete.');
    if (!spendEnergy(STEP)) return say(`You need ${STEP} energy to contribute (you currently have ${Math.max(0, Math.floor(Number(getEnergy()) || 0))}).`);
    if (role === 'guest') { outboundSeq += 1; send({ v: VERSION, type: 'contribute', seq: outboundSeq, amount: STEP }); say(`Sent ${STEP} energy to the host for validation.`); }
    else {
      const total = Math.min(TARGET, session.total + STEP); const achieved = total === TARGET && !session.awarded;
      session = { ...session, total, awarded: session.awarded || achieved };
      if (achieved) award(); hostState();
      say(achieved ? 'Goal achieved. Both players earned Joy +20 and Connection +10.' : `Contributed ${STEP} energy.`);
    }
    update();
  });
  action('reset-round').addEventListener('click', () => {
    if (role !== 'host' || session?.total !== TARGET) return;
    session = { ...session, total: 0, awarded: false, stateSeq: session.stateSeq + 1 };
    send({ v: VERSION, type: 'reset', seq: session.stateSeq, hostId: session.hostId });
    say('Host started a new session-local co-op round.'); update();
  });
  action('disconnect').addEventListener('click', resetTransport);
  update();
  return { destroy() { resetTransport(); root.remove(); } };
}
