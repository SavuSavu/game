import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePacket, createHostSession, receiveAsHost, createGuestSession, receiveAsGuest,
  encodeSignal, decodeSignal, waitForIce, consumePacketBudget, isActiveTransport,
} from './coop.js';

const hello = (id) => JSON.stringify({ v: 1, type: 'hello', id });
const contribution = (seq, amount = 10) => JSON.stringify({ v: 1, type: 'contribute', seq, amount });
const state = (seq, total, achieved = false) => JSON.stringify({ v: 1, type: 'state', seq, total, target: 100, achieved, hostId: 'host-one' });

test('protocol validates symmetric hello and rejects malformed, unknown, and oversized packets', () => {
  assert.deepEqual(parsePacket(hello('guest-one')), { v: 1, type: 'hello', id: 'guest-one' });
  assert.throws(() => parsePacket('{'), /JSON/);
  assert.throws(() => parsePacket(JSON.stringify({ v: 2, type: 'hello', id: 'guest-one' })), /version/);
  assert.throws(() => parsePacket(JSON.stringify({ v: 1, type: 'nope' })), /type/);
  assert.throws(() => parsePacket(' '.repeat(1025)), /large/);
});

test('host gates contributions on identity and accepts only bounded incremental sequenced guest contributions', () => {
  let session = createHostSession('host-one');
  assert.deepEqual(receiveAsHost(session, contribution(1)).effects, [{ type: 'reject', reason: 'identity' }]);
  ({ session } = receiveAsHost(session, hello('guest-one')));
  assert.equal(session.guestId, 'guest-one');
  assert.deepEqual(receiveAsHost(session, hello('other-one')).effects, [{ type: 'reject', reason: 'duplicate hello' }]);
  assert.match(receiveAsHost(session, contribution(1, 100)).effects[0].reason, /amount/i);
  ({ session } = receiveAsHost(session, contribution(1)));
  assert.equal(session.total, 10);
  assert.deepEqual(receiveAsHost(session, contribution(1)).effects, [{ type: 'reject', reason: 'sequence' }]);
});

test('host reaches target once and never emits a second reward', () => {
  let session = createHostSession('host-one');
  ({ session } = receiveAsHost(session, hello('guest-one')));
  let effects;
  for (let seq = 1; seq <= 10; seq += 1) ({ session, effects } = receiveAsHost(session, contribution(seq)));
  assert.equal(session.total, 100);
  assert.equal(effects.filter((effect) => effect.type === 'award').length, 1);
  ({ session, effects } = receiveAsHost(session, contribution(11)));
  assert.equal(session.total, 100);
  assert.equal(effects.some((effect) => effect.type === 'award', false), false);
});

test('guest binds the expected host hello before accepting authoritative state and rewards once', () => {
  let session = createGuestSession();
  assert.deepEqual(receiveAsGuest(session, state(1, 10)).effects, [{ type: 'reject', reason: 'identity' }]);
  ({ session } = receiveAsGuest(session, hello('host-one')));
  let effects;
  ({ session, effects } = receiveAsGuest(session, state(1, 100, true)));
  assert.equal(session.total, 100);
  assert.equal(effects.filter((effect) => effect.type === 'award').length, 1);
  ({ session, effects } = receiveAsGuest(session, state(2, 100, true)));
  assert.equal(effects.some((effect) => effect.type === 'award'), false);
  assert.deepEqual(receiveAsGuest(session, state(2, 90)).effects, [{ type: 'reject', reason: 'sequence' }]);
});

test('manual signals round-trip and reject invalid or excessive invitations', () => {
  const offer = { type: 'offer', sdp: 'v=0\r\n' };
  assert.deepEqual(decodeSignal(encodeSignal(offer), 'offer'), offer);
  assert.throws(() => decodeSignal('not base64', 'offer'), /invitation/);
  assert.throws(() => decodeSignal(encodeSignal({ type: 'answer', sdp: 'v=0' }), 'offer'), /offer/);
  assert.throws(() => decodeSignal('a'.repeat(90001), 'offer'), /long/);
});

test('manual signals preserve sender and attempt metadata for local self/stale rejection', () => {
  const signal = { type: 'offer', sdp: 'v=0\r\n', from: 'peer-one', attempt: 'attempt-one' };
  assert.deepEqual(decodeSignal(encodeSignal(signal), 'offer'), signal);
  assert.throws(() => encodeSignal({ ...signal, from: '!' }), /sender/i);
  assert.throws(() => encodeSignal({ ...signal, attempt: '' }), /attempt/i);
});

test('packet budget counts malformed and valid traffic in one bounded rolling window', () => {
  let budget;
  ({ budget } = consumePacketBudget(budget, 1000, 3, 100));
  ({ budget } = consumePacketBudget(budget, 1010, 3, 100));
  let result = consumePacketBudget(budget, 1020, 3, 100);
  assert.equal(result.accepted, true);
  result = consumePacketBudget(result.budget, 1030, 3, 100);
  assert.equal(result.accepted, false);
  result = consumePacketBudget(result.budget, 1200, 3, 100);
  assert.equal(result.accepted, true);
});

test('transport callbacks are active only for the captured generation peer and channel', () => {
  const peer = {}, channel = {};
  const active = { generation: 4, peer, channel };
  assert.equal(isActiveTransport(active, 4, peer, channel), true);
  assert.equal(isActiveTransport(active, 3, peer, channel), false);
  assert.equal(isActiveTransport(active, 4, {}, channel), false);
  assert.equal(isActiveTransport(active, 4, peer, {}), false);
});

test('ICE gathering returns partial bounded output and removes listeners', async () => {
  const listeners = new Map();
  const pc = {
    iceGatheringState: 'gathering',
    localDescription: { type: 'offer', sdp: 'v=0' },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const result = await waitForIce(pc, 5);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.description, pc.localDescription);
  assert.equal(listeners.size, 0);
});

test('ICE gathering reports complete when completion arrives', async () => {
  const listeners = new Map();
  const pc = {
    iceGatheringState: 'gathering', localDescription: { type: 'answer', sdp: 'v=0' },
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
  };
  const pending = waitForIce(pc, 100);
  pc.iceGatheringState = 'complete'; listeners.get('icegatheringstatechange')();
  assert.equal((await pending).status, 'complete');
  assert.equal(listeners.size, 0);
});
