// Kiểm tra các tính năng mới: ghi chú set, thu tiền sân tự nhập, dọn cược kèm 2 chiều, hit-test kéo thả.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import vm from 'node:vm';
import { transformSync } from '@babel/core';

const state = { values: new Map() };
globalThis.__featureTestStorage = state;
const apiUrl = new URL('../src/lib/sessionApi.js', import.meta.url);
const storageUrl = 'data:text/javascript,' + encodeURIComponent(`
  const state = globalThis.__featureTestStorage;
  export default {
    async getItem(key) { return state.values.get(key) ?? null; },
    async setItem(key, value) { state.values.set(key, value); },
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
      return { url: new URL('../src/lib/bettingEngine.js', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const api = await import(apiUrl.href);

// Nạp findDropTarget từ src/components/draggable-player.js
const dragSrc = fs.readFileSync(new URL('../src/components/draggable-player.js', import.meta.url), 'utf8');
const { code: dragCode } = transformSync(dragSrc, {
  filename: 'draggable-player.js',
  configFile: false,
  babelrc: false,
  plugins: [['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }], '@babel/plugin-transform-modules-commonjs'],
});
const dragMod = { exports: {} };
vm.runInContext(dragCode, vm.createContext({
  module: dragMod,
  exports: dragMod.exports,
  require(name) {
    if (name === 'react') return { useEffect: () => {}, useMemo: () => null, useRef: v => ({ current: v }) };
    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
    if (name === 'react-native-gesture-handler') return { Gesture: {}, GestureDetector: 'GestureDetector' };
    throw new Error(`Unexpected import: ${name}`);
  },
}));
const { findDropTarget } = dragMod.exports;

// FEAT-01: Ghi chú set đấu hiện tại, lịch sử và kèo phụ
{
  state.values.clear();
  const { pin } = await api.createSession(['An', 'Bình']);
  const set1 = await api.startNewSet(pin, 5000);
  await api.updateSetNote(pin, set1, 'Chấp 2 điểm');
  let session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.sets[set1].note, 'Chấp 2 điểm');

  await api.finishSet(pin, set1, 'teamA');
  await api.updateSetNote(pin, set1, 'Chấp 2 điểm - đã chốt');
  session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.sets[set1].note, 'Chấp 2 điểm - đã chốt');

  const set2 = await api.startNewSet(pin, 5000, session.sets[set1]);
  session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.sets[set2].note, '', 'Set mới phải reset ghi chú rỗng');

  const smId = await api.addSideMatch(pin, 'Kèo bia', 10000);
  session = JSON.parse(state.values.get(`local_session_${pin}`));
  const sideSetId = Object.keys(session.sideSets).find(id => session.sideSets[id].sideMatchId === smId);
  await api.updateSideSetNote(pin, sideSetId, 'Không chắn bóng');
  session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.sideSets[sideSetId].note, 'Không chắn bóng');
  console.log('PASS FEAT-01 set and side-set notes persist across playing/completed sets');
}

// FEAT-02: Thu tiền sân tự nhập (120k / 15 người, thu tròn 10k/người -> thừa 30k) + undo
{
  state.values.clear();
  const names = Array.from({ length: 15 }, (_, i) => `Người ${i + 1}`);
  const { pin } = await api.createSession(names);
  await api.finishSession(pin, 120000, 'custom', 10000);
  let session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.meta.status, 'finished');
  assert.equal(session.courtFee.splitMethod, 'custom');
  assert.equal(session.courtFee.perPlayerFee, 10000);
  assert.equal(session.courtFee.totalCollected, 150000);
  assert.equal(session.courtFee.surplus, 30000);
  assert.equal(session.courtFee.deficit, 0);
  assert.ok(Object.values(session.players).every(p => p.balance === -10000));

  await api.undoFinishSession(pin);
  session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.meta.status, 'active');
  assert.ok(Object.values(session.players).every(p => p.balance === 0));
  console.log('PASS FEAT-02 custom per-player court fee calculates surplus and undoes cleanly');
}

// FEAT-03: Thu tiền sân tự nhập không nhập tổng tiền sân + trường hợp thu thiếu
{
  state.values.clear();
  const names = Array.from({ length: 15 }, (_, i) => `P${i + 1}`);
  const { pin } = await api.createSession(names);
  await api.finishSession(pin, 0, 'custom', 10000);
  let session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.courtFee.total, 150000);
  assert.equal(session.courtFee.surplus, 0);
  assert.equal(session.courtFee.deficit, 0);

  await api.undoFinishSession(pin);
  await api.finishSession(pin, 200000, 'custom', 10000);
  session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.courtFee.surplus, 0);
  assert.equal(session.courtFee.deficit, 50000);
  console.log('PASS FEAT-03 custom court fee handles omitted total and deficit cleanly');
}

// FEAT-04: Dọn khóa đối xứng khi cập nhật cược kèm đối thủ
{
  state.values.clear();
  const { pin } = await api.createSession(['An', 'Bình', 'Cường']);
  const setId = await api.startNewSet(pin, 5000);
  const pids = Object.keys(JSON.parse(state.values.get(`local_session_${pin}`)).players);
  const [a1, b1, b2] = pids;
  await api.updatePlayerBet(pin, setId, a1, { poolAmount: 10000, sideOpponents: { [b1]: 10000, [b2]: 15000 } });
  await api.updatePlayerBet(pin, setId, b1, { sideOpponents: { [a1]: 20000 } });
  let session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.sets[setId].playerBets[a1].sideOpponents[b1], undefined);
  assert.equal(session.sets[setId].playerBets[a1].sideOpponents[b2], 15000);
  assert.equal(session.sets[setId].playerBets[b1].sideOpponents[a1], 20000);

  // Xóa cược của B1 sẽ dọn cả kèo giữa B1 và A1; nếu A1 chỉ còn poolAmount thì thu gọn về number
  await api.updatePlayerBet(pin, setId, b2, null);
  session = JSON.parse(state.values.get(`local_session_${pin}`));
  assert.equal(session.sets[setId].playerBets[a1], 10000);
  console.log('PASS FEAT-04 symmetric cleanup prevents stale mirror side bets');
}

// FEAT-05: Hit test vùng thả kéo thành viên
{
  const rects = {
    teamA: { x: 12, y: 120, width: 170, height: 220 },
    teamB: { x: 194, y: 120, width: 170, height: 220 },
    teamC: { x: 12, y: 356, width: 352, height: 84 },
    waiting: { x: 12, y: 456, width: 352, height: 150 },
  };
  assert.equal(findDropTarget(80, 200, rects), 'teamA');
  assert.equal(findDropTarget(250, 200, rects), 'teamB');
  assert.equal(findDropTarget(200, 390, rects), 'teamC');
  assert.equal(findDropTarget(180, 500, rects), 'waiting');
  assert.equal(findDropTarget(8, 200, rects, 6), 'teamA'); // trong biên slop 6px
  assert.equal(findDropTarget(400, 50, rects), null);
  console.log('PASS FEAT-05 findDropTarget identifies playing, resting, and waiting zones');
}

console.log('Session features check OK (5 cases)');

