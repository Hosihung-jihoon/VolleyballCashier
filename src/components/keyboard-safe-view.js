import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const nonNeg = (value) => Math.max(0, Number(value) || 0);

/**
 * Computes bottom padding needed to keep focused inputs and actions clear of
 * the soft keyboard across Android edge-to-edge, legacy Android resize, iOS, and Web.
 */
export function computeKeyboardBottomPadding({
  platform,
  keyboardHeight = 0,
  bottomInset = 0,
  baseHeight = 0,
  currentHeight = 0,
  extraBottomPadding = 0,
}) {
  const kb = nonNeg(keyboardHeight);
  const inset = nonNeg(bottomInset);
  const base = nonNeg(baseHeight);
  const curr = nonNeg(currentHeight);
  const extra = nonNeg(extraBottomPadding);

  if (platform === 'web') {
    return extra;
  }

  if (platform === 'ios') {
    return (kb > 0 ? Math.max(kb, inset) : inset) + extra;
  }

  if (kb === 0) {
    return inset + extra;
  }

  const osShrink = base > 0 && curr > 0 ? Math.max(0, base - curr) : 0;
  // ponytail: RN 0.83 ReactRootView.java:922 emits imeInsets.bottom - barInsets.bottom,
  // so under edgeToEdgeEnabled=true (osShrink < 24) we add bottomInset back;
  // on legacy Android where the OS already resized the window, subtracting osShrink avoids double padding.
  const needsBarCompensation = osShrink < 24;
  const kbClearance = Math.max(0, kb - osShrink) + (needsBarCompensation ? inset : 0);
  return kbClearance + extra;
}

function useKeyboardHeight(enabled, onKeyboardShow) {
  const onKeyboardShowRef = useRef(onKeyboardShow);
  const [keyboardHeight, setKeyboardHeight] = useState(() => {
    if (!enabled || Platform.OS === 'web') return 0;
    return Keyboard.isVisible?.() ? (Keyboard.metrics?.()?.height || 0) : 0;
  });

  useEffect(() => {
    onKeyboardShowRef.current = onKeyboardShow;
  }, [onKeyboardShow]);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return undefined;

    const handleShow = (event, animate) => {
      if (animate) Keyboard.scheduleLayoutAnimation?.(event);
      const height = nonNeg(event?.endCoordinates?.height);
      setKeyboardHeight(height);
      if (height > 0) {
        onKeyboardShowRef.current?.(height);
      }
    };

    const handleHide = (event, animate) => {
      if (animate) Keyboard.scheduleLayoutAnimation?.(event);
      setKeyboardHeight(0);
    };

    const subs = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillShow', (e) => handleShow(e, true)),
          Keyboard.addListener('keyboardWillChangeFrame', (e) => handleShow(e, true)),
          Keyboard.addListener('keyboardWillHide', (e) => handleHide(e, true)),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', (e) => handleShow(e, false)),
          Keyboard.addListener('keyboardDidHide', () => handleHide(null, false)),
        ];

    return () => {
      subs.forEach((sub) => sub?.remove?.());
    };
  }, [enabled]);

  return enabled ? keyboardHeight : 0;
}

function useKeyboardLayoutHeights(keyboardHeight, externalOnLayout) {
  const [layoutHeights, setLayoutHeights] = useState({ base: 0, current: 0 });

  const handleLayout = (event) => {
    externalOnLayout?.(event);
    const height = nonNeg(event?.nativeEvent?.layout?.height);
    if (height <= 0) return;

    setLayoutHeights((prev) => {
      if (keyboardHeight === 0) {
        return prev.base === height && prev.current === height
          ? prev
          : { base: height, current: height };
      }
      const nextBase = Math.max(prev.base, height);
      return prev.base === nextBase && prev.current === height
        ? prev
        : { base: nextBase, current: height };
    });
  };

  return { layoutHeights, handleLayout };
}

/**
 * Full-height container that adjusts its bottom padding to clear the soft keyboard
 * without relying on RN's broken Android edge-to-edge KeyboardAvoidingView.
 */
export function KeyboardSafeView({
  style,
  extraBottomPadding = 0,
  onKeyboardShow,
  onLayout,
  children,
  ...rest
}) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(true, onKeyboardShow);
  const { layoutHeights, handleLayout } = useKeyboardLayoutHeights(keyboardHeight, onLayout);

  const paddingBottom = computeKeyboardBottomPadding({
    platform: Platform.OS,
    keyboardHeight,
    bottomInset: insets.bottom,
    baseHeight: layoutHeights.base,
    currentHeight: layoutHeights.current,
    extraBottomPadding,
  });

  return (
    <View {...rest} onLayout={handleLayout} style={[style, { paddingBottom }]}>
      {children}
    </View>
  );
}

/**
 * In-tree modal overlay rendered inside the same ReactRootView so Android edge-to-edge
 * keyboard metrics stay consistent across Android versions and Expo Go.
 */
export function KeyboardSafeModal({
  visible,
  onRequestClose,
  overlayStyle,
  children,
}) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(visible);
  const { layoutHeights, handleLayout } = useKeyboardLayoutHeights(keyboardHeight);
  const onRequestCloseRef = useRef(onRequestClose);
  const hasCloseHandler = typeof onRequestClose === 'function';

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android' || !hasCloseHandler) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestCloseRef.current?.();
      return true;
    });
    return () => sub?.remove?.();
  }, [visible, hasCloseHandler]);

  if (!visible) return null;

  const paddingBottom = computeKeyboardBottomPadding({
    platform: Platform.OS,
    keyboardHeight,
    bottomInset: insets.bottom,
    baseHeight: layoutHeights.base,
    currentHeight: layoutHeights.current,
    extraBottomPadding: 16,
  });
  const paddingTop = Math.max(16, (Platform.OS === 'web' ? 0 : insets.top) + 8);

  return (
    <View
      onLayout={handleLayout}
      accessibilityViewIsModal
      style={[styles.modalRoot, overlayStyle, { paddingTop, paddingBottom }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 24,
  },
});

