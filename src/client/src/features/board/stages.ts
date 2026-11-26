import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ApplicationDto } from '../../../../shared/api';
import type { ApplicationStage } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { showToast, showUndoToast, toastError } from '../../lib/toast';

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/**
 * Changes the stage with an optimistic move. On error the card returns to its column.
 * After a move the toast names the new stage and offers Undo, from the stage menu, by drag and by keyboard alike.
 * The undo sends the earlier stage with the same request, so the stage history records it like any move.
 */
export function useMoveApplication() {
  const qc = useQueryClient();
  return useMutation<
    ApplicationDto,
    unknown,
    { id: string; stage: ApplicationStage },
    { before: ApplicationDto[] | undefined; from: ApplicationStage | undefined }
  >({
    mutationFn: ({ id, stage }) => api.updateApplication(id, { stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: qk.applications });
      const before = qc.getQueryData<ApplicationDto[]>(qk.applications);
      const from = before?.find((a) => a.postingId === id)?.stage;
      qc.setQueryData<ApplicationDto[]>(qk.applications, (list) => list?.map((a) => (a.postingId === id ? { ...a, stage } : a)));
      return { before, from };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(qk.applications, ctx.before);
      toastError(`The card could not be moved. ${errorText(err)}`);
    },
    onSuccess: (updated, { id, stage }, ctx) => {
      writeApplication(qc, updated);
      const from = ctx?.from;
      if (!from || from === stage) return;
      showUndoToast({
        kind: 'stage',
        message: `Moved to ${STAGE_LABEL[stage]}.`,
        undo: async () => {
          try {
            writeApplication(qc, await api.updateApplication(id, { stage: from }));
          } catch (err) {
            toastError(`Undo failed. ${errorText(err)}`);
            throw err;
          } finally {
            void qc.invalidateQueries({ queryKey: qk.applicationEvents(id) });
            void qc.invalidateQueries({ queryKey: qk.status });
          }
        },
      });
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.applicationEvents(id) });
      void qc.invalidateQueries({ queryKey: qk.status });
    },
  });
}

/** Puts the application the server returned into the board's list. */
export function writeApplication(qc: QueryClient, updated: ApplicationDto): void {
  qc.setQueryData<ApplicationDto[]>(qk.applications, (list) => list?.map((a) => (a.postingId === updated.postingId ? updated : a)));
}

/**
 * Removes the application of a posting. The posting returns to "saved". The board and the job list share it,
 * so both show the same message and refresh the same data. A removal has no undo.
 */
/** `onRemoved` runs with the mutation's own success, so it runs also when the component that asked has unmounted. */
export function useRemoveApplication({ onRemoved }: { onRemoved?: () => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postingId: string) => api.removeApplication(postingId),
    onSuccess: (_r, postingId) => {
      qc.setQueryData<ApplicationDto[]>(qk.applications, (list) => list?.filter((a) => a.postingId !== postingId));
      void qc.invalidateQueries({ queryKey: qk.postingsAll });
      void qc.invalidateQueries({ queryKey: qk.posting(postingId) });
      void qc.invalidateQueries({ queryKey: qk.status });
      showToast({ message: 'Application removed. The posting is saved in the job list.', tone: 'info' });
      onRemoved?.();
    },
    onError: (e) => toastError(errorText(e)),
  });
}
