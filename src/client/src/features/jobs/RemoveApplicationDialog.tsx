import { useEffect, useRef } from 'react';
import type { PostingListItem } from '../../../../shared/api';
import { Button } from '../../components/ui';

/** Asks before a swipe removes an application. The removal deletes the notes and the history, and has no undo. */
export function RemoveApplicationDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: PostingListItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    // The safe choice has the focus, so Enter does not remove the application.
    d?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="remove-application-title"
      aria-describedby="remove-application-text"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // A click on the backdrop lands on the dialog itself and cancels.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] border border-fg bg-bg p-0 text-fg backdrop:bg-ink/70"
    >
      <div className="px-4 pt-4 pb-3">
        <h2 id="remove-application-title" className="font-semibold">
          Remove the application?
        </h2>
        <p id="remove-application-text" className="mt-2 text-[13px] text-muted">
          “{item.title}” at {item.company} goes back to saved. Its notes, stage history and interview date are deleted, and this can’t be undone.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        <Button data-autofocus variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} busy={busy}>
          Remove application
        </Button>
      </div>
    </dialog>
  );
}
