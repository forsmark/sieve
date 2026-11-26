import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApplicationDto } from '../../../../shared/api';
import { qk } from '../../api/keys';
import { resetToastsForTests } from '../../lib/toast';
import { mockApi } from '../../test-utils';
import { resetNotesDraftsForTests, useStoreApplicationField } from './notes';
import { useMoveApplication } from './stages';

afterEach(() => {
  vi.unstubAllGlobals();
  resetNotesDraftsForTests();
  resetToastsForTests();
});

function app(over: Partial<ApplicationDto> = {}): ApplicationDto {
  return {
    postingId: '1',
    stage: 'applied',
    notes: null,
    interviewAt: null,
    appliedAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    snapshot: { title: 'Job 1', company: 'Company 1', location: null, url: 'https://example.com/1', description: null, facts: null },
    linkStatus: null,
    totalScore: null,
    ...over,
  };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData<ApplicationDto[]>(qk.applications, [app()]);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({ notes: useStoreApplicationField('1', 'notes'), move: useMoveApplication() }), { wrapper });
  const cached = () => qc.getQueryData<ApplicationDto[]>(qk.applications)![0]!;
  return { result, cached };
}

describe('storing a field of an application', () => {
  it('keeps a stage move that came while the notes were stored, when the notes answer last', async () => {
    let answerNotes: (r: ApplicationDto) => void = () => {};
    mockApi({
      'PATCH /api/applications/1': (c) => {
        const body = c.body as Partial<ApplicationDto>;
        // The server stored the notes before the move, so their answer holds the stage from before the move.
        if ('notes' in body) return new Promise<ApplicationDto>((r) => (answerNotes = r));
        return app({ stage: body.stage!, updatedAt: '2026-11-26T09:00:02.000Z' });
      },
    });
    const { result, cached } = setup();

    act(() => result.current.notes.mutate('Call on Friday.'));
    act(() => result.current.move.mutate({ id: '1', stage: 'interview' }));
    await waitFor(() => expect(result.current.move.isSuccess).toBe(true));
    expect(cached().stage).toBe('interview');

    await act(async () => answerNotes(app({ stage: 'applied', notes: 'Call on Friday.', updatedAt: '2026-11-26T09:00:01.000Z' })));
    await waitFor(() => expect(result.current.notes.isSuccess).toBe(true));
    expect(cached()).toMatchObject({ stage: 'interview', notes: 'Call on Friday.', updatedAt: '2026-11-26T09:00:02.000Z' });
  });

  it('writes the stored field and its time into the cached application', async () => {
    mockApi({
      'PATCH /api/applications/1': (c) => app({ ...(c.body as Partial<ApplicationDto>), updatedAt: '2026-11-26T09:00:00.000Z' }),
    });
    const { result, cached } = setup();
    act(() => result.current.notes.mutate('Ask about the team.'));
    await waitFor(() => expect(result.current.notes.isSuccess).toBe(true));
    expect(cached()).toMatchObject({ stage: 'applied', notes: 'Ask about the team.', updatedAt: '2026-11-26T09:00:00.000Z' });
  });
});
