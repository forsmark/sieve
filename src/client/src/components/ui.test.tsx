import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockMedia } from '../test/media';
import { Button, Chip, Select, Switch, TextArea, TextInput } from './ui';

// Vitest hands CSS imports over empty, so the test reads the file.
const styles = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');

/** The media query of the `touch:` variant, as styles.css defines it. */
const TOUCH_QUERY = /@custom-variant touch \(@media (.+)\);/.exec(styles)?.[1] ?? 'missing';

/**
 * The value of a sized utility (`h-9`, `min-w-11`, `text-base`) that wins on this element on the mocked device.
 * A `touch:` class applies when the variant's query matches, and it comes after the plain class in the CSS, so it wins.
 */
function utility(el: HTMLElement, name: string, values = /.+/): string | undefined {
  let value: string | undefined;
  let touchValue: string | undefined;
  for (const cls of el.className.split(/\s+/)) {
    const touch = cls.startsWith('touch:');
    const m = new RegExp(`^${name}-(.+)$`).exec(touch ? cls.slice('touch:'.length) : cls);
    if (!m || !values.test(m[1]!)) continue;
    if (touch) touchValue = m[1];
    else value = m[1];
  }
  return touchValue !== undefined && window.matchMedia(TOUCH_QUERY).matches ? touchValue : value;
}

/** The text size of an element: `sm`, `base` or an arbitrary size, not a text color. */
const TEXT_SIZE = /^(xs|sm|base|lg|\[\d+px\])$/;

/** The height in px of a spacing utility such as `h-9`: 4px for each step. */
function heightPx(el: HTMLElement): number {
  return Number(utility(el, 'h')) * 4;
}

describe('touch sizes', () => {
  it('defines the touch variant as a coarse pointer', () => {
    expect(TOUCH_QUERY).toBe('(pointer: coarse)');
  });

  it('keeps the button heights of 36 and 28px with a mouse', () => {
    mockMedia({ coarse: false, width: 1440 });
    render(
      <>
        <Button>Save</Button>
        <Button size="sm">Clear</Button>
      </>,
    );
    expect(heightPx(screen.getByRole('button', { name: 'Save' }))).toBe(36);
    expect(heightPx(screen.getByRole('button', { name: 'Clear' }))).toBe(28);
    expect(utility(screen.getByRole('button', { name: 'Save' }), 'min-w')).toBeUndefined();
  });

  it('raises both button sizes to 44 by 44px on a touch screen', () => {
    mockMedia({ coarse: true, width: 430 });
    render(
      <>
        <Button>Save</Button>
        <Button size="sm">Clear</Button>
      </>,
    );
    for (const name of ['Save', 'Clear']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('touch:h-11', 'touch:min-w-11');
      expect(heightPx(button)).toBe(44);
      expect(utility(button, 'min-w')).toBe('11');
    }
  });

  it('keeps 44px on a touch screen when the caller sets another height', () => {
    mockMedia({ coarse: true });
    render(<Button className="h-6 text-xs">Fetch now</Button>);
    expect(heightPx(screen.getByRole('button', { name: 'Fetch now' }))).toBe(44);
  });

  it('raises text inputs and selects to 44px and gives form controls 16px text on a touch screen', () => {
    mockMedia({ coarse: true });
    render(
      <>
        <TextInput aria-label="Search" />
        <Select aria-label="Source">
          <option>All</option>
        </Select>
        <TextArea aria-label="Notes" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Search' });
    const select = screen.getByRole('combobox', { name: 'Source' });
    const area = screen.getByRole('textbox', { name: 'Notes' });
    expect(heightPx(input)).toBe(44);
    expect(heightPx(select)).toBe(44);
    for (const el of [input, select, area]) expect(utility(el, 'text', TEXT_SIZE)).toBe('base');
  });

  it('keeps inputs at 36px in 14px text with a mouse', () => {
    mockMedia({ coarse: false });
    render(<TextInput aria-label="Search" />);
    const input = screen.getByRole('textbox', { name: 'Search' });
    expect(heightPx(input)).toBe(36);
    expect(utility(input, 'text', TEXT_SIZE)).toBe('sm');
  });

  it('gives form controls 16px text on a touch screen in the global rule, also without the shared components', () => {
    const touchBlock = styles.slice(styles.indexOf('@media (pointer: coarse) {'));
    expect(touchBlock).toMatch(/input:not\(\[type='checkbox'\], \[type='radio'\], \[type='range'\]\),\s*select,\s*textarea \{\s*font-size: 16px;/);
    expect(touchBlock).toMatch(/summary \{\s*min-height: 44px;/);
  });

  it('raises the status filter chip from 28 to 44px on a touch screen', () => {
    const media = mockMedia({ coarse: false });
    render(
      <Chip checked={false} onChange={() => {}}>
        Saved
      </Chip>,
    );
    const chip = screen.getByText('Saved').closest('label')!;
    expect(heightPx(chip)).toBe(28);
    media.set({ coarse: true });
    expect(heightPx(chip)).toBe(44);
  });

  it('gives the switch a 44 by 44px hit area on a touch screen and keeps its 36 by 20px track', () => {
    render(<Switch checked={false} onChange={() => {}} label="Fetch on a schedule" />);
    const sw = screen.getByRole('switch', { name: /Fetch on a schedule/ });
    // An absolute box starts from the padding box, 34 by 18px inside the 1px border of the 36 by 20px track.
    // So the area reaches 13px above and below it and 5px beside it: 18 + 2 * 13 = 44 and 34 + 2 * 5 = 44.
    expect(sw).toHaveClass('h-5', 'w-9', 'touch:after:absolute', 'touch:after:-inset-y-[13px]', 'touch:after:-inset-x-[5px]');
  });
});

describe('control styles', () => {
  it('draws the strong hairline in #76777d', () => {
    expect(styles).toContain('--border-strong: #76777d;');
  });

  it('draws the mixed state of a checkbox as a dash in the text color', () => {
    expect(styles).toMatch(
      /input\[type='checkbox'\]:indeterminate \{[^}]*background-image: linear-gradient\(var\(--text\), var\(--text\)\);[^}]*background-size: 8px 2px;/,
    );
  });

  it('draws the slider as a square 20px thumb on a 1px strong hairline track, in a 44px row on a touch screen', () => {
    expect(styles).toMatch(/input\[type='range'\]::-webkit-slider-runnable-track \{\s*height: 1px;\s*background: var\(--border-strong\);/);
    expect(styles).toMatch(
      /input\[type='range'\]::-webkit-slider-thumb \{[^}]*width: 20px;\s*height: 20px;[^}]*border-radius: 0;\s*background: var\(--accent\);/,
    );
    expect(styles).toMatch(/@media \(pointer: coarse\) \{\s*input\[type='range'\] \{\s*height: 44px;/);
  });
});
