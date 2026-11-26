import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SWIPE_MS, swipeThreshold, useSwipe, type SwipeDirection } from './useSwipe';

function Card({
  allowed = { left: true, right: true },
  leaves = () => true,
  onSwipe,
  onOpen = () => {},
}: {
  allowed?: Record<SwipeDirection, boolean>;
  leaves?: (d: SwipeDirection) => boolean;
  onSwipe: (d: SwipeDirection) => void;
  onOpen?: () => void;
}) {
  const { cardRef, state, handlers } = useSwipe<HTMLDivElement>({ allowed, leaves, onSwipe });
  return (
    <div data-testid="card" ref={cardRef} data-direction={state.direction ?? ''} data-armed={String(state.armed)} {...handlers}>
      <button type="button" onClick={onOpen}>
        Open
      </button>
    </div>
  );
}

const card = () => screen.getByTestId('card');

/** Puts a pointer down at the first point, moves it through the others, and lifts it unless `lift` is false. */
function drag(
  points: [[number, number], ...Array<[number, number]>],
  { type = 'touch', stepMs = 16, lift = true }: { type?: string; stepMs?: number; lift?: boolean } = {},
) {
  const at = ([x, y]: [number, number]) => ({ pointerId: 1, pointerType: type, clientX: x, clientY: y });
  fireEvent.pointerDown(card(), at(points[0]));
  for (const p of points.slice(1)) {
    act(() => vi.advanceTimersByTime(stepMs));
    fireEvent.pointerMove(card(), at(p));
  }
  if (lift) fireEvent.pointerUp(card(), at(points[points.length - 1] ?? points[0]));
}

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('useSwipe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes 30% of the card width as the threshold, between 72 and 140px', () => {
    expect(swipeThreshold(430)).toBe(129);
    expect(swipeThreshold(200)).toBe(72);
    expect(swipeThreshold(800)).toBe(140);
  });

  it('slides the card out to the left and then reports the swipe', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    // The test setup gives every element a width of 800px, so the threshold is 140px.
    drag(
      [
        [300, 100],
        [285, 100],
        [150, 100],
        [100, 100],
      ],
      { stepMs: 200 },
    );
    expect(card().style.transform).toBe('translateX(-806px)');
    expect(onSwipe).not.toHaveBeenCalled();
    wait(SWIPE_MS);
    expect(onSwipe).toHaveBeenCalledExactlyOnceWith('left');
  });

  it('slides the card out to the right and then reports the swipe', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    drag(
      [
        [100, 100],
        [115, 100],
        [300, 100],
      ],
      { stepMs: 200 },
    );
    expect(card().style.transform).toBe('translateX(806px)');
    wait(SWIPE_MS);
    expect(onSwipe).toHaveBeenCalledExactlyOnceWith('right');
  });

  it('names the side and arms only past the threshold while the finger moves', () => {
    render(<Card onSwipe={vi.fn()} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [250, 100],
      ],
      { lift: false },
    );
    expect(card()).toHaveAttribute('data-direction', 'left');
    expect(card()).toHaveAttribute('data-armed', 'false');
    expect(card().style.transform).toBe('translateX(-50px)');
    fireEvent.pointerMove(card(), { pointerId: 1, pointerType: 'touch', clientX: 150, clientY: 100 });
    expect(card()).toHaveAttribute('data-armed', 'true');
  });

  it('returns the card after a short, slow swipe and reports nothing', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [250, 100],
      ],
      { stepMs: 300 },
    );
    expect(card().style.transform).toBe('');
    wait(SWIPE_MS + 2000);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(card()).toHaveAttribute('data-direction', '');
  });

  it('commits a fast fling of 40px or more below the threshold', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [250, 100],
      ],
      { stepMs: 10 },
    );
    wait(SWIPE_MS);
    expect(onSwipe).toHaveBeenCalledExactlyOnceWith('left');
  });

  it('ignores a mouse drag, and a mouse click still opens', () => {
    const onSwipe = vi.fn();
    const onOpen = vi.fn();
    render(<Card onSwipe={onSwipe} onOpen={onOpen} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [100, 100],
      ],
      { type: 'mouse' },
    );
    expect(card().style.transform).toBe('');
    wait(SWIPE_MS + 2000);
    expect(onSwipe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('leaves a mostly vertical drag to the browser', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    drag([
      [300, 100],
      [304, 120],
      [320, 400],
    ]);
    expect(card().style.transform).toBe('');
    expect(card()).toHaveAttribute('data-direction', '');
    wait(SWIPE_MS + 2000);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('does not move the card in a direction without an action', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} allowed={{ left: false, right: true }} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [100, 100],
      ],
      { lift: false },
    );
    expect(card().style.transform).toBe('');
    expect(card()).toHaveAttribute('data-direction', '');
    fireEvent.pointerUp(card(), { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    wait(SWIPE_MS + 2000);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('starts no swipe on a card without any action', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} allowed={{ left: false, right: false }} />);
    drag([
      [300, 100],
      [285, 100],
      [500, 100],
    ]);
    expect(card().style.transform).toBe('');
    wait(SWIPE_MS + 2000);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('stops the click that follows a sideways drag, and a later tap opens', () => {
    const onOpen = vi.fn();
    render(<Card onSwipe={vi.fn()} onOpen={onOpen} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [260, 100],
      ],
      { stepMs: 300 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 1 });
    expect(onOpen).not.toHaveBeenCalled();
    // A tap: down and up in one place.
    drag([[200, 100]]);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 1 });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('lets a keyboard click through right after a swipe, and a pointer click once the swipe is past', () => {
    const onOpen = vi.fn();
    render(<Card onSwipe={vi.fn()} onOpen={onOpen} leaves={() => false} />);
    // A swipe that keeps the card in place. A real browser sends no click after it.
    drag(
      [
        [100, 100],
        [115, 100],
        [300, 100],
      ],
      { stepMs: 200 },
    );
    // Enter on the focused button gives a click without a pointer: detail 0.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 0 });
    expect(onOpen).toHaveBeenCalledOnce();
    wait(500);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('takes no speed from before a pause: a short swipe that stops before the lift changes nothing', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    // 50px fast, as in a fling, then the finger rests before it lifts.
    drag(
      [
        [300, 100],
        [285, 100],
        [250, 100],
      ],
      { stepMs: 10, lift: false },
    );
    wait(300);
    fireEvent.pointerUp(card(), { pointerId: 1, pointerType: 'touch', clientX: 250, clientY: 100 });
    wait(SWIPE_MS + 2000);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(card().style.transform).toBe('');
  });

  it('keeps a swipe when a touch lands on the card while it slides out', () => {
    const onSwipe = vi.fn();
    const onOpen = vi.fn();
    render(<Card onSwipe={onSwipe} onOpen={onOpen} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [100, 100],
      ],
      { stepMs: 200 },
    );
    wait(SWIPE_MS / 2);
    drag([[150, 100]]);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 1 });
    wait(SWIPE_MS);
    expect(onSwipe).toHaveBeenCalledExactlyOnceWith('left');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('reports a swipe whose card unmounts before the slide out ends', () => {
    const onSwipe = vi.fn();
    const { unmount } = render(<Card onSwipe={onSwipe} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [100, 100],
      ],
      { stepMs: 200 },
    );
    unmount();
    expect(onSwipe).toHaveBeenCalledExactlyOnceWith('left');
    wait(SWIPE_MS + 2000);
    expect(onSwipe).toHaveBeenCalledOnce();
  });

  it('returns the card at once and reports the swipe when the posting stays in the list', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} leaves={() => false} />);
    drag(
      [
        [100, 100],
        [115, 100],
        [300, 100],
      ],
      { stepMs: 200 },
    );
    expect(onSwipe).toHaveBeenCalledExactlyOnceWith('right');
    expect(card().style.transform).toBe('');
  });

  it('brings a card back that is still in the list a second after it slid out', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [100, 100],
      ],
      { stepMs: 200 },
    );
    wait(SWIPE_MS);
    expect(onSwipe).toHaveBeenCalledOnce();
    expect(card().style.transform).toBe('translateX(-806px)');
    wait(1000);
    expect(card().style.transform).toBe('');
    expect(card()).toHaveAttribute('data-direction', '');
  });

  it('returns the card when the browser cancels the pointer', () => {
    const onSwipe = vi.fn();
    render(<Card onSwipe={onSwipe} />);
    drag(
      [
        [300, 100],
        [285, 100],
        [100, 100],
      ],
      { lift: false },
    );
    fireEvent.pointerCancel(card(), { pointerId: 1, pointerType: 'touch' });
    expect(card().style.transform).toBe('');
    wait(SWIPE_MS + 2000);
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
