// API thật; chỉ thay AsyncStorage native boundary để chạy được bằng Node.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const state = { values: new Map(), failRead: false, failWrite: false };
globalThis.__rosterStorageCheck = state;
const apiUrl = new URL('../src/lib/sessionApi.js', import.meta.url);
const storageUrl = 'data:text/javascript,' + encodeURIComponent(`
  const state = globalThis.__rosterStorageCheck;
  export default {
    async getItem(key) {
      if (state.failRead) throw new Error('READ_FAILED');
      return state.values.get(key) ?? null;
    },
    async setItem(key, value) {
      if (state.failWrite) throw new Error('WRITE_FAILED');
      state.values.set(key, value);
    },
    async removeItem(key) { state.values.delete(key); },
    async getAllKeys() { return [...state.values.keys()]; }
  };
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@react-native-async-storage/async-storage') {
      return { url: storageUrl, shortCircuit: true };
    }
    if (context.parentURL === apiUrl.href && specifier === './bettingEngine') {
      return {
        url: new URL('../src/lib/bettingEngine.js', import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const api = await import(apiUrl.href);
const KEY = 'saved_player_roster_v1';
const cases = [
  ['RST-14 compatible join rejects duplicate new player', async () => {
    const { pin } = await api.createSession(['An']);
    const key = `local_session_${pin}`;
    const before = state.values.get(key);
    await assert.rejects(api.joinSession(pin, ' an '), /đã tồn tại/);
    assert.equal(state.values.get(key), before);
    await api.joinSession(pin, 'Khách');
    assert.deepEqual(Object.values(JSON.parse(state.values.get(key)).players).map(p => p.name), ['An', 'Khách']);
  }],
  ['RST-13 legacy duplicate players remain untouched', async () => {
    const { pin } = await api.createSession(['An']);
    const key = `local_session_${pin}`;
    const data = JSON.parse(state.values.get(key));
    data.players.legacy_duplicate = { name: 'AN', balance: 10000 };
    state.values.set(key, JSON.stringify(data));
    await api.addPlayerToSession(pin, 'Bình');
    const after = JSON.parse(state.values.get(key));
    assert.deepEqual(after.players.legacy_duplicate, { name: 'AN', balance: 10000 });
    assert.equal(Object.values(after.players).filter(p => p.name.toLowerCase() === 'an').length, 2);
    assert.equal(Object.values(after.players).filter(p => p.name === 'Bình').length, 1);
  }],
  ['RST-12 manual add rejects an existing session name', async () => {
    const { pin } = await api.createSession(['An', 'Hùng']);
    const key = `local_session_${pin}`;
    const before = state.values.get(key);
    for (const name of ['An', ' an ', 'AN', 'Hùng'.normalize('NFD')]) {
      await assert.rejects(api.addPlayerToSession(pin, name), /đã tồn tại/);
      assert.equal(state.values.get(key), before);
    }
    await api.addPlayerToSession(pin, '  An cao  ');
    const data = JSON.parse(state.values.get(key));
    assert.deepEqual(Object.values(data.players).map(p => p.name), ['An', 'Hùng', 'An cao']);
  }],
  ['RST-07 new sessions never inherit old balances or defaults mutations', async () => {
    await api.savePlayerRoster(['An', 'Bình']);
    const previousRandom = Math.random;
    try {
      Math.random = () => 0.1;
      const first = await api.createSession(['An', 'Bình']);
      const firstKey = `local_session_${first.pin}`;
      const old = JSON.parse(state.values.get(firstKey));
      const firstId = Object.keys(old.players)[0];
      old.players[firstId].balance = 20000;
      old.players[firstId].isSettled = true;
      old.sets = { set_1: { status: 'completed' } };
      old.courtFee = { total: 200000 };
      state.values.set(firstKey, JSON.stringify(old));
      const firstSnapshot = state.values.get(firstKey);

      Math.random = () => 0.8;
      const second = await api.createSession(['Bình']);
      assert.notEqual(second.pin, first.pin);
      const fresh = JSON.parse(state.values.get(`local_session_${second.pin}`));
      assert.deepEqual(Object.values(fresh.players), [{ name: 'Bình', balance: 0 }]);
      assert.deepEqual(fresh.sets, {});
      assert.equal('courtFee' in fresh, false);
      assert.equal(state.values.get(firstKey), firstSnapshot);
      assert.deepEqual(await api.getPlayerRoster(), ['An', 'Bình']);

      await api.addPlayerToSession(second.pin, 'Khách');
      assert.deepEqual(await api.getPlayerRoster(), ['An', 'Bình']);
      await api.savePlayerRoster(['Cường']);
      const secondSnapshot = JSON.parse(state.values.get(`local_session_${second.pin}`));
      assert.deepEqual(Object.values(secondSnapshot.players).map(p => p.name), ['Bình', 'Khách']);
    } finally {
      Math.random = previousRandom;
    }
  }],
  ['RST-08 empty and invalid session inputs are explicit', async () => {
    const { pin } = await api.createSession();
    const data = JSON.parse(state.values.get(`local_session_${pin}`));
    assert.deepEqual(data.players, {});
    assert.equal('hostName' in data.meta, false);
    await assert.rejects(api.createSession('An'), /mảng tên/);
  }],
  ['RST-11 create session rejects duplicate names before writing', async () => {
    for (const names of [['An', 'An'], ['An', ' an '], ['Hùng', 'Hùng'.normalize('NFD')]]) {
      const before = [...state.values.entries()];
      await assert.rejects(api.createSession(names), /đã tồn tại/);
      assert.deepEqual([...state.values.entries()], before);
    }
  }],
  ['RST-06 create session with fresh selected players', async () => {
    const { pin, deviceId } = await api.createSession(['  An  ', 'Bình', 'Hùng']);
    const data = JSON.parse(state.values.get(`local_session_${pin}`));
    assert.match(pin, /^L-\d{4}$/);
    assert.equal(data.meta.hostId, deviceId);
    assert.equal('hostName' in data.meta, false);
    assert.deepEqual(data.meta.teams, ['teamA', 'teamB']);
    assert.deepEqual(data.sets, {});
    assert.deepEqual(Object.values(data.players), [
      { name: 'An', balance: 0 },
      { name: 'Bình', balance: 0 },
      { name: 'Hùng', balance: 0 },
    ]);
    assert.equal(new Set(Object.keys(data.players)).size, 3);
  }],
  ['RST-04 invalid input does not replace saved roster', async () => {
    await api.savePlayerRoster(['An']);
    for (const invalid of [null, {}, 'An', ['An', 42]]) {
      await assert.rejects(api.savePlayerRoster(invalid), /mảng tên/);
      assert.equal(state.values.get(KEY), '["An"]');
    }
  }],
  ['RST-05 storage errors propagate without data loss', async () => {
    await api.savePlayerRoster(['An']);
    state.failRead = true;
    await assert.rejects(api.getPlayerRoster(), /READ_FAILED/);
    state.failRead = false;
    state.failWrite = true;
    await assert.rejects(api.savePlayerRoster(['Bình']), /WRITE_FAILED/);
    assert.equal(state.values.get(KEY), '["An"]');
  }],
  ['RST-10 duplicate stored roster is reported without rewriting data', async () => {
    const raw = JSON.stringify(['An', ' an ']);
    state.values.set(KEY, raw);
    await assert.rejects(api.getPlayerRoster(), /đã tồn tại/);
    assert.equal(state.values.get(KEY), raw);
  }],
  ['RST-03 malformed saved roster is not overwritten', async () => {
    for (const raw of ['null', '{}', '["An",42]', '{broken']) {
      state.values.set(KEY, raw);
      await assert.rejects(api.getPlayerRoster(), /Danh sách đã lưu bị lỗi/);
      assert.equal(state.values.get(KEY), raw);
    }
  }],
  ['RST-09 duplicate names are rejected without changing saved roster', async () => {
    await api.savePlayerRoster(['An', 'Bình']);
    const before = state.values.get(KEY);
    for (const names of [
      ['An', 'An'],
      ['An', ' an '],
      ['An', 'AN'],
      ['Nguyễn  Văn A', 'nguyễn văn a'],
      ['Hùng', 'Hùng'.normalize('NFD')],
    ]) {
      await assert.rejects(api.savePlayerRoster(names), /đã tồn tại/);
      assert.equal(state.values.get(KEY), before);
    }
    assert.deepEqual(await api.savePlayerRoster([' An cao ', 'An thấp']), ['An cao', 'An thấp']);
    assert.deepEqual(await api.savePlayerRoster(['An', 'Ân']), ['An', 'Ân']);
    assert.deepEqual(await api.savePlayerRoster([' Nguyễn  Văn A ']), ['Nguyễn Văn A']);
  }],
  ['RST-02 save normalized distinct names', async () => {
    assert.equal(typeof api.savePlayerRoster, 'function', 'missing savePlayerRoster');
    const saved = await api.savePlayerRoster(['  An  ', '', '   ', 'Bình', 'Hùng']);
    assert.deepEqual(saved, ['An', 'Bình', 'Hùng']);
    assert.deepEqual(JSON.parse(state.values.get(KEY)), saved);
    saved.push('Khách');
    assert.deepEqual(await api.getPlayerRoster(), ['An', 'Bình', 'Hùng']);
    await api.savePlayerRoster([]);
    assert.deepEqual(await api.getPlayerRoster(), []);
    assert.equal(state.values.get(KEY), '[]');
  }],
  ['RST-01 empty storage returns empty roster', async () => {
    assert.equal(typeof api.getPlayerRoster, 'function', 'missing getPlayerRoster');
    assert.deepEqual(await api.getPlayerRoster(), []);
    assert.equal(state.values.has(KEY), false, 'read must not create a key');
  }],
];

const prefix = process.argv[2] || '';
const selected = cases.filter(([name]) => name.startsWith(prefix));
assert.ok(selected.length, `No cases match ${prefix}`);
for (const [name, run] of selected) {
  state.values.clear();
  state.failRead = false;
  state.failWrite = false;
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Roster/session check OK (${selected.length} cases)`);
