import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

export type SwipeDirection = 'left' | 'right';

/** The movement after which a gesture is locked to one axis. */
const LOCK_PX = 10;
/** The duration of the slide out and of the return. */
export const SWIPE_MS = 180;
/** A fling commits from this distance when the finger leaves fast enough. */
const FLING_MIN_PX = 40;
const FLING_PX_PER_MS = 0.6;
/** The speed of the finger is measured over this last part of the gesture. */
const VELOCITY_WINDOW_MS = 100;
/** A card that slid out but is still in the list after this time returns, for example after a failed request. */
const LEAVE_FALLBACK_MS = 1000;
/** A click this soon after a sideways drag comes from the drag, not from a tap. */
const CLICK_AFTER_SWIPE_MS = 400;
/** The channel between cards, so a card that leaves clears its slot. */
const CHANNEL_PX = 6;
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** How far a card moves before a release takes the action: 30% of its width, at least 72px and at most 140px. */
export function swipeThreshold(width: number): number {
  return Math.min(140, Math.max(72, width * 0.3));
}

export interface SwipeState {
  /** The side the card moves to, or null while it is in its place. */
  direction: SwipeDirection | null;
  /** True when a release would take the action. */
  armed: boolean;
}

export interface SwipeOptions {
  /** The directions that have an action. The card does not move in the others. */
  allowed: Record<SwipeDirection, boolean>;
  /** True when the card slides out after a release in this direction. Otherwise it returns to its place. */
  leaves: (direction: SwipeDirection) => boolean;
  onSwipe: (direction: SwipeDirection) => void;
}

interface Gesture {
  pointerId: number;
  x0: number;
  y0: number;
  axis: 'x' | 'y' | null;
  offset: number;
  width: number;
  samples: Array<{ t: number; x: number }>;
}

const IDLE: SwipeState = { direction: null, armed: false };

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A sideways swipe on a card, for touch input only. The card follows the finger through a ref,
 * so a move does not render the list again. The browser keeps vertical scrolling: the card needs
 * `touch-action: pan-y pinch-zoom`, and a gesture that starts mostly vertical is ignored.
 */
