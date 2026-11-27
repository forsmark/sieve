import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '../components/ui';
import { createStore, useStore } from './store';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void | Promise<void> };
}

const toastStore = createStore<Toast[]>([]);
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function dismissToast(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  toastStore.set((list) => list.filter((x) => x.id !== id));
  // The latest undo of each kind stays reachable without its toast. An older one goes with its toast.
  for (const [entryId, r] of undoRuns) {
    if (r.toastId !== id) continue;
    const last = Object.values(undoStore.get()).find((e) => e?.id === entryId);
    if (!last) undoRuns.delete(entryId);
    else if (last.toastShown) undoStore.set((slots) => ({ ...slots, [last.kind]: { ...last, toastShown: false } }));
  }
}

export function showToast(t: Omit<Toast, 'id'>, durationMs = t.action ? 8000 : 4000): number {
  const id = nextId++;
  // At most four toasts show. The oldest closes for a new one.
  for (const old of toastStore.get().slice(0, -3)) dismissToast(old.id);
  toastStore.set((list) => [...list, { ...t, id }]);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), durationMs),
  );
  return id;
}

export function toastError(message: string): number {
  return showToast({ message, tone: 'error' }, 7000);
}

// ---- Undo: the latest undoable action of each kind. The latest triage is also reachable through the "u" shortcut
// and the undo control of the job list. A stage move on the board neither replaces it nor runs in its place.

export type UndoKind = 'triage' | 'stage';

/** The latest undoable action of a kind, as the interface sees it. */
export interface UndoEntry {
  /** Unique for each action, and larger for a newer action. */
  id: number;
  kind: UndoKind;
  /** The text of its toast, for example `Dismissed “Mobile Developer”.` */
  message: string;
  /** False once its toast has closed, by its timer or by the user. */
  toastShown: boolean;
  /** For a triage that moved the detail view on: the posting the detail view showed. */
  returnTo?: string;
}

export interface UndoToast {
  kind: UndoKind;
  message: string;
  /** Reverts the action. On failure it reports the error itself and then throws, so the undo counts as not done. */
  undo: () => Promise<void>;
  returnTo?: string;
}

type UndoSlots = Record<UndoKind, UndoEntry | null>;

const NO_UNDO: UndoSlots = { triage: null, stage: null };
const undoStore = createStore<UndoSlots>(NO_UNDO);
/** The toast id and the run function of each entry that can still run. */
const undoRuns = new Map<number, { toastId: number; run: () => Promise<boolean> }>();
const undoneListeners = new Set<(entry: UndoEntry) => void>();
let nextUndoId = 1;

function setSlot(kind: UndoKind, entry: UndoEntry | null): void {
  undoStore.set((slots) => ({ ...slots, [kind]: entry }));
}

/** The latest entry of `kind`, or without a kind the newest entry of any kind. */
function latestOf(slots: UndoSlots, kind?: UndoKind): UndoEntry | null {
  if (kind) return slots[kind];
  return Object.values(slots).reduce<UndoEntry | null>((best, e) => (e && (!best || e.id > best.id) ? e : best), null);
}

/**
 * Shows a toast with an Undo button and makes the action the latest undo of its kind, in place of the one before.
 * The undo runs at most once, from the toast, `undoLast()` or the undo control. An undo that fails counts as not
 * done: it stays the latest undo of its kind, unless a newer action of that kind took its place meanwhile.
 */
export function showUndoToast({ kind, message, undo, returnTo }: UndoToast): UndoEntry {
  const entry: UndoEntry = { id: nextUndoId++, kind, message, toastShown: true, ...(returnTo !== undefined && { returnTo }) };
  let done = false;
  const run = async (): Promise<boolean> => {
    if (done) return false;
    done = true;
    const own = undoRuns.get(entry.id);
    undoRuns.delete(entry.id);
    if (own) dismissToast(own.toastId);
    const wasLatest = undoStore.get()[kind]?.id === entry.id;
    if (wasLatest) setSlot(kind, null);
    try {
      await undo();
    } catch {
      // Its toast has closed, so the entry comes back as reachable without it, from the `u` key and the undo control.
      if (wasLatest && undoStore.get()[kind] === null) {
        done = false;
        undoRuns.set(entry.id, { toastId: own?.toastId ?? -1, run });
        setSlot(kind, { ...entry, toastShown: false });
      }
      return true;
    }
    for (const fn of undoneListeners) fn(entry);
    return true;
  };
  const toastId = showToast({ message, tone: 'info', action: { label: 'Undo', run: () => void run() } });
  const before = undoStore.get()[kind];
  if (before && !before.toastShown) undoRuns.delete(before.id);
  undoRuns.set(entry.id, { toastId, run });
  setSlot(kind, entry);
  return entry;
}

/** The latest undoable action of `kind`, or without a kind the newest of any kind. Null when nothing can be undone. */
export function getLastUndo(kind?: UndoKind): UndoEntry | null {
  return latestOf(undoStore.get(), kind);
}

/** The latest undoable action of `kind` (or of any kind), or null. The component renders again when it changes. */
export function useLastUndo(kind?: UndoKind): UndoEntry | null {
  return latestOf(useStore(undoStore), kind);
}

/** Runs the latest undo of `kind`, or without a kind the newest of any kind. Returns false when nothing can be undone. */
export async function undoLast(kind?: UndoKind): Promise<boolean> {
  const entry = getLastUndo(kind);
  if (!entry) return false;
  const own = undoRuns.get(entry.id);
  if (!own) return false;
  return own.run();
}

/**
 * Calls `listener` after an undo has reverted its action, from any of its three places.
 * Not called when the undo failed. Returns the function that stops it.
 */
export function onUndone(listener: (entry: UndoEntry) => void): () => void {
  undoneListeners.add(listener);
  return () => undoneListeners.delete(listener);
}

export function resetToastsForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  toastStore.set([]);
  undoStore.set(NO_UNDO);
  undoRuns.clear();
  undoneListeners.clear();
}

export function Toaster() {
  const toasts = useStore(toastStore);
  return (
    <div
      data-toaster
      // `--bottom-bar` is the height of a bar at the bottom edge, such as the detail action bar. The toasts stand above it.
      className="pointer-events-none absolute inset-x-0 bottom-full z-50 mb-[calc(0.75rem+var(--bottom-bar,0px))] flex flex-col items-center gap-2 px-4 sm:mb-[calc(1.25rem+var(--bottom-bar,0px))] sm:items-end"
      aria-live="polite"
      aria-relevant="additions"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16 }}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 py-1 pr-1 pl-4 font-medium ${
              t.tone === 'error' ? 'border border-danger bg-danger-soft text-fg' : 'field bg-field-yellow'
            }`}
          >
            {t.tone === 'error' && <span className="font-medium text-danger">Error:</span>}
            <span className="min-w-0 flex-1">{t.message}</span>
            {/* Both buttons take a finger: 44px high, the action at least 64px wide, 16px apart. */}
            <span className="flex shrink-0 items-center gap-4">
              {t.action && (
                <button type="button" className="h-11 min-w-16 px-3 font-bold underline decoration-2 hover:bg-surface-2" onClick={() => void t.action!.run()}>
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                className="flex size-11 items-center justify-center hover:bg-surface-2"
                aria-label="Close message"
                onClick={() => dismissToast(t.id)}
              >
                <Icon name="close" />
              </button>
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
