import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui';

export const SHORTCUTS: Array<[string, string]> = [
  ['j', 'Next posting'],
  ['k', 'Previous posting'],
  ['Arrow keys', 'Move between cards in the grid'],
  ['Enter', 'Open the posting'],
  ['s', 'Save'],
  ['d', 'Dismiss'],
  ['r', 'Restore to new'],
  ['a', 'Mark as applied'],
  ['o', 'Open the source link in a new tab'],
  ['u', 'Undo the last action'],
  ['x', 'Select or unselect the posting'],
  ['/', 'Search'],
  ['?', 'Show or hide this help'],
  ['Escape', 'Close the detail, the help, or the selection'],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
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
      aria-labelledby="shortcut-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] border border-fg bg-bg p-0 text-fg backdrop:bg-ink/70"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="shortcut-title" className="font-semibold">
          Keyboard shortcuts
        </h2>
        <Button size="sm" variant="ghost" onClick={onClose} autoFocus>
          Close
        </Button>
      </div>
      <p className="px-4 pt-3 text-[13px] text-muted">Triage keys act on the selected postings, or on the current posting when nothing is selected.</p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-[13px]">
        {SHORTCUTS.map(([key, label]) => (
          <div key={key} className="contents">
            <dt>
              <kbd className="border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">{key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
