import { Link } from '@tanstack/react-router';
import type { StatusDto } from '../../../shared/api';

/** Shown until a CV and at least one search term exist. */
export function FirstRunGuide({ status }: { status: StatusDto }) {
  if (status.hasCv && status.searchTermCount > 0) return null;
  const steps = [
    { done: status.hasCv, label: 'Add your CV', to: '/profile' as const, hint: 'The system reads it and builds your profile.' },
    { done: status.searchTermCount > 0, label: 'Add search terms', to: '/settings' as const, hint: 'The sources search for these terms.' },
  ];
  return (
    <aside aria-label="Getting started" className="field shrink-0 bg-field-yellow px-4 py-2 text-[13px] sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">Getting started</span>
        <ol className="flex flex-wrap gap-x-4 gap-y-1">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className="tabular text-muted">{i + 1}.</span>
              {s.done ? (
                <span className="text-muted line-through">
                  {s.label}
                  <span className="sr-only"> (done)</span>
                </span>
              ) : (
                <Link to={s.to} className="font-bold underline decoration-2" title={s.hint}>
                  {s.label}
                </Link>
              )}
              {s.done && <span className="text-xs text-muted">Done</span>}
            </li>
          ))}
          <li className="flex items-center gap-1.5 text-muted">
            <span className="tabular">3.</span> Fetch jobs with the button in the status bar
          </li>
        </ol>
      </div>
    </aside>
  );
}
