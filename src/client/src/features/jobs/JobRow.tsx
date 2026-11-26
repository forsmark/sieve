import { memo, useId } from 'react';
import type { PostingListItem } from '../../../../shared/api';
import { scoreBand } from '../../../../shared/schemas';
import { VERDICT_LABEL } from './MatchAnalysis';
import { Badge, MatchCell, cx } from '../../components/ui';
import { capitalize, shortAge, sourceName } from '../../lib/format';
import { SWIPE_ACTIONS, SWIPE_LABEL, type SwipeAction } from './swipe';
import { useSwipe, type SwipeDirection } from './useSwipe';

/** Every card has the same height, so the grid can be virtualized in lanes. */
export const CARD_HEIGHT = 184;
/** The channel of ground between cards, the same as in the detail mosaic. */
export const CARD_GAP = 6;
/** A card is never narrower than this. The number of columns follows from the list width. */
export const CARD_MIN_WIDTH = 270;

/** The page grid never has more columns than this. */
export const MAX_COLUMNS = 6;

/** How many card columns stay visible beside the open detail panel. The panel covers the other columns. */
export function listColumnsBesidePanel(pageColumns: number): number {
  if (pageColumns >= 5) return 3;
  if (pageColumns >= 4) return 2;
  return 1;
}

const WORK_LABEL = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site' } as const;

/** The look of the uncovered space once a release takes the action. */
const ARMED_LOOK: Record<SwipeAction, string> = {
  save: 'bg-field-yellow text-ink',
  apply: 'bg-field-pink text-ink',
  dismiss: 'text-fg shadow-[inset_0_0_0_1px_var(--border-strong)]',
  restore: 'text-fg shadow-[inset_0_0_0_1px_var(--border-strong)]',
  'remove-application': 'text-danger shadow-[inset_0_0_0_1px_var(--danger)]',
};

/** The space that a moving card uncovers. It names the action on the side the card leaves. */
function SwipeLayer({ action, direction, armed }: { action: SwipeAction; direction: SwipeDirection; armed: boolean }) {
  return (
    <div
      aria-hidden
      data-swipe-action={action}
      data-armed={armed ? 'true' : 'false'}
      className={cx(
        'absolute inset-0 flex items-center bg-bg px-4 text-[15px] leading-tight',
        direction === 'right' ? 'justify-start' : 'justify-end text-right',
        armed ? cx('font-bold', ARMED_LOOK[action]) : 'font-medium text-muted',
      )}
    >
      <span className="max-w-24">{SWIPE_LABEL[action]}</span>
    </div>
  );
}

