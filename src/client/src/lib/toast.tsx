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
}

export function showToast(t: Omit<Toast, 'id'>, durationMs = t.action ? 8000 : 4000): number {
  const id = nextId++;
  toastStore.set((list) => [...list.slice(-3), { ...t, id }]);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), durationMs),
  );
  return id;
}

export function toastError(message: string): number {
  return showToast({ message, tone: 'error' }, 7000);
}

// ---- Undo: the latest undoable action, also reachable through the "u" shortcut.

interface UndoEntry {
  toastId: number;
  run: () => Promise<void>;
}
let lastUndo: UndoEntry | null = null;

/** Shows a toast with an Undo button. The undo runs at most once. */
export function showUndoToast(message: string, undo: () => Promise<void>): void {
  let done = false;
  const run = async () => {
    if (done) return;
    done = true;
    dismissToast(entry.toastId);
    if (lastUndo === entry) lastUndo = null;
    await undo();
  };
  const entry: UndoEntry = { toastId: 0, run };
  entry.toastId = showToast({ message, tone: 'info', action: { label: 'Undo', run } });
  lastUndo = entry;
}

/** Runs the latest undo. Returns false when nothing can be undone. */
export async function undoLast(): Promise<boolean> {
  const entry = lastUndo;
  if (!entry) return false;
  lastUndo = null;
  await entry.run();
  return true;
}

export function resetToastsForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  toastStore.set([]);
  lastUndo = null;
}

export function Toaster() {
  const toasts = useStore(toastStore);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-full z-50 mb-3 flex flex-col items-center gap-2 px-4 sm:mb-5 sm:items-end"
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
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 px-4 py-2.5 font-medium ${
              t.tone === 'error' ? 'border border-danger bg-danger-soft text-fg' : 'field bg-field-yellow'
            }`}
          >
            {t.tone === 'error' && <span className="font-medium text-danger">Error:</span>}
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button type="button" className="px-2 py-1 font-bold underline decoration-2 hover:bg-surface-2" onClick={() => void t.action!.run()}>
                {t.action.label}
              </button>
            )}
            <button type="button" className="flex px-1.5 py-1.5 hover:bg-surface-2" aria-label="Close message" onClick={() => dismissToast(t.id)}>
              <Icon name="close" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
