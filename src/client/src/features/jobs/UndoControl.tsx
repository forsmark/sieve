import { Button } from '../../components/ui';
import { undoLast, useLastUndo } from '../../lib/toast';

/**
 * The undo of the latest triage action, after its message has closed. It runs the same entry as the `u` key.
 * The message is truncated on screen; the accessible name holds all of it.
 */
export function UndoControl() {
  const last = useLastUndo('triage');
  if (!last || last.toastShown) return null;
  const name = `Undo · ${last.message}`;
  return (
    <Button size="sm" variant="ghost" className="min-w-0 shrink justify-start" title={name} onClick={() => void undoLast('triage')} aria-keyshortcuts="u">
      <span className="truncate">
        <span className="font-bold underline decoration-accent decoration-2">Undo</span> · {last.message}
      </span>
    </Button>
  );
}
