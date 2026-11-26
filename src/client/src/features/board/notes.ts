import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ApplicationDto } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { errorText } from '../../api/client';
import { qk } from '../../api/keys';
import { toastError } from '../../lib/toast';

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
 * finishes, writes the stored field into the cache, and reports a failure. Only that field and the time of the
 * change go into the cache: the answer holds the stage from when the server stored the field, and a stage move
 * may have come since. The stores of one application run one after the other, so the last value the user gave
 * is the one the server keeps.
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
      writeStoredField(qc, updated, field);
      // A newer text that is still on its way keeps its draft.
      if (field === 'notes' && drafts.get(postingId) === (value ?? '')) drafts.delete(postingId);
    },
    onError: (err) => {
      toastError(`${FAILED[field]} ${errorText(err)}`);
    },
  });
}

/** Puts one stored field of the application the server returned into the board's list, with the later of the two change times. */
function writeStoredField(qc: QueryClient, updated: ApplicationDto, field: StoredField): void {
  qc.setQueryData<ApplicationDto[]>(qk.applications, (list) =>
    list?.map((a) =>
      a.postingId === updated.postingId ? { ...a, [field]: updated[field], updatedAt: updated.updatedAt > a.updatedAt ? updated.updatedAt : a.updatedAt } : a,
    ),
  );
}
