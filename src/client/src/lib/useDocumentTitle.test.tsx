import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useDocumentTitle } from './useDocumentTitle';

function Page({ title, children }: { title: string; children?: React.ReactNode }) {
  useDocumentTitle(title);
  return <>{children}</>;
}

describe('useDocumentTitle', () => {
  it('sets "<title> · sieve", and "sieve" for an empty title', () => {
    const { rerender } = render(<Page title="Jobs" />);
    expect(document.title).toBe('Jobs · sieve');
    rerender(<Page title="" />);
    expect(document.title).toBe('sieve');
    rerender(<Page title="Board" />);
    expect(document.title).toBe('Board · sieve');
  });

  it('shows the title set last, and the one before when that call unmounts', () => {
    const { rerender } = render(<Page title="Jobs" />);
    rerender(
      <Page title="Jobs">
        <Page title="Mobile Developer" />
      </Page>,
    );
    expect(document.title).toBe('Mobile Developer · sieve');
    rerender(<Page title="Jobs" />);
    expect(document.title).toBe('Jobs · sieve');
  });

  it('shows "sieve" when no call is mounted', () => {
    const { unmount } = render(<Page title="Settings" />);
    unmount();
    expect(document.title).toBe('sieve');
  });
});
