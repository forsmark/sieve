import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { BOTTOM_BAR_VAR, useBottomBar } from './useBottomBar';

/** A bar of `height` px whose top edge stands at `top` px from the top of the screen. */
function Bar({ height, top }: { height: number; top: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useBottomBar(ref);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) {
          Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
          el.getBoundingClientRect = () => ({ top, height }) as DOMRect;
        }
      }}
    />
  );
}

/** The status bar, whose top edge stands at `top` px, or at the px a function gives. */
function statusBar(top: number | (() => number)): HTMLElement {
  const footer = document.createElement('footer');
  footer.setAttribute('aria-label', 'System status');
  footer.getBoundingClientRect = () => ({ top: typeof top === 'function' ? top() : top }) as DOMRect;
  document.body.append(footer);
  return footer;
}

const value = () => document.documentElement.style.getPropertyValue(BOTTOM_BAR_VAR);

describe('useBottomBar', () => {
  afterEach(() => {
    document.querySelectorAll('footer').forEach((f) => f.remove());
    vi.restoreAllMocks();
  });

  it('raises the toasts by the whole height of a bar that stands above the status bar', () => {
    // A 932px screen with a 78px status bar, and a 60px bulk bar right above it.
    statusBar(854);
    const { unmount } = render(<Bar height={60} top={794} />);
    expect(value()).toBe('60px');
    unmount();
    expect(value()).toBe('');
  });

  it('raises the toasts only by the part of a bar that rises above a status bar it covers', () => {
    // The full-screen detail covers the 78px status bar with its 86px action bar.
    statusBar(854);
    render(<Bar height={86} top={846} />);
    expect(value()).toBe('8px');
  });

  it('uses the bar height when there is no layout to measure', () => {
    render(<Bar height={52} top={0} />);
    expect(value()).toBe('52px');
  });

  it('measures again when the status bar resizes and its top edge moves', () => {
    const observers: Array<{ cb: () => void; targets: Element[] }> = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      private readonly entry: { cb: () => void; targets: Element[] };
      constructor(cb: () => void) {
        this.entry = { cb, targets: [] };
        observers.push(this.entry);
      }
      observe(el: Element) {
        this.entry.targets.push(el);
      }
      unobserve() {}
      disconnect() {
        this.entry.targets = [];
      }
    } as unknown as typeof ResizeObserver;
    try {
      let top = 854;
      const footer = statusBar(() => top);
      render(<Bar height={86} top={846} />);
      expect(value()).toBe('8px');

      // The status bar loses a line, so its top edge moves down while the bar keeps its size.
      top = 870;
      act(() => observers.filter((o) => o.targets.includes(footer)).forEach((o) => o.cb()));
      expect(value()).toBe('24px');
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});
