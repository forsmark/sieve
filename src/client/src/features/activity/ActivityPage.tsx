import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { RunDto } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { Badge, Button, ErrorState, LoadingState, PageHeader, Section, Select, Spinner } from '../../components/ui';
import { capitalize, dateTime, relativeTime, sourceName } from '../../lib/format';
import { showToast, toastError } from '../../lib/toast';

const KIND_LABEL: Record<string, string> = {
  extract: 'Extract facts',
  judge: 'Judge',
  score: 'Score',
  constraints: 'Check constraints',
  enrich: 'Fetch description',
  liveness: 'Check link',
  notify: 'Notification',
  derive_profile: 'Read CV',
};

export function ActivityPage() {
  const activity = useQuery({ queryKey: qk.activity, queryFn: api.activity });
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-5xl flex-col gap-4 p-3 sm:p-6">
        <PageHeader title="Activity" />
        {activity.isPending && <LoadingState label="Loading activity" />}
        {activity.isError && <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />}
        {activity.data && (
          <>
            <RunsSection runs={activity.data.runs} />
            <FailedSection tasks={activity.data.failedTasks} />
            <Section title="Notifications" description="The latest messages sent through ntfy.">
              {activity.data.notifications.length === 0 ? (
                <p className="text-[13px] text-muted">No notifications sent yet.</p>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {activity.data.notifications.map((n) => (
                    <li key={n.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <Badge tone={n.state === 'sent' ? 'ok' : 'danger'}>{n.state === 'sent' ? 'Sent' : 'Failed'}</Badge>
                      <span>{n.count === 1 ? '1 posting' : `${n.count} postings`}</span>
                      <span className="text-muted">{dateTime(n.createdAt)}</span>
                      {n.error && <span className="w-full text-danger">{n.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
        <LogsSection />
      </div>
    </div>
  );
}

function RunsSection({ runs }: { runs: RunDto[] }) {
  return (
    <Section title="Fetch runs" description="The latest 20 runs and the result of each source.">
      {runs.length === 0 ? (
        <p className="text-[13px] text-muted">No fetch runs yet. Use Fetch now in the status bar.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {runs.map((r) => (
            <li key={r.id} className="border border-line p-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                {r.state === 'running' && <Spinner small />}
                <Badge tone={r.state === 'completed' ? 'ok' : r.state === 'running' ? 'accent' : 'warn'}>{capitalize(r.state)}</Badge>
                <span className="font-medium">{dateTime(r.startedAt)}</span>
                <span className="text-muted">
                  {r.trigger === 'manual' ? 'Started by you' : `Trigger: ${r.trigger}`}
                  {r.endedAt && ` · took ${Math.max(1, Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000))} s`}
                </span>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-[13px]">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">Source</th>
                      <th scope="col" className="py-1 pr-3 font-medium">State</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">Found</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">New</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">Invalid</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {r.sources.map((s) => (
                      <tr key={s.source} className="border-t border-line align-top">
                        <td className="py-1 pr-3">{sourceName(s.source)}</td>
                        <td className="py-1 pr-3">
                          <span className={s.state === 'failed' ? 'text-danger' : ''}>{capitalize(s.state)}</span>
                          {s.error && <p className={`max-w-md text-xs break-words ${s.state === 'failed' ? 'text-danger' : 'text-muted'}`}>{s.error}</p>}
                        </td>
                        <td className="py-1 pr-3 text-right">{s.found}</td>
                        <td className="py-1 pr-3 text-right">{s.added}</td>
                        <td className="py-1 pr-3 text-right">{s.invalid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FailedSection({ tasks }: { tasks: Array<{ id: number; kind: string; subjectId: string; subjectTitle: string | null; attempts: number; lastError: string | null; finishedAt: string | null }> }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: api.retryTask,
    onSuccess: () => {
      showToast({ message: 'The work is queued again.', tone: 'info' });
      void qc.invalidateQueries({ queryKey: qk.activity });
      void qc.invalidateQueries({ queryKey: qk.status });
    },
    onError: (e) => toastError(errorText(e)),
  });
  return (
    <Section title="Failed work" description="Background work that failed after all retries.">
      {tasks.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing failed.</p>
      ) : (
        <ul className="divide-y divide-line text-[13px]">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">{KIND_LABEL[t.kind] ?? t.kind}</span>
                  {' · '}
                  {t.subjectTitle ? (
                    <Link to="/jobs" search={{ id: t.subjectId, status: 'all' }} className="font-medium underline decoration-accent decoration-2 hover:decoration-fg">
                      {t.subjectTitle}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{t.subjectId}</span>
                  )}
                </p>
                {t.lastError && <p className="mt-0.5 break-words text-danger">{t.lastError}</p>}
                <p className="mt-0.5 text-xs text-muted">
                  {t.attempts} attempts{t.finishedAt ? ` · failed ${relativeTime(t.finishedAt)}` : ''}
                </p>
              </div>
              <Button size="sm" onClick={() => retry.mutate(t.id)} busy={retry.isPending && retry.variables === t.id}>
                Retry
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function LogsSection() {
  const [level, setLevel] = useState('all');
  const logs = useQuery({ queryKey: qk.logs(level), queryFn: () => api.logs(level) });
  return (
    <Section
      title="Log"
      description="The latest 300 entries."
      actions={
        <label className="flex items-center gap-2 text-[13px]">
          Level
          <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto">
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
          </Select>
        </label>
      }
    >
      {logs.isPending && <LoadingState />}
      {logs.isError && <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />}
      {logs.data && logs.data.length === 0 && <p className="text-[13px] text-muted">No log entries.</p>}
      {logs.data && logs.data.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => void logs.refetch()} busy={logs.isFetching}>
            Refresh
          </Button>
        </div>
      )}
      {logs.data && logs.data.length > 0 && (
        <ol className="max-h-[32rem] overflow-y-auto font-mono text-xs">
          {logs.data.map((l) => (
            <li key={l.id} className="grid grid-cols-[9rem_3.5rem_1fr] gap-2 border-b border-line py-1 last:border-0 max-sm:grid-cols-[3.5rem_1fr]">
              <span className="text-muted max-sm:hidden">{dateTime(l.createdAt)}</span>
              <span className={l.level === 'error' ? 'font-semibold text-danger' : l.level === 'warn' ? 'font-semibold text-fg' : 'text-muted'}>
                {l.level.toUpperCase()}
              </span>
              <span className="break-words">{l.message}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
