// Chạy component thật bằng JSX transform sẵn có; thay runtime React Native/Router.
// Kiểm tra dependency của effect qua các lần render, không kiểm tra chuỗi mã nguồn.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';

const slots = [];
const effects = [];
let cursor = 0;
let dirty = false;
let selectedFixture;
let notifySession;
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => {
      const next = typeof value === 'function' ? value(slots[index]) : value;
      if (!Object.is(next, slots[index])) {
        slots[index] = next;
        dirty = true;
      }
    }];
  },
  useEffect(setup, deps) {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || !sameDeps(previous.deps, deps)) {
      slots[index] = { deps };
      effects.push(setup);
    }
  },
};
const jsx = (type, props) => ({ type, props });
const native = {
  Platform: { OS: 'web' },
  StyleSheet: { create: styles => styles },
  ...Object.fromEntries(['Alert', 'KeyboardAvoidingView', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map(name => [name, name])),
};
const api = {
  subscribeToSession(_pin, notify) { notifySession = notify; notify(selectedFixture); return () => {}; },
};
const source = fs.readFileSync(new URL('../src/app/session.js', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  filename: 'session.js',
  configFile: false,
  babelrc: false,
  plugins: [['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }], '@babel/plugin-transform-modules-commonjs'],
});
const module = { exports: {} };
const context = vm.createContext({
  module,
  exports: module.exports,
  require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return native;
    if (name === 'expo-router') return { router: {}, useLocalSearchParams: () => ({ pin: 'L-CHECK', role: 'host' }) };
    if (name === '@react-native-async-storage/async-storage') return { setItem: async () => {} };
    if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (name === '../constants/theme') return { DuoTheme: { colors: {}, borderRadius: {}, shadows: {} } };
    if (name === '../lib/sessionApi') return api;
    if (name === '../lib/bettingEngine') return { calculateSettlement: () => ({ balanceChanges: {} }) };
    throw new Error(`Unexpected import: ${name}`);
  },
});
vm.runInContext(code, context);
const render = () => {
  let tree;
  for (let attempt = 0; attempt < 10; attempt++) {
    cursor = 0;
    dirty = false;
    tree = module.exports.default();
    for (const effect of effects.splice(0)) effect();
    if (!dirty) return tree;
  }
  throw new Error('Component did not settle');
};
const nodes = tree => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
};
const text = tree => {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return text(tree.props?.children);
};
const clickText = (tree, label) => {
  const target = nodes(tree).find(node => node.props?.onPress && text(node) === label);
  assert.ok(target, `Missing action: ${label}; available: ${nodes(tree).filter(node => node.props?.onPress).map(text).join(' | ')}`);
  target.props.onPress();
  return render();
};
const clickContaining = (tree, label) => {
  const target = nodes(tree).find(node => node.props?.onPress && text(node).includes(label));
  assert.ok(target, `Missing action containing ${label}; available: ${nodes(tree).filter(node => node.props?.onPress).map(text).join(' | ')}`);
  target.props.onPress();
  return render();
};
const sideInput = tree => {
  const inputs = nodes(tree).filter(node => node.type === 'TextInput' && node.props.keyboardType === 'numeric');
  assert.ok(inputs.length, 'Missing side bet input');
  return inputs.at(-1);
};
const fixture = () => ({
  meta: { teams: ['teamA', 'teamB'] }, players: {}, sets: {}, sideSets: {},
  sideMatches: { a: { name: 'Kèo A', betAmount: 5000 }, b: { name: 'Kèo B', betAmount: 10000 } },
});
selectedFixture = fixture();
let tree = render();
tree = clickText(tree, 'Trận đấu chính');
tree = clickContaining(tree, 'Kèo A');
assert.equal(sideInput(tree).props.value, '5.000');
sideInput(tree).props.onChangeText('12345');
tree = render();
assert.equal(sideInput(tree).props.value, '12.345');
// AsyncStorage returns a fresh object after an unrelated player update, with the same side-set bet.
const updatedFixture = fixture();
updatedFixture.players = { guest: { name: 'Khách', balance: 0 } };
notifySession(updatedFixture);
tree = render();
assert.equal(sideInput(tree).props.value, '12.345', 'Unrelated session update must preserve side bet draft');
console.log('PASS SIDE-INPUT-01 unrelated update preserves draft');

// Chuyển kèo phải nhận mức cược của kèo mới, kể cả quay về kèo A.
tree = clickContaining(tree, 'Kèo B');
assert.equal(sideInput(tree).props.value, '10.000');
tree = clickContaining(tree, 'Kèo A');
assert.equal(sideInput(tree).props.value, '5.000');
console.log('PASS SIDE-INPUT-02 switching matches syncs their own bet');

const sideSet = (betAmount, status = 'completed') => ({
  sideMatchId: 'a', status, winner: null, betAmount,
  teams: { teamA: { slots: {} }, teamB: { slots: {} } },
});
let current = { ...fixture(), sideSets: { side_set_9: sideSet(5000), side_set_10: sideSet(0) } };
notifySession(current);
tree = render();
assert.equal(sideInput(tree).props.value, '0', 'Latest set is sorted numerically and zero is not a missing value');
current = { ...current, sideSets: { ...current.sideSets, side_set_10: sideSet(20000) } };
notifySession(current);
tree = render();
assert.equal(sideInput(tree).props.value, '20.000');
console.log('PASS SIDE-INPUT-03 saved changes and zero bet sync correctly');

sideInput(tree).props.onChangeText('30000');
tree = render();
assert.equal(sideInput(tree).props.value, '30.000');
current = { ...current, sideSets: { ...current.sideSets, side_set_11: sideSet(20000) } };
notifySession(current);
tree = render();
assert.equal(sideInput(tree).props.value, '20.000', 'New set ID resets draft even when saved amount is unchanged');
console.log('PASS SIDE-INPUT-04 new set with same amount resets previous draft');

sideInput(tree).props.onChangeText('25000');
tree = render();
current = JSON.parse(JSON.stringify(current));
current.sideSets.side_set_11.teams.teamA.slots.slot_1 = ['guest'];
current.sideSets.side_set_12 = { ...sideSet(99000), sideMatchId: 'b' };
notifySession(current);
tree = render();
assert.equal(sideInput(tree).props.value, '25.000', 'Team changes and another match must not reset draft');
console.log('PASS SIDE-INPUT-05 unrelated side updates preserve draft');

current = { ...current, sets: {
  set_8: { status: 'completed', winner: 'teamB' },
  set_9: { status: 'completed', winner: 'teamA' },
  set_10: { status: 'completed', winner: 'teamA' },
} };
notifySession(current);
tree = render();
const streak = nodes(tree).find(node => Array.isArray(node.props?.children)
  && node.props.children.some(child => child?.type === 'Icon' && child.props.name === 'flame'));
assert.ok(streak, 'Missing win streak badge');
assert.equal(text(streak), '2');
console.log('PASS SIDE-INPUT-06 win streak remains correct');
console.log('Session input check OK (6 cases)');
