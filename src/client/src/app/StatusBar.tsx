import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { StatusDto } from '../../../shared/api';
import { api } from '../api/endpoints';
import { qk } from '../api/keys';
import { errorText } from '../api/client';
import { connectionStore } from '../api/events';
import { Button, Spinner, cx } from '../components/ui';
import { relativeTime, sourceName } from '../lib/format';
import { useStore } from '../lib/store';
import { showToast, toastError } from '../lib/toast';

function Item({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('flex items-center gap-1.5 whitespace-nowrap', className)}>{children}</span>;
}

function Dot({ tone }: { tone: 'ok' | 'bad' | 'idle' | 'busy' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-2',
        tone === 'ok' && 'bg-fg',
        tone === 'bad' && 'bg-danger',
        tone === 'idle' && 'bg-faint',
        tone === 'busy' && 'border border-fg',
      )}
    />
  );
}

export function StatusBar({ status }: { status: UseQueryResult<StatusDto> }) {
  const qc = useQueryClient();
  const connection = useStore(connectionStore);
  const s = status.data;
  const runs = useQuery({ queryKey: qk.runs, queryFn: api.runs, enabled: s?.activeRunId != null });
  const activeRun = s?.activeRunId != null ? runs.data?.find((r) => r.id === s.activeRunId) : undefined;

  const fetchNow = useMutation({
    mutationFn: api.fetchNow,
    onSuccess: (r) => {
      showToast({ message: r.started ? 'Fetch run started.' : 'A fetch run is already active.', tone: 'info' });
      void qc.invalidateQueries({ queryKey: qk.status });
      void qc.invalidateQueries({ queryKey: qk.runs });
    },
    onError: (e) => toastError(errorText(e)),
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) => (paused ? api.pauseMatching() : api.resumeMatching()),
    onSuccess: (r) => qc.setQueryData<StatusDto>(qk.status, (old) => (old ? { ...old, matchingPaused: r.paused } : old)),
    onError: (e) => toastError(errorText(e)),
  });

  return (
    <footer
      aria-label="System status"
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-3 py-1 text-xs text-muted sm:px-6"
    >
      {status.isError && <span className="text-danger">Status unavailable: {errorText(status.error)}</span>}
      {s && (
        <>
          <Item>
            {s.activeRunId != null ? (
              <>
                <Spinner small />
                <span className="text-fg">Fetching</span>
                {activeRun && (
                  <span className="hidden sm:inline">
                    {activeRun.sources
                      .map((src) => `${sourceName(src.source)} ${src.state === 'running' ? 'running' : `${src.found} found`}`)
                      .join(', ')}
                  </span>
                )}
              </>
            ) : (
              <>
                <span>Last fetch {relativeTime(s.lastRunAt)}</span>
                {s.schedule.paused ? (
                  <span>· schedule paused</span>
                ) : (
                  s.schedule.nextRunAt && <span className="hidden md:inline">· next {relativeTime(s.schedule.nextRunAt)}</span>
                )}
              </>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => fetchNow.mutate()} busy={fetchNow.isPending} disabled={s.activeRunId != null}>
              Fetch now
            </Button>
          </Item>

          <Item>
            <span title={Object.entries(s.queue).map(([k, v]) => `${k}: ${v}`).join(', ') || 'Queue is empty'}>
              Queue <span className="tabular text-fg">{s.queueTotal}</span>
            </span>
          </Item>

          <Item>
            <Dot tone={s.llmAvailable === null ? 'idle' : s.llmAvailable ? 'ok' : 'bad'} />
            <Link to="/settings" hash="model" className="hover:text-fg hover:underline">
              {s.llmAvailable === null ? 'Model status unknown' : s.llmAvailable ? 'Model available' : 'Model unavailable'}
              <span className="hidden sm:inline"> ({s.llmProvider === 'claude-code' ? 'Claude Code' : 'local'})</span>
            </Link>
          </Item>

          <Item>
            {s.matchingPaused ? <span className="border border-fg px-1.5 font-semibold text-fg">Matching paused</span> : <span>Matching on</span>}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              busy={pause.isPending}
              onClick={() => pause.mutate(!s.matchingPaused)}
            >
              {s.matchingPaused ? 'Resume' : 'Pause'}
            </Button>
          </Item>

          <Item className="ml-auto">
            <Dot tone={connection === 'open' ? 'ok' : connection === 'connecting' ? 'busy' : 'bad'} />
            <span>{connection === 'open' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}</span>
          </Item>
        </>
      )}
    </footer>
  );
}
