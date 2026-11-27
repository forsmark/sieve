import { describe, expect, it } from 'vitest';
import { evaluateMedia, mockMedia, resetMedia } from './media';

describe('mockMedia', () => {
  it('answers pointer, hover and width queries as the device does', () => {
    const phone = { coarse: true, width: 430 };
    expect(evaluateMedia('(pointer: coarse)', phone)).toBe(true);
    expect(evaluateMedia('(pointer: fine)', phone)).toBe(false);
    expect(evaluateMedia('(hover: none)', phone)).toBe(true);
    expect(evaluateMedia('(min-width: 640px)', phone)).toBe(false);
    expect(evaluateMedia('(max-width: 639px)', phone)).toBe(true);
    expect(evaluateMedia('(min-width: 40rem)', { width: 640 })).toBe(true);
    expect(evaluateMedia('(pointer: coarse) and (max-width: 639px)', phone)).toBe(true);
    expect(evaluateMedia('(pointer: fine), (max-width: 639px)', phone)).toBe(true);
    expect(evaluateMedia('not all and (pointer: coarse)', phone)).toBe(false);
    expect(evaluateMedia('screen and (min-width: 1024px)', { width: 1440 })).toBe(true);
    // A mouse at 1440px is the default device.
    expect(evaluateMedia('(pointer: fine) and (min-width: 1024px)')).toBe(true);
    expect(evaluateMedia('(prefers-reduced-motion: reduce)', phone)).toBe(false);
  });

  it('sets matchMedia and innerWidth, and puts them back', () => {
    const before = window.matchMedia;
    const width = window.innerWidth;
    mockMedia({ coarse: true, width: 375 });
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
    expect(window.innerWidth).toBe(375);
    resetMedia();
    expect(window.matchMedia).toBe(before);
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(false);
    expect(window.innerWidth).toBe(width);
  });

  it('tells the listeners of a query whose answer changes', () => {
    const media = mockMedia({ width: 1440 });
    const seen: boolean[] = [];
    window.matchMedia('(min-width: 1024px)').addEventListener('change', (e) => seen.push(e.matches));
    media.set({ width: 1200 });
    media.set({ width: 800 });
    media.set({ coarse: true });
    expect(seen).toEqual([false]);
  });
});
