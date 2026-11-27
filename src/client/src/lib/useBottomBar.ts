import { useEffect, type RefObject } from 'react';

/**
 * `--bottom-bar` on the root element holds the height of the bar shown at the bottom edge of the screen,
 * such as the detail action bar or the bulk bar. The toaster adds it to its offset, so a message stands above the bar.
 */
export const BOTTOM_BAR_VAR = '--bottom-bar';

/** The status bar at the bottom of the shell, whose top edge the offset depends on. */
function statusBar(): Element | null {
  return document.querySelector('footer[aria-label="System status"]');
}

/** The mounted bars, in the order they mounted. */
const bars: HTMLElement[] = [];

/**
 * How far the toasts must rise for the bar. The toasts stand above the status bar, so the offset is how far
 * the bar's top edge stands above the status bar's top edge. A bar above the status bar, such as the bulk bar,
 * gives its whole height. A bar in a full-screen panel that covers the status bar, such as the detail action bar,
 * gives its height less the status bar's. Without a layout, as in tests, it is the bar's height.
 */
function offsetOf(bar: HTMLElement): number {
  const height = bar.offsetHeight;
  if (height === 0) return 0;
  const barTop = bar.getBoundingClientRect().top;
  const status = statusBar();
  const statusTop = status?.getBoundingClientRect().top ?? 0;
  if (barTop === 0 || statusTop === 0) return height;
  return Math.max(0, Math.round(statusTop - barTop));
}

/** Sets the variable from the bar that mounted last and has a height. A bar hidden by CSS has none. */
function update(): void {
  let height = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i]!.offsetHeight === 0) continue;
    height = offsetOf(bars[i]!);
    break;
  }
  const root = document.documentElement.style;
  if (height > 0) root.setProperty(BOTTOM_BAR_VAR, `${height}px`);
  else root.removeProperty(BOTTOM_BAR_VAR);
}

/**
 * Marks the element as the bar at the bottom edge while it is mounted.
 * Call it in the component that renders the bar, so the element mounts and unmounts with the call.
 * `--bottom-bar` follows its height and the status bar's as they resize, and goes back when it unmounts.
 */
export function useBottomBar(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    bars.push(el);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    // The offset depends on the status bar's top edge too, which moves when the status bar resizes.
    const status = statusBar();
    if (status) observer.observe(status);
    return () => {
      observer.disconnect();
      bars.splice(bars.indexOf(el), 1);
      update();
    };
  }, [ref]);
}
