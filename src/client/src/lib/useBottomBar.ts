import { useEffect, type RefObject } from 'react';

/**
 * `--bottom-bar` on the root element holds the height of the bar shown at the bottom edge of the screen,
 * such as the detail action bar or the bulk bar. The toaster adds it to its offset, so a message stands above the bar.
 */
export const BOTTOM_BAR_VAR = '--bottom-bar';

/** The mounted bars, in the order they mounted. */
const bars: HTMLElement[] = [];

/** Sets the variable from the bar that mounted last and has a height. A bar hidden by CSS has none. */
function update(): void {
  let height = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    height = bars[i]!.offsetHeight;
    if (height > 0) break;
  }
  const root = document.documentElement.style;
  if (height > 0) root.setProperty(BOTTOM_BAR_VAR, `${height}px`);
  else root.removeProperty(BOTTOM_BAR_VAR);
}

/**
 * Marks the element as the bar at the bottom edge while it is mounted.
 * Call it in the component that renders the bar, so the element mounts and unmounts with the call.
 * `--bottom-bar` follows its height as it resizes, and goes back when it unmounts.
 */
export function useBottomBar(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    bars.push(el);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      bars.splice(bars.indexOf(el), 1);
      update();
    };
  }, [ref]);
}
