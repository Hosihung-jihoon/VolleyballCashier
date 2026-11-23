// Kiểm tra logic tính khoảng trống bàn phím và runtime KeyboardSafeModal qua component thật.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';

const slots = [];
const effects = [];
const cleanups = [];
let cursor = 0;
let dirty = false;
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
      const prevCleanup = cleanups[index];
      if (typeof prevCleanup === 'function') prevCleanup();
      slots[index] = { deps };
      effects.push(() => {
        cleanups[index] = setup();
      });
    }
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
};

const listeners = new Map();
const backListeners = new Set();
let keyboardVisible = false;
let keyboardMetrics = null;
const insets = { top: 32, right: 0, bottom: 40, left: 0 };

const native = {
  Platform: { OS: 'android' },
  StyleSheet: { create: styles => styles },
  View: 'View',
  Keyboard: {
    isVisible: () => keyboardVisible,
    metrics: () => keyboardMetrics,
    addListener: (event, cb) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return { remove: () => listeners.get(event)?.delete(cb) };
    },
    scheduleLayoutAnimation: () => {},
  },
  BackHandler: {
    addEventListener: (_event, cb) => {
      backListeners.add(cb);
      return { remove: () => backListeners.delete(cb) };
    },
  },
};

const source = fs.readFileSync(new URL('../src/components/keyboard-safe-view.js', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  filename: 'keyboard-safe-view.js',
  configFile: false,
  babelrc: false,
  plugins: [['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }], '@babel/plugin-transform-modules-commonjs'],
});

const module = { exports: {} };
const jsx = (type, props) => ({ type, props });
const context = vm.createContext({
  module,
  exports: module.exports,
  require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => insets };
    throw new Error(`Unexpected import: ${name}`);
  },
});
vm.runInContext(code, context);

const { computeKeyboardBottomPadding, KeyboardSafeModal } = module.exports;

// KB-01: Android edge-to-edge (osShrink = 0) adds bottomInset compensation and resets cleanly on hide
assert.equal(
  computeKeyboardBottomPadding({ platform: 'android', keyboardHeight: 302, bottomInset: 48, baseHeight: 812, currentHeight: 812, extraBottomPadding: 16 }),
  366
);
assert.equal(
  computeKeyboardBottomPadding({ platform: 'android', keyboardHeight: 0, bottomInset: 48, baseHeight: 812, currentHeight: 812, extraBottomPadding: 16 }),
  64
);
console.log('PASS KB-01 Android edge-to-edge compensation and hide reset');

// KB-02: Legacy Android OS resize (osShrink >= keyboardHeight) avoids double padding
assert.equal(
  computeKeyboardBottomPadding({ platform: 'android', keyboardHeight: 302, bottomInset: 0, baseHeight: 812, currentHeight: 510, extraBottomPadding: 16 }),
  16
);
console.log('PASS KB-02 Legacy Android OS resize avoids double padding');

// KB-03: iOS uses max(kb, inset) without double-counting home indicator
assert.equal(
  computeKeyboardBottomPadding({ platform: 'ios', keyboardHeight: 336, bottomInset: 34, extraBottomPadding: 16 }),
  352
);
assert.equal(
  computeKeyboardBottomPadding({ platform: 'ios', keyboardHeight: 0, bottomInset: 34, extraBottomPadding: 16 }),
  50
);
console.log('PASS KB-03 iOS padding and hide reset');

// KB-04: Web relies on browser viewport resize
assert.equal(
  computeKeyboardBottomPadding({ platform: 'web', keyboardHeight: 300, bottomInset: 20, extraBottomPadding: 16 }),
  16
);
console.log('PASS KB-04 Web returns extraBottomPadding only');

const renderModal = (props) => {
  let tree;
  for (let attempt = 0; attempt < 10; attempt++) {
    cursor = 0;
    dirty = false;
    tree = KeyboardSafeModal(props);
    for (const effect of effects.splice(0)) effect();
    if (!dirty) return tree;
  }
  throw new Error('Modal did not settle');
};

const resetHooks = () => {
  cleanups.forEach(fn => typeof fn === 'function' && fn());
  slots.length = 0;
  effects.length = 0;
  cleanups.length = 0;
  listeners.clear();
  backListeners.clear();
};

const flatStyle = (styleProp) => Object.assign({}, ...(Array.isArray(styleProp) ? styleProp : [styleProp]).filter(Boolean));

// KB-05: Hidden modal renders null and registers no BackHandler listener
resetHooks();
let closedCount = 0;
let tree = renderModal({ visible: false, onRequestClose: () => { closedCount++; }, children: 'body' });
assert.equal(tree, null);
assert.equal(backListeners.size, 0);
console.log('PASS KB-05 Hidden modal renders null with no BackHandler');

// KB-06: Mounted while keyboard is already visible (autoFocus) applies clearance immediately, and hide resets
resetHooks();
keyboardVisible = true;
keyboardMetrics = { height: 280 };
tree = renderModal({ visible: true, onRequestClose: () => { closedCount++; }, children: 'body' });
let styleObj = flatStyle(tree.props.style);
assert.equal(styleObj.paddingBottom, 336);
assert.equal(styleObj.paddingTop, 40);

keyboardVisible = false;
keyboardMetrics = null;
for (const cb of listeners.get('keyboardDidHide') || []) cb();
tree = renderModal({ visible: true, onRequestClose: () => { closedCount++; }, children: 'body' });
styleObj = flatStyle(tree.props.style);
assert.equal(styleObj.paddingBottom, 56);
console.log('PASS KB-06 Initial visible keyboard clearance and hide reset');

// KB-07: Android hardware back closes modal and cleans up on hide
assert.equal(backListeners.size, 1);
const [backCb] = [...backListeners];
assert.equal(backCb(), true);
assert.equal(closedCount, 1);
tree = renderModal({ visible: false, onRequestClose: () => { closedCount++; }, children: 'body' });
assert.equal(tree, null);
assert.equal(backListeners.size, 0);
console.log('PASS KB-07 BackHandler closes modal and cleans up listener');
console.log('Keyboard avoidance check OK (7 cases)');

