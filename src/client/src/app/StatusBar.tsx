import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { StatusDto } from '../../../shared/api';
import { api } from '../api/endpoints';
import { qk } from '../api/keys';
import { errorText } from '../api/client';
import { connectionStore } from '../api/events';
import { Button, Spinner, cx } from '../components/ui';
import { relativeTime, sourceName } from '../lib/format';
import { useStore } from '../lib/store';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useOnline } from '../lib/useOnline';
import { useFetchNow, useMatchingPause } from './actions';
import { PHONE_QUERY } from './media';

function Item({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('flex items-center gap-1.5 whitespace-nowrap', className)}>{children}</span>;
}

function Dot({ tone }: { tone: 'ok' | 'bad' | 'idle' | 'busy' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-2 shrink-0',
        tone === 'ok' && 'bg-fg',
        tone === 'bad' && 'bg-danger',
        tone === 'idle' && 'bg-faint',
        tone === 'busy' && 'border border-fg',
      )}
    />
  );
}

function ModelDot({ s }: { s: StatusDto }) {
  return <Dot tone={s.llmAvailable === null ? 'idle' : s.llmAvailable ? 'ok' : 'bad'} />;
}

function modelText(s: StatusDto): string {
  return s.llmAvailable === null ? 'Model status unknown' : s.llmAvailable ? 'Model available' : 'Model unavailable';
}

/** "Live", "Connecting" or "Reconnecting" for the event stream, or "Offline" while the device has no network. */
function Connection() {
  const connection = useStore(connectionStore);
  const online = useOnline();
  return online ? (
    <>
      <Dot tone={connection === 'open' ? 'ok' : connection === 'connecting' ? 'busy' : 'bad'} />
      <span>{connection === 'open' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}</span>
    </>
  ) : (
    <>
      <Dot tone="bad" />
      <span className="text-fg">Offline</span>
    </>
  );
}

export function StatusBar({ status }: { status: UseQueryResult<StatusDto> }) {
  const phone = useMediaQuery(PHONE_QUERY);
  return phone ? <PhoneStatusBar status={status} /> : <WideStatusBar status={status} />;
}

/**
 * Below 640px: one line of status, and the whole bar is a link to Activity, whose header holds "Fetch now" and
 * "Pause matching". The line is at least 44px high, and the device's safe area adds to that below it.
 * The first item gives way when the line is full; the faults and the connection stay whole.
 */
function PhoneStatusBar({ status }: { status: UseQueryResult<StatusDto> }) {
  const s = status.data;
  return (
    <footer aria-label="System status" className="shrink-0 border-t border-line text-xs text-muted">
      <Link to="/activity" className="box-content flex min-h-11 items-center gap-3 px-3 pb-[env(safe-area-inset-bottom)] whitespace-nowrap hover:text-fg">
        {status.isError ? (
          <span className="min-w-0 truncate text-danger">Status unavailable: {errorText(status.error)}</span>
        ) : s?.activeRunId != null ? (
          <Item className="min-w-0">
            <Spinner small />
            <span className="text-fg">Fetching</span>
          </Item>
        ) : (
          s && (
            <span className="min-w-0 truncate">
              Last fetch {relativeTime(s.lastRunAt)}
              {s.schedule.paused && ' · schedule paused'}
            </span>
          )
        )}
        {s?.matchingPaused && <span className="shrink-0 border border-fg px-1.5 font-semibold text-fg">Matching paused</span>}
        {s && (
          <Item className="shrink-0">
            <ModelDot s={s} />
            <span>{modelText(s)}</span>
          </Item>
        )}
        {s && (
          <Item className="shrink-0">
            <span>
              Queue <span className="tabular text-fg">{s.queueTotal}</span>
            </span>
          </Item>
        )}
        <Item className="ml-auto shrink-0">
          <Connection />
        </Item>
        <span className="sr-only">, open Activity</span>
      </Link>
    </footer>
  );
}

/** From 640px: the status items in a row, each button beside what it changes. */
function WideStatusBar({ status }: { status: UseQueryResult<StatusDto> }) {
  const s = status.data;
  const runs = useQuery({ queryKey: qk.runs, queryFn: api.runs, enabled: s?.activeRunId != null });
  const activeRun = s?.activeRunId != null ? runs.data?.find((r) => r.id === s.activeRunId) : undefined;
  const fetchNow = useFetchNow();
  const pause = useMatchingPause();

  return (
    <footer
      aria-label="System status"
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-6 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-xs text-muted"
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
                  <span>
                    {activeRun.sources.map((src) => `${sourceName(src.source)} ${src.state === 'running' ? 'running' : `${src.found} found`}`).join(', ')}
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
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => fetchNow.mutate()}
              busy={fetchNow.isPending}
              disabled={s.activeRunId != null}
            >
              Fetch now
            </Button>
          </Item>

          <Item>
            <span
              title={
                Object.entries(s.queue)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ') || 'Queue is empty'
              }
            >
              Queue <span className="tabular text-fg">{s.queueTotal}</span>
            </span>
          </Item>

          <Item>
            <ModelDot s={s} />
            {/* On a touch screen an invisible area of 44px height around the 12px text takes the tap. */}
            <Link
              to="/settings"
              hash="model"
              className="relative hover:text-fg hover:underline touch:after:absolute touch:after:-inset-x-1 touch:after:-inset-y-3.5"
            >
              {modelText(s)}
              <span> ({s.llmProvider === 'claude-code' ? 'Claude Code' : 'local'})</span>
            </Link>
          </Item>

          <Item>
            {s.matchingPaused ? <span className="border border-fg px-1.5 font-semibold text-fg">Matching paused</span> : <span>Matching on</span>}
            <Button size="sm" variant="ghost" className="h-6 text-xs" busy={pause.isPending} onClick={() => pause.mutate(!s.matchingPaused)}>
              {s.matchingPaused ? 'Resume' : 'Pause'}
            </Button>
          </Item>

          <Item className="ml-auto">
            <Connection />
          </Item>
        </>
      )}
    </footer>
  );
}
