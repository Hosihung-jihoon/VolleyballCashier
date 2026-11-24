import { useEffect, useMemo, useRef } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

/**
 * Finds the drop zone key whose measured window rectangle contains (x, y) within slop.
 */
export function findDropTarget(x, y, rectsMap, slop = 6) {
  if (!rectsMap || typeof rectsMap !== 'object') return null;
  for (const [key, rect] of Object.entries(rectsMap)) {
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    if (
      x >= rect.x - slop &&
      x <= rect.x + rect.width + slop &&
      y >= rect.y - slop &&
      y <= rect.y + rect.height + slop
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Long-press (250ms) + Pan wrapper that avoids stealing short taps or quick ScrollView scrolls.
 */
export function DraggablePlayer({
  disabled = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  children,
}) {
  const startRef = useRef(onDragStart);
  const moveRef = useRef(onDragMove);
  const endRef = useRef(onDragEnd);
  const didStartRef = useRef(false);

  useEffect(() => {
    startRef.current = onDragStart;
    moveRef.current = onDragMove;
    endRef.current = onDragEnd;
  }, [onDragStart, onDragMove, onDragEnd]);

  const gesture = useMemo(() => {
    if (disabled || !Gesture?.Pan) return null;
    return Gesture.Pan()
      .activateAfterLongPress(250)
      .runOnJS(true)
      .onStart((e) => {
        didStartRef.current = true;
        startRef.current?.(e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        if (didStartRef.current) {
          moveRef.current?.(e.absoluteX, e.absoluteY);
        }
      })
      .onFinalize((e) => {
        if (didStartRef.current) {
          didStartRef.current = false;
          endRef.current?.(e.absoluteX, e.absoluteY);
        }
      });
  }, [disabled]);

  if (!gesture) return children;
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