/** One posting as a card in the jobs grid. */
export const JobRow = memo(function JobRow({
  item,
  index,
  active,
  open,
  selected,
  onOpen,
  onToggleSelect,
  onFocusRow,
  onSwipe,
  swipeLeaves,
}: {
  item: PostingListItem;
  index: number;
  active: boolean;
  open: boolean;
  selected: boolean;
  onOpen: (id: string, index: number) => void;
  onToggleSelect: (id: string) => void;
  onFocusRow: (index: number) => void;
  /** Takes the action of a swipe. Without it the card does not swipe. */
  onSwipe?: (item: PostingListItem, action: SwipeAction) => void;
  /** True when the posting leaves the list after this action, so the card slides out. */
  swipeLeaves?: (action: SwipeAction) => boolean;
}) {
  const work = item.workArrangement ? WORK_LABEL[item.workArrangement] : null;
  // A location that only repeats the work arrangement is not shown twice.
  const location = item.location && work && item.location.trim().toLowerCase() === work.toLowerCase() ? null : item.location;
  const meta = [item.company, location, work].filter(Boolean).join(' · ');
  const age = shortAge(item.postedAt ?? item.firstSeenAt);
  const m = item.match;
  const state = m?.state ?? 'waiting';
  const score = m?.totalScore ?? null;
  const hasScore = score !== null && (state === 'scored' || state === 'in_progress' || state === 'excluded');
  const { band, label } = scoreBand(score);
  const actions = SWIPE_ACTIONS[item.triageStatus];
  const swipe = useSwipe<HTMLDivElement>({
    allowed: { left: !!onSwipe && actions.left !== null, right: !!onSwipe && actions.right !== null },
    leaves: (d) => {
      const action = actions[d];
      return action !== null && !!swipeLeaves?.(action);
    },
    onSwipe: (d) => {
      const action = actions[d];
      if (action) onSwipe?.(item, action);
    },
  });
  // The card's name starts with the title, then the company, the score and its band. The foot describes it.
  const uid = useId();
  const titleId = `${uid}-title`;
  const metaId = `${uid}-meta`;
  const scoreId = `${uid}-score`;
  const bandId = `${uid}-band`;
  const flagsId = `${uid}-flags`;
  const unreadId = `${uid}-unread`;
  const footId = `${uid}-foot`;
  const excludedId = `${uid}-excluded`;
  const swipeDirection = swipe.state.direction;
  const swipeAction = swipeDirection ? actions[swipeDirection] : null;
  return (
    <div role="listitem" data-index={index} aria-current={active ? 'true' : undefined} className="relative h-full overflow-hidden">
      {swipeDirection && swipeAction && <SwipeLayer action={swipeAction} direction={swipeDirection} armed={swipe.state.armed} />}
      <div
        ref={swipe.cardRef}
        {...swipe.handlers}
        // The browser keeps vertical scrolling and zoom. Sideways moves go to the swipe.
        style={{ touchAction: 'pan-y pinch-zoom' }}
        className={cx(
          'group relative flex h-full flex-col',
          'bg-surface-2',
          open ? 'field' : 'hover:bg-surface-3',
          active && !open && 'outline-2 -outline-offset-2 outline-fg',
          selected && !open && 'outline-2 -outline-offset-2 outline-accent',
        )}
      >
        {/* The yellow fills the card from the top when the posting opens, the same motion as the detail tiles. */}
        {open && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-field-yellow"
            style={{ animation: 'tile-in 420ms cubic-bezier(0.16, 1, 0.3, 1) backwards' }}
          />
        )}
        <label className="absolute top-0 right-0 z-10 flex size-10 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="size-4"
            checked={selected}
            onChange={() => onToggleSelect(item.id)}
            aria-label={`Select ${item.title}`}
            tabIndex={-1}
          />
        </label>
        <button
          type="button"
          id={`row-${item.id}`}
          data-row-button={index}
          onClick={() => onOpen(item.id, index)}
          onFocus={() => onFocusRow(index)}
          aria-labelledby={[titleId, metaId, scoreId, hasScore && bandId, item.unread && unreadId].filter(Boolean).join(' ')}
          aria-describedby={[hasScore && flagsId, state === 'excluded' && m?.excludedReason && excludedId, footId].filter(Boolean).join(' ')}
          className="relative flex min-h-0 flex-1 flex-col p-3.5 text-left focus-visible:outline-offset-[-2px]"
        >
          <span className="flex h-11 items-start gap-2.5 pr-8">
            {hasScore ? (
              <>
                <span
                  id={scoreId}
                  className={cx(
                    'tabular flex h-11 min-w-14 items-center justify-center px-1.5 text-[2rem] leading-none font-extrabold tracking-tight',
                    open && 'bg-ink text-field-yellow',
                    !open && band === 'high' && 'bg-field-yellow text-ink',
                    !open && band === 'medium' && 'text-field-yellow shadow-[inset_0_0_0_1px_var(--field-yellow)]',
                    !open && band === 'low' && 'text-fg shadow-[inset_0_0_0_1px_var(--border-strong)]',
                    !open && band === 'none' && 'text-faint shadow-[inset_0_0_0_1px_var(--border)]',
                  )}
                >
                  {score}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                  <span id={bandId} className="text-xs leading-none text-muted">
                    {label}
                  </span>
                  {/* The score as a bar, so the band reads without the numeral. */}
                  <span aria-hidden className={cx('block h-1 w-full max-w-28', open ? 'bg-ink/20' : 'bg-bg')}>
                    <span className={cx('block h-full', open ? 'bg-ink' : 'bg-field-yellow')} style={{ width: `${score}%` }} />
                  </span>
                  <span id={flagsId} className="flex gap-1">
                    {m?.stale && (
                      <Badge tone="warn" title="This score comes from an older profile or preferences">
                        Stale
                      </Badge>
                    )}
                    {state === 'in_progress' && <Badge tone="accent">Rescoring</Badge>}
                    {state === 'excluded' && <Badge tone="danger">Excluded</Badge>}
                  </span>
                </span>
              </>
            ) : (
              <span id={scoreId} className="flex h-11 items-center">
                <MatchCell match={m} compact />
              </span>
            )}
          </span>

          <span className="mt-3 flex items-start gap-1.5">
            {item.unread && (
              <>
                <span aria-hidden className={cx('mt-[7px] inline-block size-2 shrink-0', open ? 'bg-ink' : 'bg-fg')} />
                <span id={unreadId} className="sr-only">
                  Unread.
                </span>
              </>
            )}
            <span id={titleId} className={cx('line-clamp-2 text-[15px] leading-snug', item.unread || open ? 'font-bold' : 'font-medium text-muted')}>
              {item.title}
            </span>
          </span>
          <span id={metaId} className="mt-1 block truncate text-[13px] text-muted">
            {meta}
          </span>
          {state === 'excluded' && m?.excludedReason && (
            <span id={excludedId} className="mt-0.5 block truncate text-xs text-danger">
              Excluded: {m.excludedReason}
            </span>
          )}

          <span id={footId} className="mt-auto flex items-center gap-1.5 pt-2 text-[13px] text-faint">
            {item.triageStatus !== 'new' && (
              <Badge tone={item.triageStatus === 'applied' ? 'ok' : item.triageStatus === 'saved' ? 'accent' : 'neutral'}>
                {capitalize(item.triageStatus)}
                {item.triageOrigin === 'auto' ? ' (auto)' : ''}
              </Badge>
            )}
            {item.analysis?.state === 'pending' && <Badge>Analyzing</Badge>}
            {item.analysis?.state === 'ready' && item.analysis.verdict && (
              <Badge title="The verdict of the expanded analysis">Analysis: {VERDICT_LABEL[item.analysis.verdict]}</Badge>
            )}
            {item.linkStatus === 'expired' && <Badge tone="warn">Expired</Badge>}
            {item.duplicateOf && <Badge>Duplicate</Badge>}
            <span className="ml-auto truncate">{item.sources.map(sourceName).join(', ')}</span>
            {age && (
              <span className="tabular shrink-0" title={item.postedAt ? `Posted ${item.postedAt}` : `First seen ${item.firstSeenAt}`}>
                · {age}
              </span>
            )}
          </span>
        </button>
      </div>
    </div>
  );
});
