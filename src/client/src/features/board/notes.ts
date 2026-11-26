import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApplicationDto } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { errorText } from '../../api/client';
import { toastError } from '../../lib/toast';
import { writeApplication } from './stages';

/**
 * The typed notes of each application whose store has not succeeded yet, by posting id.
 * The map lives as long as the page, so the panel finds the notes again when it opens the application anew.
 */
const drafts = new Map<string, string>();

/** The typed notes of an application that are not stored yet, or undefined. */
export function notesDraft(postingId: string): string | undefined {
  return drafts.get(postingId);
}

export function clearNotesDraft(postingId: string): void {
  drafts.delete(postingId);
}

export function resetNotesDraftsForTests(): void {
  drafts.clear();
}

export type StoredField = 'notes' | 'interviewAt';

const FAILED: Record<StoredField, string> = {
  notes: 'The notes were not saved.',
  interviewAt: 'The interview date was not saved.',
};

/**
 * Stores one field of an application without a save step. The variable is the new value, null to clear it.
 *
 * The callbacks sit on the hook, not on `mutate`, so a store that starts as the panel unmounts still
 * finishes, writes the application into the cache, and reports a failure. The stores of one application
 * run one after the other, so the last value the user gave is the one the server keeps.
 *
 * For the notes, the typed text stays in the draft map from the start of the store until a store succeeds.
 */
export function useStoreApplicationField(postingId: string, field: StoredField) {
  const qc = useQueryClient();
  return useMutation<ApplicationDto, unknown, string | null>({
    mutationFn: (value) => api.updateApplication(postingId, field === 'notes' ? { notes: value } : { interviewAt: value }),
    scope: { id: `application:${postingId}` },
    onMutate: (value) => {
      if (field === 'notes') drafts.set(postingId, value ?? '');
    },
    onSuccess: (updated, value) => {
      writeApplication(qc, updated);
      // A newer text that is still on its way keeps its draft.
      if (field === 'notes' && drafts.get(postingId) === (value ?? '')) drafts.delete(postingId);
    },
    onError: (err) => {
      toastError(`${FAILED[field]} ${errorText(err)}`);
    },
  });
}
