/**
 * A `matchMedia` for tests that answers like a device: a touch screen or a mouse, at a given width.
 *
 * Without a call, the default stub of test-setup.ts answers `false` to every query.
 * The setup file calls `resetMedia()` after each test.
 */

export interface MediaDevice {
  /** A touch screen: `(pointer: coarse)` matches and `(hover: hover)` does not. Default false, a mouse. */
  coarse?: boolean;
  /** The viewport width in px for `min-width` and `max-width`. Default 1440. */
  width?: number;
}

interface FakeList {
  readonly media: string;
  readonly matches: boolean;
  onchange: ((e: MediaQueryListEvent) => void) | null;
  addEventListener: (type: 'change', fn: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: 'change', fn: (e: MediaQueryListEvent) => void) => void;
  addListener: (fn: (e: MediaQueryListEvent) => void) => void;
  removeListener: (fn: (e: MediaQueryListEvent) => void) => void;
  dispatchEvent: () => boolean;
}

export interface MediaControl {
  /** Changes the device. Each query whose answer changes tells its listeners, as a rotation or a resize does. */
  set: (device: MediaDevice) => void;
}

/** What `mockMedia` replaced, kept until `resetMedia`. */
let saved: { matchMedia: typeof window.matchMedia; innerWidth: PropertyDescriptor | undefined } | null = null;

function toPx(value: string): number {
  const n = parseFloat(value);
  return /r?em\s*$/.test(value) ? n * 16 : n;
}

/** One condition such as `(min-width: 640px)`. Unknown features do not match. */
function feature(text: string, d: Required<MediaDevice>): boolean {
  const m = /^\(\s*([a-z-]+)\s*(?::\s*([^)]+?))?\s*\)$/.exec(text.trim());
  if (!m) return false;
  const [, name, value = ''] = m;
  switch (name) {
    case 'pointer':
    case 'any-pointer':
      return value === (d.coarse ? 'coarse' : 'fine');
    case 'hover':
    case 'any-hover':
      return value === (d.coarse ? 'none' : 'hover');
    case 'min-width':
      return d.width >= toPx(value);
    case 'max-width':
      return d.width <= toPx(value);
    case 'width':
      return d.width === toPx(value);
    default:
      return false;
  }
}

/** A query: a list split by commas (any matches), each a chain of conditions joined by `and`, with an optional `not` or `only`. */
export function evaluateMedia(query: string, device: MediaDevice = {}): boolean {
  const d = { coarse: false, width: 1440, ...device };
  return query.split(',').some((part) => {
    let q = part.trim();
    const negate = /^not\s/i.test(q);
    q = q.replace(/^(not|only)\s+/i, '').replace(/^(all|screen)\s*(and\s*)?/i, '');
    const all = q === '' || q.split(/\s+and\s+/i).every((c) => feature(c, d));
    return negate ? !all : all;
  });
}

/**
 * Makes `window.matchMedia` answer as the device does, and sets `window.innerWidth` to its width.
 * It stays until the end of the test.
 *
 * @example
 * mockMedia({ coarse: true, width: 430 }); // a phone
 * const media = mockMedia({ width: 1440 });
 * act(() => media.set({ width: 500 })); // the window gets narrow
 */
export function mockMedia(device: MediaDevice = {}): MediaControl {
  const state = { device: { coarse: false, width: 1440, ...device }, listeners: new Map<(e: MediaQueryListEvent) => void, string>() };
  saved ??= { matchMedia: window.matchMedia, innerWidth: Object.getOwnPropertyDescriptor(window, 'innerWidth') };
  const setWidth = () => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: state.device.width });
  setWidth();
  window.matchMedia = (query: string) => {
    const list: FakeList = {
      media: query,
      get matches() {
        return evaluateMedia(query, state.device);
      },
      onchange: null,
      addEventListener: (_type, fn) => void state.listeners.set(fn, query),
      removeEventListener: (_type, fn) => void state.listeners.delete(fn),
      addListener: (fn) => void state.listeners.set(fn, query),
      removeListener: (fn) => void state.listeners.delete(fn),
      dispatchEvent: () => false,
    };
    return list as unknown as MediaQueryList;
  };
  return {
    set(next) {
      const before = { ...state.device };
      state.device = { ...state.device, ...next };
      setWidth();
      for (const [fn, query] of [...state.listeners]) {
        const matches = evaluateMedia(query, state.device);
        if (matches !== evaluateMedia(query, before)) fn({ matches, media: query } as MediaQueryListEvent);
      }
    },
  };
}

/** Puts back the `matchMedia` and the width from before `mockMedia`. The setup file calls it after each test. */
export function resetMedia(): void {
  if (!saved) return;
  window.matchMedia = saved.matchMedia;
  if (saved.innerWidth) Object.defineProperty(window, 'innerWidth', saved.innerWidth);
  else Reflect.deleteProperty(window, 'innerWidth');
  saved = null;
}
