import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import type { ApplicationDto } from '../../../../shared/api';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { Badge, EmptyState, ErrorState, LoadingState, Select, cx } from '../../components/ui';
import { dateOnly, dateTime } from '../../lib/format';
import { ApplicationPanel } from './ApplicationPanel';
import { STAGE_LABEL, useMoveApplication } from './stages';

export function BoardPage() {
  const search = useSearch({ from: '/board' });
  const navigate = useNavigate({ from: '/board' });
  const apps = useQuery({ queryKey: qk.applications, queryFn: api.applications });
  const move = useMoveApplication();
  const [dragOver, setDragOver] = useState<ApplicationStage | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const open = (id: string | undefined) => void navigate({ search: id ? { app: id } : {} });
  const selected = search.app ? apps.data?.find((a) => a.postingId === search.app) : undefined;

  const onDrop = (e: DragEvent, stage: ApplicationStage) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain') || dragging;
    setDragging(null);
    const app = apps.data?.find((a) => a.postingId === id);
    if (app && app.stage !== stage) move.mutate({ id: app.postingId, stage });
  };

  const onCardKey = (e: KeyboardEvent, app: ApplicationDto) => {
    if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const i = APPLICATION_STAGES.indexOf(app.stage);
    const next = APPLICATION_STAGES[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) move.mutate({ id: app.postingId, stage: next });
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-3 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-4xl font-bold tracking-tight">Applications</h1>
          <p className="max-w-[60ch] text-xs text-muted">
            Drag a card to another column, use the stage menu on a card, or press Shift with the left or right arrow on a focused card.
          </p>
        </div>
        {apps.isPending && <LoadingState label="Loading applications" />}
        {apps.isError && <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />}
        {apps.isSuccess && apps.data.length === 0 && (
          <EmptyState
            title="No applications yet."
            action={
              <Link to="/jobs" className="font-semibold underline decoration-accent decoration-2">
                Go to jobs
              </Link>
            }
          >
            Mark a posting as applied in the job list, and it appears here in the first column.
          </EmptyState>
        )}
        {apps.isSuccess && apps.data.length > 0 && (
          <div className="mosaic grid-cols-1 md:min-h-0 md:flex-1 md:grid-cols-5">
            {APPLICATION_STAGES.map((stage) => {
              const cards = apps.data.filter((a) => a.stage === stage);
              return (
                <section
                  key={stage}
                  aria-label={`${STAGE_LABEL[stage]}, ${cards.length} applications`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOver !== stage) setDragOver(stage);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null);
                  }}
                  onDrop={(e) => onDrop(e, stage)}
                  className={cx(
                    'tile tile-ground flex min-h-24 flex-col md:min-h-0',
                    // The notch shows the direction of the process, from one stage to the next.
                    (stage === 'applied' || stage === 'interview') && 'md:notch-right',
                    dragOver === stage && 'outline-2 -outline-offset-2 outline-accent',
                  )}
                >
                  <h2 className="flex items-baseline justify-between px-4 pt-3.5 pb-3 text-base font-bold">
                    {STAGE_LABEL[stage]}
                    <span className="tabular text-2xl leading-none font-extrabold text-muted">{cards.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-1.5 px-1.5 pb-1.5 md:min-h-0 md:flex-1 md:overflow-y-auto">
                    <AnimatePresence initial={false}>
                      {cards.map((a) => (
                        <motion.li
                          key={a.postingId}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Card
                            app={a}
                            active={a.postingId === search.app}
                            dragging={dragging === a.postingId}
                            onOpen={() => open(a.postingId)}
                            onMove={(s) => move.mutate({ id: a.postingId, stage: s })}
                            onKeyDown={(e) => onCardKey(e, a)}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', a.postingId);
                              e.dataTransfer.effectAllowed = 'move';
                              setDragging(a.postingId);
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              setDragOver(null);
                            }}
                          />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
      {search.app && (
        <aside
          aria-label="Application details"
          className="fixed inset-0 z-30 flex flex-col bg-bg lg:static lg:z-auto lg:w-[30rem] lg:shrink-0 lg:border-l lg:border-fg"
        >
          {selected ? (
            <ApplicationPanel key={selected.postingId} app={selected} onClose={() => open(undefined)} />
          ) : apps.isPending ? (
            <LoadingState />
          ) : (
            <div className="p-4">
              <p>This application does not exist.</p>
              <button type="button" className="mt-2 font-semibold underline decoration-accent decoration-2" onClick={() => open(undefined)}>
                Close
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function Card({
  app,
  active,
  dragging,
  onOpen,
  onMove,
  onKeyDown,
  onDragStart,
  onDragEnd,
}: {
  app: ApplicationDto;
  active: boolean;
  dragging: boolean;
  onOpen: () => void;
  onMove: (s: ApplicationStage) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const interview = app.interviewAt ? Date.parse(app.interviewAt) : NaN;
  const upcoming = Number.isFinite(interview) && interview > Date.now();
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cx(
        'field bg-field-pink p-3',
        active && 'outline-2 outline-offset-[-2px] outline-ink',
        dragging && 'opacity-50',
        'cursor-grab active:cursor-grabbing',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        onKeyDown={onKeyDown}
        aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
        className="block w-full text-left"
      >
        <span className="line-clamp-2 text-[15px] leading-snug font-bold">{app.snapshot.title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">{app.snapshot.company}</span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {app.totalScore !== null && (
          <span className="tabular bg-ink px-1.5 text-sm leading-6 font-extrabold text-field-pink">
            {app.totalScore}
            <span className="sr-only"> score</span>
          </span>
        )}
        {app.linkStatus === 'expired' && <Badge tone="warn">Link expired</Badge>}
        <span>Applied {dateOnly(app.appliedAt)}</span>
      </div>
      {app.interviewAt && (
        <p className={cx('mt-1.5 text-xs', upcoming ? 'font-bold' : 'text-muted')}>
          {upcoming ? 'Interview' : 'Interview was'} {dateTime(app.interviewAt)}
        </p>
      )}
      <label className="mt-2 block text-xs">
        <Select
          className="h-7 w-full py-0 text-xs"
          value={app.stage}
          onChange={(e) => onMove(e.target.value as ApplicationStage)}
          aria-label={`Stage of ${app.snapshot.title}`}
        >
          {APPLICATION_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
