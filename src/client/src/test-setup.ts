import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetMedia } from './test/media';

afterEach(() => {
  cleanup();
});

// jsdom has no layout. The virtual list reads the size of its scroll element.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // Set directly, not with vi.stubGlobal, so a test's vi.unstubAllGlobals() keeps it.
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom has no matchMedia. This default answers false to every query. It is set directly, not with
// vi.stubGlobal, so a test's vi.unstubAllGlobals() keeps it. Use mockMedia from test/media.ts to answer as a device.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
afterEach(() => resetMedia());

if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
