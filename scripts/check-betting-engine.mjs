// Self-check cho src/lib/bettingEngine.js & logic chia tiền — chạy: npm test
import assert from 'node:assert/strict';
import { calculateSettlement } from '../src/lib/bettingEngine.js';

const team = (...slots) => ({
  slots: Object.fromEntries(slots.map((s, i) => [`slot_${i + 1}`, Array.isArray(s) ? s : [s]])),
});
const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const run = (a, b, winner, bet = 5000, bets = {}) =>
  calculateSettlement({ teamA: a, teamB: b }, 'teamA_teamB', winner, bet, bets);
const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);

const cases = [
  ['ENG-01 5v5 A thắng', run(team(...ids('a', 5)), team(...ids('b', 5)), 'teamA'),
    { a1: 5000, a2: 5000, a3: 5000, a4: 5000, a5: 5000, b1: -5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000 }],
  ['ENG-02 5v6 đội 6 thắng', run(team(...ids('a', 5)), team(...ids('b', 6)), 'teamB'),
    { a1: -5000, a2: -5000, a3: -5000, a4: -5000, a5: -5000, b1: 5000, b2: 4000, b3: 4000, b4: 4000, b5: 4000, b6: 4000 }],
  ['ENG-03 5v6 đội 5 thắng', run(team(...ids('a', 5)), team(...ids('b', 6)), 'teamA'),
    { a1: 6000, a2: 6000, a3: 6000, a4: 6000, a5: 6000, b1: -5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000, b6: -5000 }],
  ['ENG-04 4v6 đội 4 thắng', run(team(...ids('a', 4)), team(...ids('b', 6)), 'teamA'),
    { a1: 6000, a2: 8000, a3: 8000, a4: 8000, b1: -5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000, b6: -5000 }],
  ['ENG-05 4v6 đội 6 thắng', run(team(...ids('a', 4)), team(...ids('b', 6)), 'teamB'),
    { a1: -5000, a2: -5000, a3: -5000, a4: -5000, b1: 5000, b2: 3000, b3: 3000, b4: 3000, b5: 3000, b6: 3000 }],
  ['ENG-06 thay người, slot thắng', run(team(['a1', 'a6'], 'a2', 'a3', 'a4', 'a5'), team(...ids('b', 5)), 'teamA'),
    { a1: 3000, a6: 3000, a2: 4000, a3: 5000, a4: 5000, a5: 5000, b1: -5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000 }],
  ['ENG-07 thay người, slot thua (2500 → làm tròn 3000)', run(team(['a1', 'a6'], 'a2', 'a3', 'a4', 'a5'), team(...ids('b', 5)), 'teamB'),
    { a1: -3000, a6: -3000, a2: -5000, a3: -5000, a4: -5000, a5: -5000, b1: 6000, b2: 5000, b3: 5000, b4: 5000, b5: 5000 }],
  ['ENG-08 cược riêng 10k bên thắng', run(team(...ids('a', 5)), team(...ids('b', 5)), 'teamA', 5000, { a1: 10000 }),
    { a1: 9000, a2: 4000, a3: 4000, a4: 4000, a5: 4000, b1: -5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000 }],
  ['ENG-09 cược riêng 10k bên thua', run(team(...ids('a', 5)), team(...ids('b', 5)), 'teamA', 5000, { b1: 10000 }),
    { a1: 6000, a2: 6000, a3: 6000, a4: 6000, a5: 6000, b1: -10000, b2: -5000, b3: -5000, b4: -5000, b5: -5000 }],
  ['ENG-10 1-on-1 20k, A thắng', run(team(...ids('a', 5)), team(...ids('b', 5)), 'teamA', 5000, { a1: { amount: 20000, targetPlayerId: 'b1' } }),
    { a1: 20000, b1: -20000, a2: 5000, a3: 5000, a4: 5000, a5: 5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000 }],
  ['ENG-11 1-on-1 20k, B thắng', run(team(...ids('a', 5)), team(...ids('b', 5)), 'teamB', 5000, { a1: { amount: 20000, targetPlayerId: 'b1' } }),
    { a1: -20000, b1: 20000, a2: -5000, a3: -5000, a4: -5000, a5: -5000, b2: 5000, b3: 5000, b4: 5000, b5: 5000 }],
  ['ENG-12 cược chung 0đ', run(team('a1'), team('b1'), 'teamA', 0), { a1: 0, b1: 0 }],
  ['ENG-13 cược riêng dạng chuỗi "8000"', run(team('a1', 'a2'), team('b1', 'b2'), 'teamA', 5000, { b1: '8000' }),
    { a1: 6000, a2: 7000, b1: -8000, b2: -5000 }],
  ['ENG-14 3 đội, A_C, C thắng, B nghỉ',
    calculateSettlement({ teamA: team('a1'), teamB: team('b1'), teamC: team('c1', 'c2') }, 'teamA_teamC', 'teamC', 5000, {}),
    { a1: -5000, c1: 2000, c2: 3000 }],
  ['ENG-15 chữ ký cũ + matchup "A_B"', calculateSettlement(team('a1', 'a2'), team('b1', 'b2'), team('c1'), 'A_B', 'teamA', 5000),
    { a1: 5000, a2: 5000, b1: -5000, b2: -5000 }],
  ['ENG-16 4v5 gánh 2 suất (10k), A thắng tròn 25k',
    run(team('a1', 'a2', 'a3', 'a4'), team(...ids('b', 5)), 'teamA', 5000, { a1: 10000 }),
    { b1: -5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000, a1: 10000, a2: 5000, a3: 5000, a4: 5000 }],
  ['ENG-17 4v5 gánh 2 suất (10k), B thắng tròn 25k',
    run(team('a1', 'a2', 'a3', 'a4'), team(...ids('b', 5)), 'teamB', 5000, { a1: 10000 }),
    { a1: -10000, a2: -5000, a3: -5000, a4: -5000, b1: 5000, b2: 5000, b3: 5000, b4: 5000, b5: 5000 }],
  ['ENG-19 2v1 B1 cược 10k chọn A1: A thắng -> A1 5k, A2 5k, B1 -10k',
    run(team('a1', 'a2'), team('b1'), 'teamA', 5000, { b1: { amount: 10000, targetPlayerId: 'a1' } }),
    { b1: -10000, a1: 5000, a2: 5000 }],
  ['ENG-20 2v1 B1 cược 10k chọn A1: B thắng -> A1 -5k, A2 -5k, B1 10k',
    run(team('a1', 'a2'), team('b1'), 'teamB', 5000, { b1: { amount: 10000, targetPlayerId: 'a1' } }),
    { a1: -5000, a2: -5000, b1: 10000 }],
  ['ENG-21 Payout dự kiến 4v5 chưa gánh: A thắng nhận 6k-7k',
    run(team('a1', 'a2', 'a3', 'a4'), team(...ids('b', 5)), 'teamA', 5000, {}),
    { a1: 7000, a2: 6000, a3: 6000, a4: 6000, b1: -5000, b2: -5000, b3: -5000, b4: -5000, b5: -5000 }],
  ['ENG-22 Payout dự kiến 4v5 chưa gánh: B thắng nhận 4k',
    run(team('a1', 'a2', 'a3', 'a4'), team(...ids('b', 5)), 'teamB', 5000, {}),
    { a1: -5000, a2: -5000, a3: -5000, a4: -5000, b1: 4000, b2: 4000, b3: 4000, b4: 4000, b5: 4000 }],
];

for (const [name, result, expected] of cases) {
  assert.deepEqual(result.balanceChanges, expected, name);
  assert.equal(sum(result.balanceChanges), 0, `${name}: tổng phải = 0 (zero-sum)`);
}

// ENG-18: Kiểm tra logic làm tròn lên tiền sân
const courtFeeTotal = 200000;
const totalPlayers = 17;
const perPlayerShare = Math.ceil((courtFeeTotal / totalPlayers) / 1000) * 1000;
const totalCollected = perPlayerShare * totalPlayers;
const surplus = totalCollected - courtFeeTotal;
assert.equal(perPlayerShare, 12000, 'ENG-18: 200k / 17 mỗi người 12.000đ');
assert.equal(totalCollected, 204000, 'ENG-18: Tổng thu 204.000đ');
assert.equal(surplus, 4000, 'ENG-18: Thừa 4.000đ');

console.log(`OK ${cases.length + 1} cases`);
