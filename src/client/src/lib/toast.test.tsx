import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { Toaster, getLastUndo, onUndone, resetToastsForTests, showToast, showUndoToast, undoLast, useLastUndo } from './toast';
import { useBottomBar } from './useBottomBar';

beforeEach(() => resetToastsForTests());
afterEach(() => {
  resetToastsForTests();
  vi.useRealTimers();
});

const rootVar = () => document.documentElement.style.getPropertyValue('--bottom-bar');

/** A bar at the bottom edge. jsdom has no layout, so the bar reports the height it is given. */
function Bar({ height }: { height: number | (() => number) }) {
  const ref = useRef<HTMLDivElement>(null);
  useBottomBar(ref);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, get: typeof height === 'function' ? height : () => height });
      }}
    />
  );
}

describe('toaster offset', () => {
  it('stands above the bar at the bottom edge by adding --bottom-bar to its offset', () => {
    const { rerender } = render(
      <>
        <Toaster />
        <Bar height={56} />
      </>,
    );
    expect(rootVar()).toBe('56px');
    const toaster = document.querySelector<HTMLElement>('[data-toaster]')!;
    expect(toaster.className).toContain('mb-[calc(0.75rem+var(--bottom-bar,0px))]');
    expect(toaster.className).toContain('sm:mb-[calc(1.25rem+var(--bottom-bar,0px))]');

    // The bar goes, and the toasts go back down.
    rerender(<Toaster />);
    expect(rootVar()).toBe('');
  });

  it('follows the height of the bar when it resizes', () => {
    const observers: Array<() => void> = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      let height = 56;
      render(<Bar height={() => height} />);
      expect(rootVar()).toBe('56px');
      height = 90;
      act(() => observers.forEach((cb) => cb()));
      expect(rootVar()).toBe('90px');
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('takes the bar that mounted last, and the earlier bar again when that one goes', () => {
    const { rerender } = render(
      <>
        <Bar height={52} key="bulk" />
      </>,
    );
    expect(rootVar()).toBe('52px');
    rerender(
      <>
        <Bar height={52} key="bulk" />
        <Bar height={78} key="detail" />
      </>,
    );
    expect(rootVar()).toBe('78px');
    rerender(
      <>
        <Bar height={52} key="bulk" />
      </>,
    );
    expect(rootVar()).toBe('52px');
  });

  it('gives the undo button 44px height and at least 64px width, the close button 44 by 44px, and 16px between them', () => {
    render(<Toaster />);
    act(() => void showUndoToast({ kind: 'triage', message: 'Dismissed “Job 1”.', undo: async () => {} }));
    const toast = screen.getByRole('status');
    const undo = within(toast).getByRole('button', { name: 'Undo' });
    const close = within(toast).getByRole('button', { name: 'Close message' });
    expect(undo).toHaveClass('h-11', 'min-w-16');
    expect(close).toHaveClass('size-11');
    expect(undo.parentElement).toBe(close.parentElement);
    expect(undo.parentElement).toHaveClass('gap-4');
  });
});

describe('undo store', () => {
  it('lets the u key path and a store reader see the same entry, and a new undoable action replaces it', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const { result } = renderHook(() => useLastUndo());
    expect(result.current).toBeNull();

    act(() => void showUndoToast({ kind: 'triage', message: 'Dismissed “Job 1”.', undo: first, returnTo: 'p1' }));
    expect(result.current).toMatchObject({ kind: 'triage', message: 'Dismissed “Job 1”.', toastShown: true, returnTo: 'p1' });
    expect(getLastUndo()).toBe(result.current);

    act(() => void showUndoToast({ kind: 'stage', message: 'Moved to Interview.', undo: second }));
    expect(result.current).toMatchObject({ kind: 'stage', message: 'Moved to Interview.', toastShown: true });
    expect(result.current).not.toHaveProperty('returnTo');
    expect(getLastUndo()).toBe(result.current);

    // The u key runs the entry the reader sees, the second one.
    let done = false;
    await act(async () => {
      done = await undoLast();
    });
    expect(done).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    expect(await undoLast()).toBe(false);
  });

  it('runs an undo at most once, from its toast and from the u key', async () => {
    const undo = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<Toaster />);
    act(() => void showUndoToast({ kind: 'triage', message: 'Saved “Job 1”.', undo }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Saved “Job 1”.')).not.toBeInTheDocument());
    expect(await undoLast()).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest entry after its toast closes, and marks the toast as closed', async () => {
    vi.useFakeTimers();
    const undo = vi.fn(async () => {});
    const { result } = renderHook(() => useLastUndo());
    act(() => void showUndoToast({ kind: 'triage', message: 'Dismissed “Job 1”.', undo }));
    act(() => void vi.advanceTimersByTime(8000));
    expect(result.current).toMatchObject({ message: 'Dismissed “Job 1”.', toastShown: false });
    await act(async () => void (await undoLast()));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
  });

  it('keeps the toast state of the latest entry when an older toast closes', async () => {
    const user = userEvent.setup();
    const { result } = renderHook(() => useLastUndo());
    render(<Toaster />);
    act(() => {
      showUndoToast({ kind: 'triage', message: 'First.', undo: async () => {} });
      showUndoToast({ kind: 'triage', message: 'Second.', undo: async () => {} });
    });
    const first = screen.getByText('First.').closest('[role="status"]') as HTMLElement;
    await user.click(within(first).getByRole('button', { name: 'Close message' }));
    expect(result.current).toMatchObject({ message: 'Second.', toastShown: true });
    const second = screen.getByText('Second.').closest('[role="status"]') as HTMLElement;
    await user.click(within(second).getByRole('button', { name: 'Close message' }));
    expect(result.current).toMatchObject({ message: 'Second.', toastShown: false });
  });

  it('marks the toast as closed when newer messages push it out', () => {
    const { result } = renderHook(() => useLastUndo());
    act(() => void showUndoToast({ kind: 'triage', message: 'Saved “Job 1”.', undo: async () => {} }));
    act(() => {
      for (let i = 0; i < 4; i++) showToast({ message: `Note ${i}`, tone: 'info' });
    });
    expect(result.current).toMatchObject({ message: 'Saved “Job 1”.', toastShown: false });
  });

  it('tells listeners after an undo has reverted its action, and not when it failed', async () => {
    const seen: string[] = [];
    const stop = onUndone((e) => seen.push(`${e.message} ${e.returnTo ?? '-'}`));
    showUndoToast({ kind: 'triage', message: 'Dismissed “Job 1”.', undo: async () => {}, returnTo: 'p1' });
    await undoLast();
    showUndoToast({
      kind: 'triage',
      message: 'Dismissed “Job 2”.',
      undo: async () => {
        throw new Error('Undo failed.');
      },
    });
    // A failed undo still counts as run: the u key does not say "Nothing to undo".
    expect(await undoLast()).toBe(true);
    stop();
    showUndoToast({ kind: 'triage', message: 'Dismissed “Job 3”.', undo: async () => {} });
    await undoLast();
    expect(seen).toEqual(['Dismissed “Job 1”. p1']);
  });
});
