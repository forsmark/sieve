import { useMutation, useQueryClient, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { PostingDetail, PostingListResponse, PostingQuery, TriageAction, TriageResult } from '../../../../shared/api';
import type { TriageStatus } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { showUndoToast, toastError } from '../../lib/toast';
import { plural } from '../../lib/format';

export const STATUS_OF: Record<TriageAction, TriageStatus> = { save: 'saved', dismiss: 'dismissed', restore: 'new', apply: 'applied' };

const PAST: Record<TriageAction, string> = { save: 'Saved', dismiss: 'Dismissed', restore: 'Restored', apply: 'Marked as applied' };

type ListData = InfiniteData<PostingListResponse, number>;
type Snapshot = Array<[QueryKey, unknown]>;

function statusesOfQuery(q: PostingQuery | undefined): TriageStatus[] | 'all' {
  const s = q?.status ?? 'new,saved';
  if (s.split(',').includes('all')) return 'all';
  return s.split(',').map((x) => x.trim()) as TriageStatus[];
}

/** Moves postings to a new status in every cached list. Rows that the list no longer shows are removed. */
export function applyOptimisticTriage(qc: QueryClient, ids: string[], status: TriageStatus): Snapshot {
  const idSet = new Set(ids);
  const snapshot: Snapshot = [
    ...qc.getQueriesData({ queryKey: qk.postingsAll }),
    ...ids.map((id): [QueryKey, unknown] => [qk.posting(id), qc.getQueryData(qk.posting(id))]),
  ];
  for (const query of qc.getQueryCache().findAll({ queryKey: qk.postingsAll })) {
    const key = query.queryKey;
    const statuses = statusesOfQuery(key[1] as PostingQuery | undefined);
    const keep = statuses === 'all' || statuses.includes(status);
    qc.setQueryData<ListData>(key, (data) => {
      if (!data) return data;
      let removed = 0;
      const pages = data.pages.map((page) => {
        if (!page.items.some((i) => idSet.has(i.id))) return page;
        const before = page.items.length;
        const items = keep
          ? page.items.map((i) => (idSet.has(i.id) ? { ...i, triageStatus: status, triageOrigin: 'user' as const } : i))
          : page.items.filter((i) => !idSet.has(i.id));
        removed += before - items.length;
        return { ...page, items };
      });
      return { ...data, pages: removed ? pages.map((p) => ({ ...p, total: Math.max(0, p.total - removed) })) : pages };
    });
  }
  for (const id of ids) {
    qc.setQueryData<PostingDetail>(qk.posting(id), (d) => (d ? { ...d, triageStatus: status } : d));
  }
  return snapshot;
}

export function restoreSnapshot(qc: QueryClient, snapshot: Snapshot): void {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

export interface TriageVars {
  ids: string[];
  action: TriageAction;
  /** A short name for the toast, for example the posting title. */
  label?: string;
}

/**
 * Triage with an optimistic update, rollback on error, and an undo toast.
 * Undo posts the returned `previous` list to `/api/postings/restore`.
 */
export function useTriage() {
  const qc = useQueryClient();
  return useMutation<TriageResult, unknown, TriageVars, { snapshot: Snapshot }>({
    mutationFn: ({ ids, action }) => api.triage(ids, action),
    onMutate: async ({ ids, action }) => {
      await qc.cancelQueries({ queryKey: qk.postingsAll });
      return { snapshot: applyOptimisticTriage(qc, ids, STATUS_OF[action]) };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) restoreSnapshot(qc, ctx.snapshot);
      toastError(`The change was not saved. ${errorText(err)}`);
    },
    onSuccess: (result, { ids, action, label }) => {
      const what = ids.length === 1 && label ? `“${label}”` : plural(ids.length, 'posting');
      showUndoToast(`${PAST[action]} ${what}.`, async () => {
        try {
          await api.restore(result.previous);
          showUndoDone(qc);
        } catch (err) {
          toastError(`Undo failed. ${errorText(err)}`);
        }
      });
    },
    onSettled: (_r, _e, { action, ids }) => {
      void qc.invalidateQueries({ queryKey: qk.status });
      for (const id of ids) void qc.invalidateQueries({ queryKey: qk.posting(id) });
      if (action === 'apply' || action === 'restore') void qc.invalidateQueries({ queryKey: qk.applications });
    },
  });
}

function showUndoDone(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: qk.postingsAll });
  void qc.invalidateQueries({ queryKey: qk.postingAll });
  void qc.invalidateQueries({ queryKey: qk.status });
  void qc.invalidateQueries({ queryKey: qk.applications });
}
