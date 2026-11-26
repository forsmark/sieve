import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { BulkAction, PostingCounts, PostingListItem, TriageAction } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { updateListItems } from '../../api/events';
import { Button, EmptyState, ErrorState, LoadingState, Spinner, cx } from '../../components/ui';
import { plural } from '../../lib/format';
import { onUndone, showToast, toastError, undoLast } from '../../lib/toast';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { BulkBar } from './BulkBar';
import { DetailPanel } from './DetailPanel';
import { FilterBar, emptyPatch } from './FilterBar';
import { hasActiveFilters, statusesOf, toPostingQuery, type JobSearch } from './filters';
import { CARD_GAP, CARD_HEIGHT, CARD_MIN_WIDTH, JobRow, MAX_COLUMNS, listColumnsBesidePanel } from './JobRow';
import { RemoveApplicationDialog } from './RemoveApplicationDialog';
import { ShortcutHelp } from './ShortcutHelp';
import type { SwipeAction } from './swipe';
import { STATUS_OF, useTriage } from './useTriage';
import { DETAIL_FULL_SCREEN, PHONE } from './media';
import { UndoControl } from './UndoControl';
import { useRemoveApplication } from '../board/stages';

export const PAGE_SIZE = 50;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit'].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

export function JobsPage() {
  const search = useSearch({ from: '/jobs' });
  const navigate = useNavigate({ from: '/jobs' });
  const qc = useQueryClient();

  const update = useCallback((patch: Partial<JobSearch>, replace = false) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace }), [navigate]);

  const query = toPostingQuery(search);
  const list = useInfiniteQuery({
    queryKey: qk.postings(query),
    queryFn: ({ pageParam, signal }) => api.listPostings({ ...query, offset: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: 0,
    // `nextOffset` says whether more exist. Rows that triage removed locally also left the server's result,
    // so the next offset is the number of loaded rows; this avoids skipping postings.
    getNextPageParam: (last, pages) =>
      last.nextOffset === null
        ? undefined
        : Math.min(
            last.nextOffset,
            pages.reduce((n, p) => n + p.items.length, 0),
          ),
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: PostingListItem[] = [];
    for (const page of list.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }, [list.data]);
  const total = list.data?.pages[0]?.total;

  const [cursorRaw, setCursor] = useState(0);
  const cursor = items.length === 0 ? -1 : Math.min(Math.max(0, cursorRaw), items.length - 1);
  const current = cursor >= 0 ? items[cursor] : undefined;
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [helpOpen, setHelpOpen] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusRowSoon = useRef(false);
  /** The posting whose card takes focus once it is in the list, after the detail view closed, and until when to wait for it. */
  const focusCardSoon = useRef<{ id: string; until: number; scrolled: boolean } | undefined>(undefined);
  const phone = useMediaQuery(PHONE);
  const fullScreen = useMediaQuery(DETAIL_FULL_SCREEN);

  // The open posting names the page. The detail view shares this query, so it adds no request.
  const openDetail = useQuery({ queryKey: qk.posting(search.id ?? ''), queryFn: () => api.posting(search.id!), enabled: !!search.id });
  useDocumentTitle((search.id && openDetail.data?.title) || 'Jobs');

  /** The posting that the detail view opened by itself after a triage. It counts as read only after a dwell. */
  const [autoOpenedId, setAutoOpenedId] = useState<string | undefined>(undefined);

  // Keep the cursor on the selected posting, for example after a reload with `?id=`.
  useEffect(() => {
    if (!search.id) return;
    const idx = items.findIndex((i) => i.id === search.id);
    if (idx >= 0) setCursor((c) => (c === idx ? c : idx));
  }, [search.id, items]);

  // Live updates add rows and change the order. The cursor stays on its posting while that posting is in the list.
  // When the posting left the list, for example after a dismissal, the cursor keeps its position.
  const cursorId = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const id = cursorId.current;
    if (!id || items[cursorRaw]?.id === id) return;
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) setCursor(idx);
  }, [items]);
  useLayoutEffect(() => {
    cursorId.current = current?.id;
  }, [current?.id]);

  // Drop selected ids that left the list.
  useEffect(() => {
    setSelection((sel) => {
      if (sel.size === 0) return sel;
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...sel].filter((id) => ids.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [items]);

  // The page has one column grid, with at most MAX_COLUMNS columns. The open detail panel covers some of
  // those columns, so a card keeps its width when the panel opens or closes.
  const pageRef = useRef<HTMLDivElement>(null);
  const [pageColumns, setPageColumns] = useState(1);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const measure = () => {
      setPageColumns(Math.min(MAX_COLUMNS, Math.max(1, Math.floor((el.clientWidth - CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)))));
      // Below this width the detail covers the whole screen, as the "lg" breakpoint does in CSS.
      setWide(window.innerWidth >= 1024);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const panelOpen = !!search.id && wide;
  const columns = panelOpen ? listColumnsBesidePanel(pageColumns) : pageColumns;

  const virtualizer = useVirtualizer({
    count: items.length + (list.hasNextPage ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + CARD_GAP,
    getItemKey: (i) => items[i]?.id ?? `loader-${i}`,
    lanes: columns,
    paddingStart: CARD_GAP,
    overscan: 4 * columns,
  });
  // A new column count moves every card, so the same scroll offset would show other postings.
  // Keep the open posting in view, or else the first visible row.
  const lastColumns = useRef(columns);
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const before = lastColumns.current;
    lastColumns.current = columns;
    virtualizer.measure();
    if (before === columns) return;
    // A column change places every card anew. Only a change of order animates.
    const grid = gridRef.current;
    if (grid) {
      grid.dataset.still = '';
      requestAnimationFrame(() => requestAnimationFrame(() => delete grid.dataset.still));
    }
    // On close, the posting that was open is the one under the cursor.
    const openIndex = search.id ? items.findIndex((p) => p.id === search.id) : columns > before && cursor < items.length ? cursor : -1;
    const firstVisible = Math.floor((parentRef.current?.scrollTop ?? 0) / (CARD_HEIGHT + CARD_GAP)) * before;
    const anchor = openIndex >= 0 ? openIndex : firstVisible;
    const el = parentRef.current;
    if (!el || anchor <= 0) return;
    // The offset comes from the fixed card height, because the virtualizer has no measurements at this point.
    const rowTop = Math.floor(anchor / columns) * (CARD_HEIGHT + CARD_GAP);
    const top = openIndex >= 0 ? rowTop - (el.clientHeight - CARD_HEIGHT) / 2 : rowTop;
    el.scrollTop = Math.max(0, top);
  }, [columns, virtualizer]);
  const virtualItems = virtualizer.getVirtualItems();

  // Paging: load the next page when the end of the list comes into view.
  const lastVirtual = virtualItems[virtualItems.length - 1];
  useEffect(() => {
    if (!lastVirtual) return;
    if (lastVirtual.index >= items.length - 5 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [lastVirtual, items.length, list]);

  // After the detail view closed, its card takes focus. A card outside the rendered rows is scrolled to once.
  useEffect(() => {
    const pending = focusCardSoon.current;
    if (!pending) return;
    // A render long after the close does not take focus.
    if (Date.now() > pending.until) {
      focusCardSoon.current = undefined;
      return;
    }
    const el = document.getElementById(`row-${pending.id}`);
    if (el) {
      el.focus({ preventScroll: true });
      // In a render before the close commits, the list is still inert and the focus does not take. A later render tries again.
      if (document.activeElement === el) focusCardSoon.current = undefined;
      return;
    }
    const idx = items.findIndex((i) => i.id === pending.id);
    if (idx < 0) {
      // The posting left the list. The card under the cursor takes focus instead.
      focusCardSoon.current = undefined;
      focusRowSoon.current = true;
    } else if (!pending.scrolled) {
      pending.scrolled = true;
      virtualizer.scrollToIndex(idx, { align: 'auto' });
    }
  });

  // Move DOM focus to the cursor row when the list had focus.
  useEffect(() => {
    if (!focusRowSoon.current || cursor < 0) return;
    const el = parentRef.current?.querySelector<HTMLElement>(`[data-row-button="${cursor}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      focusRowSoon.current = false;
    }
  });

  const listHasFocus = () => {
    const a = document.activeElement;
    return !!a && (a === document.body || !!parentRef.current?.contains(a));
  };

  const openPosting = useCallback(
    (id: string | undefined, replace = false) => {
      update({ id }, replace);
    },
    [update],
  );

  const moveCursor = (next: number) => {
    if (items.length === 0) return;
    const i = Math.min(Math.max(0, next), items.length - 1);
    if (listHasFocus()) focusRowSoon.current = true;
    setCursor(i);
    virtualizer.scrollToIndex(i, { align: 'auto' });
    if (search.id && items[i]) {
      setAutoOpenedId(undefined);
      openPosting(items[i].id, true);
    }
    if (i >= items.length - 3 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };

  const triage = useTriage();
  const statuses = statusesOf(search);
  // The navigation shares this query, so it adds no request. The empty state names the postings the default list hides.
  const status = useQuery({ queryKey: qk.status, queryFn: api.status });
  const hidden = status.data ? hiddenByDefault(status.data.counts) : null;
  const canFetch = status.data ? status.data.hasCv && status.data.searchTermCount > 0 : false;

  // A swipe whose card is still sliding out when the user leaves the page runs as the page unmounts.
  // It then changes the status and does not move the user back to a posting on this page.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const doTriage = useCallback(
    (ids: string[], action: TriageAction, label?: string, opts?: { keepSelection?: boolean }) => {
      if (ids.length === 0) return;
      const leaves = !statuses.includes(STATUS_OF[action]);
      let returnTo: string | undefined;
      if (leaves && mounted.current && search.id && ids.includes(search.id)) {
        // Follow with the next posting, so triage in the detail view keeps going.
        const idx = items.findIndex((i) => i.id === search.id);
        const after =
          items.slice(idx + 1).find((i) => !ids.includes(i.id)) ??
          items
            .slice(0, Math.max(0, idx))
            .reverse()
            .find((i) => !ids.includes(i.id));
        // The undo of this triage shows the posting again.
        if (after) returnTo = search.id;
        setAutoOpenedId(after?.id);
        openPosting(after?.id, true);
      }
      if (listHasFocus()) focusRowSoon.current = true;
      triage.mutate({ ids, action, label, returnTo });
      setSelection((s) => {
        if (!opts?.keepSelection) return s.size ? new Set() : s;
        // A swipe acts on one card. The other cards stay selected.
        return ids.some((id) => s.has(id)) ? new Set([...s].filter((id) => !ids.includes(id))) : s;
      });
    },
    [items, openPosting, search.id, statuses, triage],
  );

  // ---- Swipes on touch screens

  const [removing, setRemoving] = useState<PostingListItem | null>(null);
  const removeApplication = useRemoveApplication();
  // The swipe handlers stay the same across renders, so a change of the list does not render every card again.
  const triageRef = useRef(doTriage);
  triageRef.current = doTriage;
  const onSwipe = useCallback((item: PostingListItem, action: SwipeAction) => {
    // Leaving "applied" deletes the application, so a swipe only asks.
    if (action === 'remove-application') setRemoving(item);
    else triageRef.current([item.id], action, item.title, { keepSelection: true });
  }, []);
  const statusKey = statuses.join(',');
  const swipeLeaves = useCallback((action: SwipeAction) => action !== 'remove-application' && !statusKey.split(',').includes(STATUS_OF[action]), [statusKey]);

  const bulkOther = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: Exclude<BulkAction, TriageAction> }) => api.bulk(ids, action),
    onMutate: ({ ids, action }) => {
      if (action === 'read' || action === 'unread') for (const id of ids) updateListItems(qc, id, (i) => ({ ...i, unread: action === 'unread' }));
    },
    onSuccess: (r, { ids, action }) => {
      const what = plural(ids.length, 'posting');
      showToast({
        message:
          action === 'rescore'
            ? `Rescore queued for ${plural(r.queued ?? 0, 'posting')}.`
            : action === 'analyze'
              ? `Expanded analysis started for ${plural(r.queued ?? 0, 'posting')}.`
              : `Marked ${what} as ${action}.`,
        tone: 'info',
      });
      setSelection(new Set());
    },
    onError: (e) => {
      toastError(errorText(e));
      void qc.invalidateQueries({ queryKey: qk.postingsAll });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.status }),
  });

  const targets = (): string[] => (selection.size ? [...selection] : current ? [current.id] : []);
  const labelFor = (ids: string[]) => (ids.length === 1 ? items.find((i) => i.id === ids[0])?.title : undefined);

  const toggleSelect = useCallback((id: string) => {
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // An undo of a triage that moved the detail view on shows the earlier posting again, while this page is mounted.
  const reopen = useRef<(id: string) => void>(() => {});
  reopen.current = (id) => {
    setAutoOpenedId(undefined);
    openPosting(id, true);
  };
  useEffect(
    () =>
      onUndone((entry) => {
        if (entry.kind === 'triage' && entry.returnTo && mounted.current) reopen.current(entry.returnTo);
      }),
    [],
  );

  const onOpenRow = useCallback(
    (id: string, index: number) => {
      setCursor(index);
      setAutoOpenedId(undefined);
      openPosting(id);
    },
    [openPosting],
  );

  // While a posting is open, a focus from Tab leaves the cursor where it is, so the triage keys still act on the open posting.
  // The cursor keys and a click still move it.
  const openId = useRef(search.id);
  openId.current = search.id;
  const onFocusRow = useCallback((index: number) => {
    if (!openId.current) setCursor(index);
  }, []);

  const closeDetail = () => {
    focusCardSoon.current = search.id ? { id: search.id, until: Date.now() + 1000, scrolled: false } : undefined;
    openPosting(undefined);
  };

  // ---- Keyboard shortcuts

  const handler = useRef<(e: KeyboardEvent) => void>(() => {});
  handler.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (removing) return;
    if (helpOpen) {
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(false);
      }
      return;
    }
    const target = e.target as HTMLElement | null;
    switch (e.key) {
      case 'j':
        e.preventDefault();
        moveCursor(cursor + 1);
        break;
      case 'k':
        e.preventDefault();
        moveCursor(cursor - 1);
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'ArrowUp': {
        // Arrow keys move in the grid. They stay free for scrolling inside the detail panel.
        const inList = target === document.body || (!!target && !!parentRef.current?.contains(target));
        if (!inList || e.shiftKey) break;
        e.preventDefault();
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : -columns;
        const next = cursor + step;
        // A vertical step stops at the first and the last row and does not jump to another column.
        if (Math.abs(step) > 1 && (next < 0 || next > items.length - 1)) break;
        moveCursor(next);
        break;
      }
      case 'Enter':
        if (current && (target === document.body || target === parentRef.current)) {
          e.preventDefault();
          onOpenRow(current.id, cursor);
        }
        break;
      case 's':
        e.preventDefault();
        doTriage(targets(), 'save', labelFor(targets()));
        break;
      case 'd':
        e.preventDefault();
        doTriage(targets(), 'dismiss', labelFor(targets()));
        break;
      case 'r':
        e.preventDefault();
        doTriage(targets(), 'restore', labelFor(targets()));
        break;
      case 'a':
        e.preventDefault();
        doTriage(targets(), 'apply', labelFor(targets()));
        break;
      case 'o':
        if (current) {
          e.preventDefault();
          window.open(current.url, '_blank', 'noopener,noreferrer');
        }
        break;
      case 'u':
        e.preventDefault();
        void undoLast('triage').then((done) => {
          if (!done) showToast({ message: 'Nothing to undo.', tone: 'info' }, 2000);
        });
        break;
      case 'x':
        if (current) {
          e.preventDefault();
          toggleSelect(current.id);
        }
        break;
      case '/':
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      case '?':
        e.preventDefault();
        setHelpOpen(true);
        break;
      case 'Escape':
        if (search.id) {
          e.preventDefault();
          closeDetail();
        } else if (selection.size) {
          e.preventDefault();
          setSelection(new Set());
        }
        break;
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => handler.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const allLoadedSelected = items.length > 0 && selection.size === items.length;
  const clearSelection = () => setSelection(new Set());

  return (
    <div ref={pageRef} className="flex h-full">
      <div
        className={cx('flex min-w-0 flex-col', !panelOpen && 'flex-1')}
        style={panelOpen ? { width: `${(columns / pageColumns) * 100}%`, flexShrink: 0 } : undefined}
        // The full-screen detail covers the list. Focus and the screen reader stay in the detail.
        inert={!!search.id && fullScreen}
      >
        <h1 className="sr-only">Jobs</h1>
        {search.id && (
          <a
            href="#posting-heading"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:font-semibold focus:text-on-accent"
            onClick={(e) => {
              e.preventDefault();
              headingRef.current?.focus();
            }}
          >
            Go to the open posting
          </a>
        )}
        <FilterBar search={search} update={update} total={total} loading={list.isPending} searchRef={searchRef} />

        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-fg px-3 text-[13px] touch:h-11">
          {/* The label keeps one line; the undo control beside it shortens instead. */}
          <label className="flex shrink-0 items-center gap-2 self-stretch whitespace-nowrap">
            <input
              type="checkbox"
              className="size-4"
              checked={allLoadedSelected}
              ref={(el) => {
                if (el) el.indeterminate = selection.size > 0 && !allLoadedSelected;
              }}
              // In the mixed state the control clears the selection, as it does when every posting is selected.
              onChange={() => setSelection(selection.size > 0 ? new Set() : new Set(items.map((i) => i.id)))}
              disabled={items.length === 0}
            />
            <span className={selection.size ? 'font-medium' : 'text-muted'}>{selection.size ? `${selection.size} selected` : 'Select all loaded'}</span>
          </label>
          {selection.size > 0 && phone && (
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
          )}
          {selection.size > 0 && !phone && (
            <div role="toolbar" aria-label="Bulk actions" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              <Button size="sm" onClick={() => doTriage([...selection], 'save')}>
                Save
              </Button>
              <Button size="sm" onClick={() => doTriage([...selection], 'dismiss')}>
                Dismiss
              </Button>
              <Button size="sm" onClick={() => doTriage([...selection], 'restore')}>
                Restore
              </Button>
              <Button size="sm" onClick={() => doTriage([...selection], 'apply')}>
                Applied
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulkOther.mutate({ ids: [...selection], action: 'rescore' })}>
                Rescore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Fable 5.2 analyzes each selected posting. Your CV text and the posting text are sent to Anthropic."
                onClick={() => bulkOther.mutate({ ids: [...selection], action: 'analyze' })}
              >
                Analyze
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulkOther.mutate({ ids: [...selection], action: 'read' })}>
                Mark read
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulkOther.mutate({ ids: [...selection], action: 'unread' })}>
                Mark unread
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          )}
          <span className="ml-auto flex min-w-0 items-center gap-1">
            <UndoControl />
            {selection.size === 0 && (
              // Keyboard hints are for a keyboard. The `?` key still opens the list on a touch screen.
              <Button size="sm" variant="ghost" className="touch:hidden" onClick={() => setHelpOpen(true)} aria-keyshortcuts="?">
                Shortcuts <kbd className="ml-1 border border-line-strong px-1 font-mono text-[11px]">?</kbd>
              </Button>
            )}
          </span>
        </div>

        <div
          ref={parentRef}
          className="relative min-h-0 flex-1 overflow-y-auto"
          role="list"
          aria-label={`Job postings${total !== undefined ? `, ${plural(total, 'posting')}` : ''}`}
          aria-busy={list.isFetching || undefined}
        >
          {list.isPending && <LoadingState label="Loading postings" />}
          {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} title="The postings could not be loaded." />}
          {/* The status decides between the two empty states, so they wait for it. */}
          {list.isSuccess &&
            items.length === 0 &&
            !status.isPending &&
            (hasActiveFilters(search) ? (
              <EmptyState
                title="No postings match these filters."
                action={
                  <Button variant="primary" onClick={() => update(emptyPatch(search))}>
                    Clear filters
                  </Button>
                }
              >
                Try a lower minimum score, another status, or a shorter search.
              </EmptyState>
            ) : hidden ? (
              <EmptyState
                title="No new or saved postings."
                action={
                  <Button variant="primary" onClick={() => update({ status: 'all' })}>
                    Show every status
                  </Button>
                }
              >
                {hidden}{' '}
                {canFetch ? 'New ones appear here after the next fetch.' : 'Add a CV and search terms, then fetch jobs with the button in the status bar.'}
              </EmptyState>
            ) : (
              <EmptyState title="No postings yet.">
                Add a CV and search terms, then fetch jobs with the button in the status bar. New postings appear here as they arrive.
              </EmptyState>
            ))}
          {items.length > 0 && (
            <div ref={gridRef} className="card-grid" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((v) => {
                const item = items[v.index];
                return (
                  <div
                    key={v.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: CARD_GAP,
                      width: `calc((100% - ${CARD_GAP}px) / ${columns} - ${CARD_GAP}px)`,
                      height: CARD_HEIGHT,
                      // The percentage is the width of the card, so one lane is one card plus one gap.
                      transform: `translate(calc(${v.lane} * (100% + ${CARD_GAP}px)), ${v.start}px)`,
                    }}
                  >
                    {item ? (
                      <JobRow
                        item={item}
                        index={v.index}
                        active={v.index === cursor}
                        open={item.id === search.id}
                        selected={selection.has(item.id)}
                        onOpen={onOpenRow}
                        onToggleSelect={toggleSelect}
                        onFocusRow={onFocusRow}
                        onSwipe={onSwipe}
                        swipeLeaves={swipeLeaves}
                      />
                    ) : (
                      <div role="listitem" className="flex h-full items-center justify-center text-[13px] text-muted">
                        {list.isFetchingNextPage ? (
                          <Spinner small label="Loading more" />
                        ) : list.isFetchNextPageError ? (
                          <Button size="sm" onClick={() => void list.fetchNextPage()}>
                            Loading failed. Try again
                          </Button>
                        ) : (
                          ''
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {phone && selection.size > 0 && (
          <BulkBar onTriage={(action) => doTriage([...selection], action)} onOther={(action) => bulkOther.mutate({ ids: [...selection], action })} />
        )}
      </div>

      {search.id && (
        <aside
          aria-label="Posting details"
          className="fixed inset-0 z-30 flex flex-col bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:static lg:z-auto lg:p-0 lg:min-w-0 lg:flex-1 lg:border-l lg:border-fg"
        >
          <DetailPanel
            key={search.id}
            id={search.id}
            onClose={closeDetail}
            onTriage={doTriage}
            autoOpened={search.id === autoOpenedId}
            onTagClick={(tag) => update({ tag, id: undefined })}
            headingRef={headingRef}
          />
        </aside>
      )}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {removing && (
        <RemoveApplicationDialog
          item={removing}
          busy={removeApplication.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => removeApplication.mutate(removing.id, { onSettled: () => setRemoving(null) })}
        />
      )}
    </div>
  );
}

/** Names the applied and dismissed postings that the default list leaves out, or null when there are none. */
function hiddenByDefault({ applied, dismissed }: PostingCounts): string | null {
  if (applied === 0 && dismissed === 0) return null;
  const verb = applied + dismissed === 1 ? 'is' : 'are';
  if (dismissed === 0) return `${plural(applied, 'applied posting')} ${verb} hidden.`;
  if (applied === 0) return `${plural(dismissed, 'dismissed posting')} ${verb} hidden.`;
  return `${applied} applied and ${dismissed} dismissed postings are hidden.`;
}
