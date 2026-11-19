import { useId, useState, type Ref, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { scoreBand } from '../../../shared/schemas';
import type { MatchSummary } from '../../../shared/api';
import { twMerge } from 'tailwind-merge';
import { errorText } from '../api/client';

export function cx(...parts: Array<string | false | null | undefined>): string {
  // A class passed by the caller wins over the base class of a shared component.
  return twMerge(parts.filter(Boolean).join(' '));
}

// ---- Buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-4 text-sm',
        variant === 'primary' && 'border-accent bg-accent text-on-accent hover:bg-accent-strong',
        variant === 'secondary' && 'border-line-strong bg-transparent text-fg hover:border-fg hover:bg-surface-2',
        variant === 'ghost' && 'border-transparent bg-transparent text-fg hover:bg-surface-2',
        variant === 'danger' && 'border-danger bg-transparent text-danger hover:bg-danger-soft',
        className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

/** A button that asks for a second click before it runs a destructive action. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  busy,
  size = 'md',
  variant = 'danger',
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  size?: 'sm' | 'md';
  variant?: Variant;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button size={size} variant={variant === 'danger' ? 'secondary' : variant} onClick={() => setAsking(true)} busy={busy}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Confirm action">
      <Button
        size={size}
        variant={variant}
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

// ---- Form controls

const inputClass =
  'w-full border border-line-strong bg-transparent px-2.5 py-1.5 text-sm text-fg placeholder:text-faint hover:border-fg focus-visible:border-accent disabled:opacity-60';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input {...props} className={cx(inputClass, 'h-9', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, 'min-h-20', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, 'h-9 bg-surface pr-7', props.className)} />;
}

/** Label above a control. The child receives the generated id. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center border transition-colors disabled:opacity-50',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-transparent',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'inline-block size-3.5 transition-transform',
            checked ? 'translate-x-[18px] bg-on-accent' : 'translate-x-[2px] bg-muted',
          )}
        />
      </button>
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
          <span className="sr-only">{checked ? ' (on)' : ' (off)'}</span>
        </label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
    </div>
  );
}

/** Two options as a segmented control, built on radio inputs. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-[13px] font-medium">{label}</legend>
      <div className="inline-flex w-fit border border-line-strong">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'relative cursor-pointer border-r border-line-strong px-3 py-1.5 text-[13px] last:border-r-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              value === o.value ? 'bg-accent font-semibold text-on-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Editor for a list of short strings, entered as comma-separated text. */
export function ListInput({
  value,
  onChange,
  id,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  id?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value.join(', '));
  const [synced, setSynced] = useState(value);
  if (synced !== value && value.join(', ') !== splitList(text).join(', ')) {
    setSynced(value);
    setText(value.join(', '));
  }
  return (
    <TextInput
      id={id}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const next = splitList(e.target.value);
        setSynced(next);
        onChange(next);
      }}
    />
  );
}

export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- Display

export function Spinner({ small, label }: { small?: boolean; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={cx('inline-block animate-spin border-2 border-current border-r-transparent opacity-70', small ? 'size-3' : 'size-4')}
      />
      {label && <span className="text-muted">{label}</span>}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger' | 'warn' | 'ok'; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center border px-1.5 py-px text-[11px] font-semibold leading-4',
        tone === 'neutral' && 'border-line-strong text-muted',
        tone === 'accent' && 'border-fg text-fg',
        tone === 'danger' && 'border-danger text-danger',
        tone === 'warn' && 'border-line-strong border-dashed text-fg',
        tone === 'ok' && 'border-fg text-fg',
      )}
    >
      {children}
    </span>
  );
}

const BAND_CLASS = {
  high: 'bg-field-yellow text-ink',
  medium: 'text-field-yellow shadow-[inset_0_0_0_1px_var(--field-yellow)]',
  low: 'text-fg shadow-[inset_0_0_0_1px_var(--border-strong)]',
  none: 'text-faint shadow-[inset_0_0_0_1px_var(--border)]',
} as const;

/**
 * A score numeral with its band label. The band shows as fill and outline as well as text:
 * a strong match is a filled yellow block, a good match is a yellow outline, and lower bands lose the yellow.
 */
export function ScoreBadge({ score, size = 'md', showLabel = true }: { score: number | null; size?: 'md' | 'lg'; showLabel?: boolean }) {
  const { band, label } = scoreBand(score);
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span
        className={cx(
          'tabular inline-flex items-center justify-center font-bold leading-none',
          size === 'lg' ? 'h-12 min-w-14 px-2 text-3xl' : 'h-9 min-w-10 px-1 text-lg',
          BAND_CLASS[band],
        )}
      >
        {score ?? '–'}
      </span>
      {showLabel ? <span className="text-xs text-muted">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

/** The score cell of a posting: a number with band, or the match state in words. */
export function MatchCell({ match, compact }: { match: MatchSummary | null; compact?: boolean }) {
  const state = match?.state ?? 'waiting';
  if (state === 'scored' || ((state === 'in_progress' || state === 'excluded') && match?.totalScore != null)) {
    return (
      <span className="flex flex-col items-start gap-0.5">
        <ScoreBadge score={match?.totalScore ?? null} showLabel={!compact} />
        <span className="flex gap-1">
          {match?.stale && <Badge tone="warn" title="This score comes from an older profile or preferences">Stale</Badge>}
          {state === 'in_progress' && <Badge tone="accent">Rescoring</Badge>}
          {state === 'excluded' && <Badge tone="danger">Excluded</Badge>}
        </span>
      </span>
    );
  }
  const text: Record<string, { label: string; tone: 'neutral' | 'accent' | 'danger' }> = {
    waiting: { label: 'Waiting', tone: 'neutral' },
    in_progress: { label: 'Scoring', tone: 'accent' },
    failed: { label: 'Failed', tone: 'danger' },
    excluded: { label: 'Excluded', tone: 'danger' },
  };
  const t = text[state] ?? text.waiting!;
  return (
    <span className="flex items-center gap-1.5">
      {state === 'in_progress' && <Spinner small />}
      <Badge tone={t.tone}>{t.label}</Badge>
    </span>
  );
}

// ---- States

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center p-8 text-sm">
      <Spinner label={label} />
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'This could not be loaded.' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="m-4 border border-danger bg-danger-soft p-4 text-sm">
      <p className="font-medium text-danger">{title}</p>
      <p className="mt-1 text-fg">{errorText(error)}</p>
      {onRetry && (
        <Button className="mt-3" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Section({ title, description, children, actions, id }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="border-t border-fg">
      <header className="flex flex-wrap items-start justify-between gap-2 pt-3 pb-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-bold">
            {title}
          </h2>
          {description && <p className="mt-1 max-w-[65ch] text-[13px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="pb-10">{children}</div>
    </section>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

// ---- Icons

const ICON_PATHS = {
  'arrow-left': 'M13 8H3M7 4 3 8l4 4',
  'arrow-up-right': 'M5 11 11 5M6 5h5v5',
  close: 'M4 4l8 8M12 4l-8 8',
} as const;

/** Drawn icons in one stroke weight. Each one is decorative, so its control needs a text label. */
export function Icon({ name, className }: { name: keyof typeof ICON_PATHS; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={cx('inline-block size-3.5 shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
