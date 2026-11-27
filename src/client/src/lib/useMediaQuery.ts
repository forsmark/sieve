import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, for example `useMediaQuery('(min-width: 640px)')`.
 * The value follows the query when it changes, as on a resize or a rotation.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
