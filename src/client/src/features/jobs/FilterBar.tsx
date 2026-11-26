import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { Button, Chip, Icon, Select, TextInput } from '../../components/ui';
import { capitalize, plural } from '../../lib/format';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { TRIAGE_STATUSES, hasActiveFilters, normalizeStatus, statusesOf, type JobSearch } from './filters';
import { PHONE, TOUCH } from './media';

const SCORE_OPTIONS = [40, 50, 60, 70, 75, 80, 90];
const AGE_OPTIONS = [
  { value: 1, label: 'Last 24 hours' },
  { value: 3, label: 'Last 3 days' },
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
];

/** A text input that writes to the URL after a short pause. */
function useDebounced(value: string | undefined, commit: (v: string | undefined) => void, ms = 300) {
  const [text, setText] = useState(value ?? '');
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    if ((value ?? '') !== text.trim()) setText(value ?? '');
  }
  useEffect(() => {
    const t = text.trim() || undefined;
    if (t === value) return;
    const h = setTimeout(() => commit(t), ms);
    return () => clearTimeout(h);
    // `commit` changes on every render; only the text starts the timer.
  }, [text]);
  return [text, setText] as const;
}

export function FilterBar({
  search,
  update,
  total,
  loading,
  searchRef,
}: {
  search: JobSearch;
  update: (patch: Partial<JobSearch>, replace?: boolean) => void;
  total: number | undefined;
  loading: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  // Below 640px the filters open as a full-screen sheet, and never by themselves: the count on the button says that filters are on.
  const phone = useMediaQuery(PHONE);
  const touch = useMediaQuery(TOUCH);
  const [open, setOpen] = useState(() => !phone && hasActiveFilters({ ...search, q: undefined }));
  const panelId = useId();
  const sheetTitleId = useId();
  const [q, setQ] = useDebounced(search.q, (v) => update({ q: v }, true));
  const [tag, setTag] = useDebounced(search.tag, (v) => update({ tag: v }, true));
  const sources = useQuery({ queryKey: qk.sources, queryFn: api.sources, staleTime: 5 * 60_000 });
  const statuses = statusesOf(search);
  const filterCount = Object.keys(search).filter((k) => !['id', 'sort', 'q'].includes(k)).length;

  const toggleStatus = (s: (typeof TRIAGE_STATUSES)[number], on: boolean) => {
    const next = on ? [...statuses, s] : statuses.filter((x) => x !== s);
    if (next.length === 0) return;
    update({ status: normalizeStatus(next.join(',')) });
  };

  return (
    <div className="shrink-0 border-b border-line">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="relative min-w-40 flex-1">
          <label htmlFor="job-search" className="sr-only">
            Search title, company, and description
          </label>
          <TextInput
            id="job-search"
            ref={searchRef}
            type="search"
            // The "/" key is a keyboard hint, so a touch screen leaves it out.
            placeholder={touch ? 'Search jobs' : 'Search jobs   /'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.currentTarget.blur();
                e.stopPropagation();
              }
              if (e.key === 'Enter') update({ q: q.trim() || undefined }, true);
            }}
          />
        </div>
        <label className="sr-only" htmlFor="job-sort">
          Sort order
        </label>
        <Select
          id="job-sort"
          className="w-auto"
          value={search.sort ?? 'score'}
          onChange={(e) => update({ sort: e.target.value === 'newest' ? 'newest' : undefined })}
        >
          <option value="score">Best match first</option>
          <option value="newest">Newest first</option>
        </Select>
        <Button aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} variant={filterCount > 0 ? 'primary' : 'secondary'}>
          Filters{filterCount > 0 ? ` (${filterCount})` : ''}
        </Button>
        <span className="tabular min-w-24 text-[13px] text-muted" aria-live="polite">
          {loading && total === undefined ? 'Loading' : total !== undefined ? plural(total, 'posting') : ''}
        </span>
      </div>

      {phone ? (
        open && (
          <FilterSheet id={panelId} titleId={sheetTitleId} total={total} onClose={() => setOpen(false)}>
            {fields()}
          </FilterSheet>
        )
      ) : (
        <div id={panelId} hidden={!open} className="border-t border-line px-3 py-2">
          {fields()}
        </div>
      )}
    </div>
  );

  function fields() {
    return (
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-medium text-muted">Status</legend>
          <div className="flex flex-wrap gap-1">
            {TRIAGE_STATUSES.map((s) => (
              <Chip key={s} checked={statuses.includes(s)} onChange={(on) => toggleStatus(s, on)}>
                {capitalize(s)}
              </Chip>
            ))}
          </div>
        </fieldset>

        <FilterSelect label="Source" value={search.source ?? ''} onChange={(v) => update({ source: v || undefined })}>
          <option value="">All sources</option>
          {(sources.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {search.source && !sources.data?.some((s) => s.id === search.source) && <option value={search.source}>{search.source}</option>}
        </FilterSelect>

        <FilterSelect label="Work arrangement" value={search.work ?? ''} onChange={(v) => update({ work: (v || undefined) as JobSearch['work'] })}>
          <option value="">Any</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On site</option>
        </FilterSelect>

        <FilterSelect label="Minimum score" value={String(search.minScore ?? '')} onChange={(v) => update({ minScore: v ? Number(v) : undefined })}>
          <option value="">Any score</option>
          {[...new Set([...SCORE_OPTIONS, ...(search.minScore ? [search.minScore] : [])])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n} or higher
              </option>
            ))}
        </FilterSelect>

        <FilterSelect label="Age" value={String(search.maxAgeDays ?? '')} onChange={(v) => update({ maxAgeDays: v ? Number(v) : undefined })}>
          <option value="">Any age</option>
          {AGE_OPTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
          {search.maxAgeDays && !AGE_OPTIONS.some((a) => a.value === search.maxAgeDays) && (
            <option value={search.maxAgeDays}>Last {search.maxAgeDays} days</option>
          )}
        </FilterSelect>

        <div className="flex flex-col gap-1">
          <label htmlFor="job-tag" className="text-xs font-medium text-muted">
            Skill tag
          </label>
          <TextInput id="job-tag" className="w-36" placeholder="For example Go" value={tag} onChange={(e) => setTag(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-3 pb-1">
          <Check label="Unread only" checked={!!search.unread} onChange={(v) => update({ unread: v || undefined })} />
          <Check label="Show excluded" checked={!!search.showExcluded} onChange={(v) => update({ showExcluded: v || undefined })} />
          <Check label="Show duplicates" checked={!!search.showDuplicates} onChange={(v) => update({ showDuplicates: v || undefined })} />
        </div>

        {hasActiveFilters(search) && (
          <Button size="sm" variant="ghost" className="mb-0.5" onClick={() => update({ ...emptyPatch(search) })}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }
}

/**
 * The filters below 640px: a full-screen sheet with "Filters" and Close at the top and "Show N postings" at the bottom.
 * Each filter writes to the address at once, so the count is live.
 */
function FilterSheet({
  id,
  titleId,
  total,
  onClose,
  children,
}: {
  id: string;
  titleId: string;
  total: number | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);
  return (
    <dialog
      ref={ref}
      id={id}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // The job list's keys stay with the list behind the sheet.
      onKeyDown={(e) => e.stopPropagation()}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-bg p-0 text-fg"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-fg px-3 pt-[env(safe-area-inset-top)]">
          <h2 id={titleId} className="py-2 text-xl font-bold">
            Filters
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close filters">
            <Icon name="close" /> Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">{children}</div>
        <div className="shrink-0 border-t border-fg px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Button variant="primary" className="h-11 w-full" onClick={onClose}>
            {total === undefined ? 'Show postings' : `Show ${plural(total, 'posting')}`}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** A patch that removes every filter but keeps sort and selection. */
export function emptyPatch(search: JobSearch): Partial<JobSearch> {
  const patch: Partial<JobSearch> = {};
  for (const k of Object.keys(search) as Array<keyof JobSearch>) if (k !== 'id' && k !== 'sort') patch[k] = undefined;
  return patch;
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <Select id={id} className="w-auto min-w-32" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[13px] touch:min-h-11">
      <input type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
