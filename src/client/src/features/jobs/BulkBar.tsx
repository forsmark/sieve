import { useRef } from 'react';
import type { BulkAction, TriageAction } from '../../../../shared/api';
import { Button, Select } from '../../components/ui';
import { useBottomBar } from '../../lib/useBottomBar';

type OtherAction = Exclude<BulkAction, TriageAction>;

/** The actions of the "More" menu, in its order. Restore is a triage action, the others are not. */
export const MORE_ACTIONS: Array<{ value: 'restore' | OtherAction; label: string }> = [
  { value: 'restore', label: 'Restore' },
  { value: 'rescore', label: 'Rescore' },
  { value: 'analyze', label: 'Analyze' },
  { value: 'read', label: 'Mark read' },
  { value: 'unread', label: 'Mark unread' },
];

/**
 * The bulk actions below 640px: a bar at the bottom of the list column with Save, Dismiss and Applied,
 * and a "More" menu for the rest. The menu runs the chosen action and then shows its label again.
 * While it is mounted, the toasts stand above it.
 */
export function BulkBar({ onTriage, onOther }: { onTriage: (action: TriageAction) => void; onOther: (action: OtherAction) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useBottomBar(ref);
  return (
    <div ref={ref} role="toolbar" aria-label="Bulk actions" className="flex shrink-0 gap-2 border-t border-fg bg-bg px-3 py-2">
      <Button className="h-11 min-w-0 flex-1 px-2" onClick={() => onTriage('save')}>
        Save
      </Button>
      <Button className="h-11 min-w-0 flex-1 px-2" onClick={() => onTriage('dismiss')}>
        Dismiss
      </Button>
      <Button className="h-11 min-w-0 flex-1 px-2" onClick={() => onTriage('apply')}>
        Applied
      </Button>
      <label className="sr-only" htmlFor="bulk-more">
        More bulk actions
      </label>
      <Select
        id="bulk-more"
        className="h-11 w-auto min-w-0 flex-1 font-semibold"
        value=""
        onChange={(e) => {
          const action = e.target.value as (typeof MORE_ACTIONS)[number]['value'] | '';
          if (action === 'restore') onTriage('restore');
          else if (action) onOther(action);
        }}
      >
        <option value="" disabled>
          More
        </option>
        {MORE_ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
