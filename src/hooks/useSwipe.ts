import { useRef, useCallback, type RefObject } from 'react';

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

interface SwipeState {
  startX: number;
  startY: number;
  currentX: number;
  swiping: boolean;
}

export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  handlers: SwipeHandlers,
  threshold: number = 80,
) {
  const stateRef = useRef<SwipeState>({ startX: 0, startY: 0, currentX: 0, swiping: false });

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    stateRef.current = { startX: touch.clientX, startY: touch.clientY, currentX: touch.clientX, swiping: true };
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!stateRef.current.swiping) return;
    const touch = e.touches[0];
    const dx = touch.clientX - stateRef.current.startX;
    const dy = touch.clientY - stateRef.current.startY;

    // Cancel swipe if vertical movement exceeds horizontal (user is scrolling)
    if (Math.abs(dy) > Math.abs(dx)) {
      stateRef.current.swiping = false;
      if (ref.current) ref.current.style.transform = '';
      return;
    }

    stateRef.current.currentX = touch.clientX;

    if (ref.current) {
      const clamped = Math.max(-120, Math.min(120, dx));
      ref.current.style.transform = `translateX(${clamped}px)`;
      ref.current.style.transition = 'none';
    }
  }, [ref]);

  const onTouchEnd = useCallback(() => {
    if (!stateRef.current.swiping) return;
    stateRef.current.swiping = false;

    const dx = stateRef.current.currentX - stateRef.current.startX;

    if (ref.current) {
      ref.current.style.transition = 'transform 0.2s ease-out';
      ref.current.style.transform = '';
    }

    if (dx > threshold && handlers.onSwipeRight) {
      handlers.onSwipeRight();
    } else if (dx < -threshold && handlers.onSwipeLeft) {
      handlers.onSwipeLeft();
    }
  }, [ref, handlers, threshold]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
