import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApplicationDto } from '../../../../shared/api';
import type { ApplicationStage } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { toastError } from '../../lib/toast';

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** Changes the stage with an optimistic move. On error the card returns to its column. */
export function useMoveApplication() {
  const qc = useQueryClient();
  return useMutation<ApplicationDto, unknown, { id: string; stage: ApplicationStage }, { before: ApplicationDto[] | undefined }>({
    mutationFn: ({ id, stage }) => api.updateApplication(id, { stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: qk.applications });
      const before = qc.getQueryData<ApplicationDto[]>(qk.applications);
      qc.setQueryData<ApplicationDto[]>(qk.applications, (list) => list?.map((a) => (a.postingId === id ? { ...a, stage } : a)));
      return { before };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(qk.applications, ctx.before);
      toastError(`The card could not be moved. ${errorText(err)}`);
    },
    onSuccess: (updated) => {
      qc.setQueryData<ApplicationDto[]>(qk.applications, (list) => list?.map((a) => (a.postingId === updated.postingId ? updated : a)));
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.applicationEvents(id) });
    },
  });
}

