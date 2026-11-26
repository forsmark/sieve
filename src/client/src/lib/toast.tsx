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
  // The latest undo stays reachable without its toast. An older one goes with its toast.
  const last = undoStore.get();
  for (const [entryId, r] of undoRuns) {
    if (r.toastId !== id) continue;
    if (entryId !== last?.id) undoRuns.delete(entryId);
    else if (last.toastShown) undoStore.set({ ...last, toastShown: false });
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

// ---- Undo: the latest undoable action, also reachable through the "u" shortcut and the undo control of the job list.

export type UndoKind = 'triage' | 'stage';

/** The latest undoable action, as the interface sees it. */
export interface UndoEntry {
  /** Unique for each action. */
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

const undoStore = createStore<UndoEntry | null>(null);
/** The toast id and the run function of each entry that can still run. */
const undoRuns = new Map<number, { toastId: number; run: () => Promise<boolean> }>();
const undoneListeners = new Set<(entry: UndoEntry) => void>();
let nextUndoId = 1;

/**
 * Shows a toast with an Undo button and makes the action the latest undo, in place of the one before.
 * The undo runs at most once, from the toast, `undoLast()` or the undo control.
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
    if (undoStore.get()?.id === entry.id) undoStore.set(null);
    try {
      await undo();
    } catch {
      return true;
    }
    for (const fn of undoneListeners) fn(entry);
    return true;
  };
  const toastId = showToast({ message, tone: 'info', action: { label: 'Undo', run: () => void run() } });
  const before = undoStore.get();
  if (before && !before.toastShown) undoRuns.delete(before.id);
  undoRuns.set(entry.id, { toastId, run });
  undoStore.set(entry);
  return entry;
}

/** The latest undoable action, or null when nothing can be undone. */
export function getLastUndo(): UndoEntry | null {
  return undoStore.get();
}

/** The latest undoable action, or null. The component renders again when it changes. */
export function useLastUndo(): UndoEntry | null {
  return useStore(undoStore);
}

/** Runs the latest undo. Returns false when nothing can be undone. */
export async function undoLast(): Promise<boolean> {
  const entry = undoStore.get();
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
  undoStore.set(null);
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