export function useSwipe<T extends HTMLElement>({ allowed, leaves, onSwipe }: SwipeOptions) {
  const cardRef = useRef<T>(null);
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Until this time a pointer click on the card belongs to a swipe and is stopped. */
  const stopClickUntil = useRef(0);
  /** From the release that commits a swipe until the card is gone or back in its place. */
  const leaving = useRef(false);
  /** A committed swipe whose action has not run yet, while the card slides out. */
  const pending = useRef<SwipeDirection | null>(null);
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const [state, setState] = useState<SwipeState>(IDLE);
  const shown = useRef<SwipeState>(IDLE);

  const show = useCallback((next: SwipeState) => {
    if (next.direction === shown.current.direction && next.armed === shown.current.armed) return;
    shown.current = next;
    setState(next);
  }, []);

  const moveTo = useCallback((x: number, animate: boolean) => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = animate && !reducedMotion() ? `transform ${SWIPE_MS}ms ${EASE}` : 'none';
    card.style.transform = x === 0 ? '' : `translateX(${x}px)`;
  }, []);

  const clearTimer = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  /** Back to the place, then the layer behind the card goes away. */
  const settle = useCallback(() => {
    moveTo(0, true);
    clearTimer();
    timer.current = setTimeout(() => show(IDLE), reducedMotion() ? 0 : SWIPE_MS);
  }, [moveTo, show]);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      // The card left the list before its slide out ended, for example by a fast scroll. The swipe still counts.
      const direction = pending.current;
      pending.current = null;
      if (direction) onSwipeRef.current(direction);
    },
    [],
  );

  const onPointerDown = (e: PointerEvent<T>) => {
    // A new touch or press starts a new gesture. The click guard of the last swipe ends here.
    stopClickUntil.current = 0;
    // A card on its way out takes no new gesture, so a touch cannot stop the swipe.
    if (leaving.current || e.pointerType !== 'touch' || gesture.current) return;
    if (!allowed.left && !allowed.right) return;
    clearTimer();
    gesture.current = {
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      axis: null,
      offset: 0,
      width: cardRef.current?.offsetWidth ?? 0,
      samples: [{ t: performance.now(), x: e.clientX }],
    };
  };

  const onPointerMove = (e: PointerEvent<T>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (g.axis === 'y') return;
      try {
        cardRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may already be gone. The gesture still works without the capture.
      }
    }
    if (g.axis !== 'x') return;
    const offset = (dx < 0 && !allowed.left) || (dx > 0 && !allowed.right) ? 0 : dx;
    g.offset = offset;
    const now = performance.now();
    g.samples.push({ t: now, x: e.clientX });
    while (g.samples.length > 2 && now - (g.samples[0]?.t ?? now) > VELOCITY_WINDOW_MS) g.samples.shift();
    moveTo(offset, false);
    show({ direction: offset < 0 ? 'left' : offset > 0 ? 'right' : null, armed: Math.abs(offset) >= swipeThreshold(g.width) });
  };

  const onPointerUp = (e: PointerEvent<T>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null;
    const now = performance.now();
    // A sideways drag is no tap, also in a direction that has no action. The click that may follow it is stopped.
    if (g.axis === 'x') stopClickUntil.current = now + CLICK_AFTER_SWIPE_MS;
    if (g.axis !== 'x' || g.offset === 0) {
      settle();
      return;
    }
    const direction: SwipeDirection = g.offset < 0 ? 'left' : 'right';
    // The release is a sample too: a finger that stopped before it lifts has no speed.
    g.samples.push({ t: now, x: e.clientX });
    while (g.samples.length > 2 && now - (g.samples[0]?.t ?? now) > VELOCITY_WINDOW_MS) g.samples.shift();
    const first = g.samples[0];
    const last = g.samples[g.samples.length - 1];
    const velocity = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const far = Math.abs(g.offset) >= swipeThreshold(g.width);
    const fling = Math.abs(g.offset) >= FLING_MIN_PX && Math.sign(velocity) === Math.sign(g.offset) && Math.abs(velocity) >= FLING_PX_PER_MS;
    if (!far && !fling) {
      settle();
      return;
    }
    if (!leaves(direction)) {
      settle();
      onSwipe(direction);
      return;
    }
    show({ direction, armed: true });
    moveTo((direction === 'left' ? -1 : 1) * (g.width + CHANNEL_PX), true);
    clearTimer();
    leaving.current = true;
    pending.current = direction;
    timer.current = setTimeout(
      () => {
        pending.current = null;
        onSwipeRef.current(direction);
        // The list removes the card. When it does not, for example because the request failed, the card returns.
        timer.current = setTimeout(() => {
          leaving.current = false;
          moveTo(0, false);
          show(IDLE);
        }, LEAVE_FALLBACK_MS);
      },
      reducedMotion() ? 0 : SWIPE_MS,
    );
  };

  const onPointerCancel = (e: PointerEvent<T>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null;
    if (g.axis === 'x') stopClickUntil.current = performance.now() + CLICK_AFTER_SWIPE_MS;
    settle();
  };

  /**
   * A swipe is no tap: neither the open button nor the select box may react to the click that follows it.
   * A click from the keyboard or from assistive technology has no pointer (detail 0) and always goes through,
   * except on a card that is on its way out.
   */
  const onClickCapture = (e: MouseEvent<T>) => {
    const fromSwipe = e.detail !== 0 && performance.now() < stopClickUntil.current;
    if (!leaving.current && !fromSwipe) return;
    stopClickUntil.current = 0;
    e.preventDefault();
    e.stopPropagation();
  };

  return { cardRef, state, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } };
}
