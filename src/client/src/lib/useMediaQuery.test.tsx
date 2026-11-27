import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { mockMedia } from '../test/media';
import { useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('answers false for every query without a mocked device, as the default stub does', () => {
    expect(renderHook(() => useMediaQuery('(pointer: coarse)')).result.current).toBe(false);
    expect(renderHook(() => useMediaQuery('(min-width: 640px)')).result.current).toBe(false);
  });

  it('answers as the mocked device does', () => {
    mockMedia({ coarse: true, width: 430 });
    expect(renderHook(() => useMediaQuery('(pointer: coarse)')).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery('(min-width: 640px)')).result.current).toBe(false);
    expect(renderHook(() => useMediaQuery('(max-width: 639.98px)')).result.current).toBe(true);
  });

  it('follows a change of the query, as on a resize', () => {
    const media = mockMedia({ width: 1440 });
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
    act(() => media.set({ width: 800 }));
    expect(result.current).toBe(false);
    act(() => media.set({ width: 1100 }));
    expect(result.current).toBe(true);
  });

  it('follows a new query', () => {
    mockMedia({ width: 800 });
    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), { initialProps: { q: '(min-width: 640px)' } });
    expect(result.current).toBe(true);
    rerender({ q: '(min-width: 1024px)' });
    expect(result.current).toBe(false);
  });
});
