import { useEffect, useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { MatchDetail, PostingDetail, TriageAction } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { updateListItems } from '../../api/events';
import { Badge, Button, ErrorState, LoadingState, MatchCell, cx, Icon } from '../../components/ui';
import { scoreBand } from '../../../../shared/schemas';
import { capitalize, dateOnly, sourceName } from '../../lib/format';
import { showToast, toastError } from '../../lib/toast';
import { CoverLetter } from './CoverLetter';
import { MatchAnalysis } from './MatchAnalysis';

const STAGE_LABEL: Record<string, string> = { applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' };

export function DetailPanel({
  id,
  onClose,
  onTriage,
  onTagClick,
  headingRef,
}: {
  id: string;
  onClose: () => void;
  onTriage: (ids: string[], action: TriageAction, label?: string) => void;
  onTagClick: (tag: string) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: qk.posting(id),
    queryFn: () => api.posting(id),
    // The live event normally reports the finished letter. The poll covers a lost event.
    refetchInterval: (q) => (q.state.data?.coverLetter?.state === 'pending' || q.state.data?.matchAnalysis?.state === 'pending' ? 4000 : false),
  });
  const markedRead = useRef<string | null>(null);

  const markRead = useMutation({
    mutationFn: (postingId: string) => api.markRead(postingId, true),
    onMutate: (postingId) => {
      updateListItems(qc, postingId, (i) => ({ ...i, unread: false }));
      qc.setQueryData<PostingDetail>(qk.posting(postingId), (d) => (d ? { ...d, unread: false } : d));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.status }),
  });

  // Opening a posting marks it as read, once per opening.
  useEffect(() => {
    const d = detail.data;
    if (d && d.unread && markedRead.current !== d.id) {
      markedRead.current = d.id;
      markRead.mutate(d.id);
    }
  }, [detail.data, markRead]);

  const separate = useMutation({
    mutationFn: () => api.separate(id),
    onSuccess: (d) => {
      qc.setQueryData(qk.posting(id), d);
      void qc.invalidateQueries({ queryKey: qk.postingsAll });
      showToast({ message: 'The posting is now a separate job.', tone: 'info' });
    },
    onError: (e) => toastError(errorText(e)),
  });
  const rescore = useMutation({
    mutationFn: () => api.rescore(id),
    onSuccess: (r) => {
      showToast({ message: r.queued > 0 ? 'Rescore queued.' : 'Nothing to rescore.', tone: 'info' });
      void qc.invalidateQueries({ queryKey: qk.posting(id) });
      void qc.invalidateQueries({ queryKey: qk.status });
    },
    onError: (e) => toastError(errorText(e)),
  });

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close details" aria-keyshortcuts="Escape">
          <Icon name="arrow-left" /> <span className="lg:hidden">Back to list</span>
          <span className="hidden lg:inline">Close</span>
        </Button>
        {detail.data && (
          <a
            href={detail.data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-semibold underline decoration-accent decoration-2 hover:decoration-fg"
          >
            Open posting <Icon name="arrow-up-right" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      {/* Full screen below 1024px: the last lines stay above the home indicator of a phone. */}
      <div className="min-h-0 flex-1 overflow-y-auto max-lg:pb-[env(safe-area-inset-bottom)]">
        {detail.isPending && <LoadingState label="Loading posting" />}
        {detail.isError && <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="This posting could not be loaded." />}
        {detail.data && (
          <Detail
            d={detail.data}
            headingRef={headingRef}
            onTriage={onTriage}
            onTagClick={onTagClick}
            onSeparate={() => separate.mutate()}
            separating={separate.isPending}
            onRescore={() => rescore.mutate()}
            rescoring={rescore.isPending}
          />
        )}
      </div>
    </div>
  );
}

function Detail({
  d,
  headingRef,
  onTriage,
  onTagClick,
  onSeparate,
  separating,
  onRescore,
  rescoring,
}: {
  d: PostingDetail;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onTriage: (ids: string[], action: TriageAction, label?: string) => void;
  onTagClick: (tag: string) => void;
  onSeparate: () => void;
  separating: boolean;
  onRescore: () => void;
  rescoring: boolean;
}) {
  const m = d.match;
  const f = d.facts;
  return (
    <article className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-3xl leading-[1.1] font-bold tracking-tight">
          {d.title}
        </h2>
        <p className="text-muted">
          {[d.company, d.location].filter(Boolean).join(' · ')}
          {d.postedAt && <span> · posted {dateOnly(d.postedAt)}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={d.triageStatus === 'applied' ? 'ok' : d.triageStatus === 'saved' ? 'accent' : 'neutral'}>
            {capitalize(d.triageStatus)}
            {d.triageOrigin === 'auto' ? ' automatically' : ''}
          </Badge>
          {d.unread && <Badge tone="accent">Unread</Badge>}
          {d.workArrangement && <Badge>{d.workArrangement === 'onsite' ? 'On site' : capitalize(d.workArrangement)}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {d.triageStatus !== 'saved' && d.triageStatus !== 'applied' && (
            <Button size="sm" onClick={() => onTriage([d.id], 'save', d.title)} aria-keyshortcuts="s">
              Save
            </Button>
          )}
          {d.triageStatus !== 'dismissed' ? (
            <Button size="sm" onClick={() => onTriage([d.id], 'dismiss', d.title)} aria-keyshortcuts="d">
              Dismiss
            </Button>
          ) : (
            <Button size="sm" onClick={() => onTriage([d.id], 'restore', d.title)} aria-keyshortcuts="r">
              Restore
            </Button>
          )}
          {d.triageStatus !== 'applied' ? (
            <Button size="sm" variant="primary" onClick={() => onTriage([d.id], 'apply', d.title)} aria-keyshortcuts="a">
              Mark as applied
            </Button>
          ) : (
            <Link
              to="/board"
              search={{ app: d.id }}
              className="inline-flex h-7 items-center border border-line-strong px-2.5 text-[13px] font-semibold hover:border-fg hover:bg-surface-2"
            >
              Open on board
            </Link>
          )}
          <Button size="sm" variant="ghost" onClick={onRescore} busy={rescoring}>
            Rescore
          </Button>
        </div>
      </header>

      {d.linkStatus === 'expired' && <Notice tone="warn">This posting may no longer be available. The link at the source has expired.</Notice>}
      {d.duplicateOf && (
        <Notice tone="neutral">
          <p>This posting is a duplicate of another posting.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              to="/jobs"
              search={(prev) => ({ ...prev, id: d.duplicateOf ?? undefined })}
              className="text-[13px] font-semibold underline decoration-accent decoration-2"
            >
              Show the original
            </Link>
            <Button size="sm" onClick={onSeparate} busy={separating}>
              Separate duplicate
            </Button>
          </div>
        </Notice>
      )}
      {d.application && (
        <Notice tone="neutral">
          Application stage: <strong>{STAGE_LABEL[d.application.stage] ?? d.application.stage}</strong>, applied {dateOnly(d.application.appliedAt)}.
        </Notice>
      )}

      <div className="mosaic @container grid-cols-6">
        <ScoreTiles m={m} onRescore={onRescore} rescoring={rescoring} />

        {m && (m.matchedSkills.length > 0 || m.missingSkills.length > 0) && (
          <>
            <Tile color="blue" className="col-span-6 @md:col-span-3 @md:notch-down" order={2} title={`Matched skills (${m.matchedSkills.length})`}>
              <SkillList label="Matched skills" skills={m.matchedSkills} />
            </Tile>
            <Tile
              color="ground"
              className="col-span-6 border border-field-blue @md:col-span-3 @max-md:notch-down"
              order={3}
              title={`Missing skills (${m.missingSkills.length})`}
            >
              <SkillList label="Missing skills" skills={m.missingSkills} />
            </Tile>
          </>
        )}

        {m?.assessment && (
          <Tile color="ground" className="col-span-6 @3xl:col-span-3 @3xl:notch-right @max-3xl:notch-down" order={4} title="Assessment">
            <p className="max-w-[70ch] text-[15px] leading-relaxed whitespace-pre-wrap">{m.assessment}</p>
            {m.softViolations.length > 0 && (
              <>
                <h4 className="mt-4 mb-1 font-semibold">Preference conflicts</h4>
                <ul className="list-disc space-y-1 pl-5">
                  {m.softViolations.map((v, i) => (
                    <li key={i}>
                      <span className="font-semibold">{v.kind === 'language' ? 'Language' : 'Work arrangement'}:</span> {v.detail}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Tile>
        )}

        <Tile color="pink" className={cx('col-span-6', m?.assessment && '@3xl:col-span-3')} order={5} title="Cover letter">
          <CoverLetter key={d.id} postingId={d.id} letter={d.coverLetter} />
        </Tile>

        <Tile color="ground" className="col-span-6 border border-line-strong" order={6} title="Expanded analysis">
          <MatchAnalysis postingId={d.id} analysis={d.matchAnalysis} currentScore={d.match?.totalScore ?? null} />
        </Tile>

        {f && (
          <Tile color="blue" className="col-span-6 @3xl:sticky @3xl:top-0 @3xl:col-span-2 @3xl:self-start" order={6} title="Facts">
            {f.summary && <p className="mb-4 max-w-[70ch] text-[15px] leading-relaxed">{f.summary}</p>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
              <Fact label="Seniority" value={f.seniority ? capitalize(f.seniority) : null} />
              <Fact label="Work arrangement" value={f.workArrangement ? (f.workArrangement === 'onsite' ? 'On site' : capitalize(f.workArrangement)) : null} />
              <Fact label="Location" value={[f.location.city, f.location.country].filter(Boolean).join(', ') || null} />
              <Fact label="Languages" value={f.requiredLanguages.join(', ') || null} />
              <Fact
                label="Salary"
                value={
                  f.salary
                    ? `${[f.salary.min, f.salary.max]
                        .filter((n) => n !== null)
                        .map((n) => n!.toLocaleString())
                        .join(' to ')} ${f.salary.currency} per ${f.salary.period}`
                    : null
                }
              />
              <Fact label="Required skills" value={f.requiredSkills.join(', ') || null} />
              <Fact label="Optional skills" value={f.optionalSkills.join(', ') || null} />
            </dl>
            {d.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Tags">
                {d.tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onTagClick(t)}
                    className="border border-line-strong px-1.5 py-0.5 text-xs font-medium hover:bg-ink hover:text-field-blue"
                    aria-label={`Filter by tag ${t}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </Tile>
        )}

        <Tile color="beige" className={cx('col-span-6', f && '@3xl:col-span-4')} order={7} title="Description">
          {d.description ? (
            <div className="max-w-[70ch] text-[15px] leading-relaxed whitespace-pre-wrap">{d.description}</div>
          ) : (
            <p className="text-muted">The source gave no description for this posting.</p>
          )}
        </Tile>

        <Tile color="ground" className="col-span-6" order={8} title={`Sources (${d.sourceLinks.length})`}>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {d.sourceLinks.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline decoration-accent decoration-2 hover:decoration-fg"
                >
                  {sourceName(s.source)}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                {s.primary && <Badge>Primary</Badge>}
              </li>
            ))}
          </ul>
        </Tile>
      </div>

      {m?.provider && (
        <p className="text-xs text-faint">
          Scored by {m.provider}
          {m.model ? ` (${m.model})` : ''}.
        </p>
      )}
    </article>
  );
}

type TileColor = 'yellow' | 'blue' | 'pink' | 'beige' | 'ground';

/** One tile of the detail mosaic. A color field carries near-black text. A notch points to the tile that follows from this one. */
function Tile({
  color,
  title,
  notch,
  order = 0,
  className,
  children,
}: {
  color: TileColor;
  title?: string;
  notch?: 'right' | 'down';
  order?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        'tile p-4 sm:p-5',
        `tile-${color}`,
        color !== 'ground' && 'field',
        notch === 'right' && '@md:notch-right @max-md:notch-down',
        notch === 'down' && 'notch-down',
        className,
      )}
      style={{ animation: `tile-in 420ms cubic-bezier(0.16, 1, 0.3, 1) ${order * 45}ms backwards` }}
    >
      {title && <h3 className="mb-3 text-base font-bold">{title}</h3>}
      {children}
    </section>
  );
}

/** The score as a figure: the total in a yellow tile, with a notch to the four parts it is computed from. */
function ScoreTiles({ m, onRescore, rescoring }: { m: MatchDetail | null; onRescore: () => void; rescoring: boolean }) {
  if (!m) {
    return (
      <Tile color="ground" className="col-span-6" title="Score">
        <p className="text-muted">This posting waits for scoring.</p>
      </Tile>
    );
  }
  const dims: Array<[string, number | null]> = [
    ['Skills', m.skillsScore],
    ['Experience', m.experienceScore],
    ['Preferences', m.preferenceScore],
    ['Location', m.locationScore],
  ];
  const hasParts = dims.some(([, v]) => v !== null);
  // The weights explain how the four parts give the total.
  const prefs = useQuery({ queryKey: qk.preferences, queryFn: api.preferences, staleTime: 60_000 });
  const w = prefs.data?.weights;
  const weightOf: Record<string, number> | null = w ? { Skills: w.skills, Experience: w.experience, Preferences: w.preferences, Location: w.location } : null;
  const weightSum = weightOf ? Object.values(weightOf).reduce((a, b) => a + b, 0) : 0;
  const { label } = scoreBand(m.totalScore);
  return (
    <>
      <Tile
        color={m.totalScore !== null ? 'yellow' : 'ground'}
        className={cx('col-span-6 flex flex-col', hasParts && '@md:col-span-2')}
        notch={hasParts ? 'right' : undefined}
        order={0}
      >
        <h3 className="text-base font-bold">Score</h3>
        {m.totalScore !== null ? (
          <p className="mt-auto pt-4">
            <span className="tabular block text-8xl leading-[0.8] font-extrabold tracking-tight">{m.totalScore}</span>
            <span className="mt-3 block text-sm font-semibold">{label}</span>
            <span aria-hidden className="mt-2 block h-1.5 bg-ink/20">
              <span className="block h-full bg-ink" style={{ width: `${m.totalScore}%` }} />
            </span>
          </p>
        ) : (
          <div className="mt-3">
            <MatchCell match={m} />
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
          {m.totalScore !== null && m.state === 'in_progress' && <Badge>Rescoring</Badge>}
          {m.stale && <Badge title="This score comes from an older profile or preferences">Stale</Badge>}
        </div>
        {m.state === 'excluded' && m.excludedReason && <p className="mt-2 text-[13px] font-semibold text-danger">Excluded: {m.excludedReason}</p>}
        {m.state === 'failed' && (
          <div className="mt-2 text-[13px]">
            <p className="text-danger">Scoring failed{m.failReason ? `: ${m.failReason}` : '.'}</p>
            <Button size="sm" className="mt-2" onClick={onRescore} busy={rescoring}>
              Try again
            </Button>
          </div>
        )}
      </Tile>
      {hasParts && (
        <Tile color="ground" className="col-span-6 @md:col-span-4" notch="down" order={1} title="How the score is built">
          <dl className="grid gap-3">
            {dims.map(([name, v]) => {
              const share = weightOf && weightSum > 0 ? Math.round((weightOf[name]! / weightSum) * 100) : null;
              // A part with weight 0 has no effect on the total, so it must not look like the other parts.
              const counted = !weightOf || weightOf[name]! > 0;
              return (
                <div key={name} className="grid grid-cols-[6.5rem_1fr_2.75rem] items-center gap-x-3">
                  <dt className="text-[13px] text-muted">
                    {name}
                    {share !== null && <span className="tabular block text-xs text-faint">{counted ? `weight ${share}%` : 'not counted'}</span>}
                  </dt>
                  <dd className="h-2.5 bg-bg" aria-hidden>
                    <span className={cx('block h-full', counted ? 'bg-field-yellow' : 'bg-ink/20')} style={{ width: `${v ?? 0}%` }} />
                  </dd>
                  <dd className={cx('tabular text-right text-lg leading-none font-bold', !counted && 'text-faint')}>{v ?? '–'}</dd>
                </div>
              );
            })}
          </dl>
          {weightOf && (
            <p className="mt-3 text-xs text-muted">The total is the average of the counted parts by weight. Conflicts with your preferences lower it.</p>
          )}
        </Tile>
      )}
    </>
  );
}

function SkillList({ label, skills }: { label: string; skills: string[] }) {
  if (skills.length === 0) return <p className="text-[13px] text-muted">None.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {skills.map((s) => (
        <li key={s} className="border border-line-strong px-2 py-0.5 text-[13px] font-medium">
          {s}
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone: 'warn' | 'neutral' }) {
  return (
    <div
      role={tone === 'warn' ? 'note' : undefined}
      className={cx('border px-3 py-2 text-[13px]', tone === 'warn' ? 'border-dashed border-fg text-fg' : 'border-line')}
    >
      {tone === 'warn' && <span className="font-medium">Note: </span>}
      {children}
    </div>
  );
}
