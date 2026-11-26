import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StatusDto } from '../../../shared/api';
import { api } from '../api/endpoints';
import { qk } from '../api/keys';
import { errorText } from '../api/client';
import { showToast, toastError } from '../lib/toast';

/**
 * The actions of the system that more than one place offers: the status bar from 640px, the Activity header
 * at every width, and the log-out of the top bar and of Settings.
 */

/** Starts a fetch run now. The server answers whether one started or one was already active. */
export function useFetchNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.fetchNow,
    onSuccess: (r) => {
      showToast({ message: r.started ? 'Fetch run started.' : 'A fetch run is already active.', tone: 'info' });
      void qc.invalidateQueries({ queryKey: qk.status });
      void qc.invalidateQueries({ queryKey: qk.runs });
      void qc.invalidateQueries({ queryKey: qk.activity });
    },
    onError: (e) => toastError(errorText(e)),
  });
}

/** Pauses matching with `true` and resumes it with `false`. */
export function useMatchingPause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paused: boolean) => (paused ? api.pauseMatching() : api.resumeMatching()),
    onSuccess: (r) => qc.setQueryData<StatusDto>(qk.status, (old) => (old ? { ...old, matchingPaused: r.paused } : old)),
    onError: (e) => toastError(errorText(e)),
  });
}

/** Ends the session. The cache empties and the login screen shows. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      // The auth entry changes in place, so the root layout sees it and shows the login screen. A `clear()` first
      // would detach the layout's observer from the entry, and the shell would stay until something else rendered.
      qc.setQueryData(qk.auth, { authRequired: true, authenticated: false });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.auth[0] });
    },
    onError: (e) => toastError(errorText(e)),
  });
}
