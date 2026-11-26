import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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

/** The status bar, whose top edge stands at `top` px. */
function statusBar(top: number): HTMLElement {
  const footer = document.createElement('footer');
  footer.setAttribute('aria-label', 'System status');
  footer.getBoundingClientRect = () => ({ top }) as DOMRect;
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
});
