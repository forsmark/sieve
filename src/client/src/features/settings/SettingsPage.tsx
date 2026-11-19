import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HealthDto, LlmSettingsDto, NotificationSettingsDto, ScheduleDto, SourceDto } from '../../../../shared/api';
import { api, type LlmSaveInput, type SearchSettings } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { Badge, Button, ConfirmButton, ErrorState, Field, LoadingState, PageHeader, Section, Segmented, Switch, TextInput, Icon } from '../../components/ui';
import { bytes, dateTime, relativeTime } from '../../lib/format';
import { showToast, toastError } from '../../lib/toast';

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-4 p-3 sm:p-6">
        <PageHeader title="Settings" />
        <nav aria-label="Settings sections" className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
          {[
            ['search', 'Search'],
            ['sources', 'Sources'],
            ['schedule', 'Schedule'],
            ['model', 'Language model'],
            ['notifications', 'Notifications'],
            ['backups', 'Backups'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="font-medium text-muted underline decoration-line-strong hover:text-fg hover:decoration-fg">
              {label}
            </a>
          ))}
        </nav>
        <SearchSection />
        <SourcesSection />
        <ScheduleSection />
        <LlmSection />
        <NotificationsSection />
        <BackupsSection />
      </div>
    </div>
  );
}

// ---- Search terms and region

function SearchSection() {
  const q = useQuery({ queryKey: qk.search, queryFn: api.search });
  return (
    <Section id="search" title="Search" description="The sources search for these terms. Up to 20 terms.">
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <SearchForm key={JSON.stringify(q.data)} initial={q.data} />}
    </Section>
  );
}

function SearchForm({ initial }: { initial: SearchSettings }) {
  const qc = useQueryClient();
  const [terms, setTerms] = useState(initial.terms);
  const [region, setRegion] = useState(initial.region);
  const [next, setNext] = useState('');
  const save = useMutation({
    mutationFn: () => api.saveSearch({ terms, region }),
    onSuccess: (s) => {
      qc.setQueryData(qk.search, s);
      void qc.invalidateQueries({ queryKey: qk.status });
      showToast({ message: 'Search saved. The next fetch uses it.', tone: 'info' });
    },
    onError: (e) => toastError(errorText(e)),
  });
  const add = () => {
    const t = next.trim();
    if (t && !terms.includes(t) && terms.length < 20) setTerms([...terms, t]);
    setNext('');
  };
  const dirty = JSON.stringify({ terms, region }) !== JSON.stringify(initial);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-[13px] font-medium">Search terms</p>
        {terms.length === 0 ? (
          <p className="text-[13px] text-muted">No search terms yet. Add at least one, for example a job title.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Search terms">
            {terms.map((t) => (
              <li key={t} className="flex items-center gap-1 border border-line bg-surface-2 py-0.5 pr-0.5 pl-2 text-[13px]">
                {t}
                <button
                  type="button"
                  className="px-1.5 text-muted hover:bg-surface hover:text-fg"
                  aria-label={`Remove ${t}`}
                  onClick={() => setTerms(terms.filter((x) => x !== t))}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label htmlFor="new-term" className="sr-only">
            New search term
          </label>
          <TextInput id="new-term" className="max-w-xs" placeholder="For example frontend developer" value={next} onChange={(e) => setNext(e.target.value)} maxLength={100} />
          <Button type="submit" disabled={!next.trim() || terms.length >= 20}>
            Add
          </Button>
        </form>
      </div>
      <Field label="Region" hint="Used by sources that support a region, such as a city or country." className="max-w-sm">
        {(id) => <TextInput id={id} value={region} onChange={(e) => setRegion(e.target.value)} maxLength={100} />}
      </Field>
      <div>
        <Button variant="primary" disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()}>
          Save search
        </Button>
      </div>
    </div>
  );
}

// ---- Sources

function SourcesSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.sources, queryFn: api.sources });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.setSourceEnabled(id, enabled),
    onMutate: ({ id, enabled }) => {
      const before = qc.getQueryData<SourceDto[]>(qk.sources);
      qc.setQueryData<SourceDto[]>(qk.sources, (l) => l?.map((s) => (s.id === id ? { ...s, enabled } : s)));
      return { before };
    },
    onSuccess: (list) => qc.setQueryData(qk.sources, list),
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(qk.sources, ctx.before);
      toastError(errorText(e));
    },
  });
  return (
    <Section id="sources" title="Sources" description="Job sites the system fetches from.">
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.length === 0 && <p className="text-[13px] text-muted">No sources exist.</p>}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y divide-line">
          {q.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <Switch
                label={s.name}
                checked={s.enabled}
                onChange={(v) => toggle.mutate({ id: s.id, enabled: v })}
                description={
                  [s.supports.keywords ? 'Uses search terms' : 'Ignores search terms', s.supports.region ? 'uses region' : 'ignores region'].join(', ') + '.'
                }
              />
              <div className="text-right text-xs text-muted">
                {s.lastResult ? (
                  <>
                    <p>
                      <Badge tone={s.lastResult.state === 'failed' ? 'danger' : s.lastResult.state === 'completed' ? 'ok' : 'neutral'}>
                        {s.lastResult.state === 'failed' ? 'Failed' : s.lastResult.state === 'completed' ? 'Completed' : s.lastResult.state === 'running' ? 'Running' : 'Skipped'}
                      </Badge>{' '}
                      {relativeTime(s.lastRunAt)}
                    </p>
                    <p className="tabular mt-0.5">
                      {s.lastResult.found} found, {s.lastResult.added} new, {s.lastResult.invalid} invalid
                    </p>
                    {s.lastResult.error && <p className="mt-0.5 max-w-xs text-danger">{s.lastResult.error}</p>}
                  </>
                ) : (
                  <p>Not run yet</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- Schedule

function ScheduleSection() {
  const q = useQuery({ queryKey: qk.schedule, queryFn: api.schedule });
  return (
    <Section id="schedule" title="Schedule" description="How often the system fetches new postings.">
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <ScheduleForm key={JSON.stringify(q.data)} initial={q.data} />}
    </Section>
  );
}

function ScheduleForm({ initial }: { initial: ScheduleDto }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(String(initial.intervalHours));
  const save = useMutation({
    mutationFn: (patch: { intervalHours?: number; paused?: boolean }) => api.saveSchedule(patch),
    onSuccess: (s) => {
      qc.setQueryData(qk.schedule, s);
      void qc.invalidateQueries({ queryKey: qk.status });
      showToast({ message: 'Schedule saved.', tone: 'info' }, 2500);
    },
    onError: (e) => toastError(errorText(e)),
  });
  const n = Number(hours);
  const valid = Number.isFinite(n) && n >= 1 && n <= 168;
  return (
    <div className="flex flex-col gap-4">
      <Switch label="Pause scheduled fetching" checked={initial.paused} onChange={(v) => save.mutate({ paused: v })} description="Manual fetch still works." />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Fetch every" hint="Hours, from 1 to 168." className="w-32">
          {(id) => <TextInput id={id} type="number" min={1} max={168} value={hours} onChange={(e) => setHours(e.target.value)} aria-invalid={!valid || undefined} />}
        </Field>
        <Button className="mb-5" disabled={!valid || n === initial.intervalHours} busy={save.isPending} onClick={() => save.mutate({ intervalHours: n })}>
          Save interval
        </Button>
      </div>
      <p className="text-[13px] text-muted">
        {initial.paused ? 'Scheduled fetching is paused.' : initial.nextRunAt ? `Next fetch ${relativeTime(initial.nextRunAt)} (${dateTime(initial.nextRunAt)}).` : 'No fetch is scheduled.'}
      </p>
    </div>
  );
}

// ---- Language model

function LlmSection() {
  const q = useQuery({ queryKey: qk.llm, queryFn: api.llm });
  return (
    <Section id="model" title="Language model" description="The model that reads postings and scores each one. The CV digest and cover letters use a fixed model.">
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <LlmForm key={JSON.stringify(q.data.settings)} initial={q.data.settings} available={q.data.available} />}
    </Section>
  );
}

function HealthResult({ health }: { health: HealthDto }) {
  return (
    <div role="status" className={`border p-3 text-[13px] ${health.reachable && health.modelAvailable ? 'border-fg' : 'border-danger bg-danger-soft'}`}>
      <p>
        <strong>Provider:</strong> {health.reachable ? 'responds' : 'does not respond'}.{' '}
        <strong>Model:</strong> {health.modelAvailable ? 'available' : 'not available'}.
      </p>
      {health.detail && <p className="mt-1 text-muted">{health.detail}</p>}
    </div>
  );
}

function LlmForm({ initial, available }: { initial: LlmSettingsDto; available: boolean | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<LlmSaveInput>({
    provider: initial.provider,
    baseUrl: initial.baseUrl,
    model: initial.model,
    apiKey: initial.apiKey,
    claudeEffort: initial.claudeEffort,
  });
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const set = <K extends keyof LlmSaveInput>(k: K, v: LlmSaveInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify({ provider: initial.provider, baseUrl: initial.baseUrl, model: initial.model, apiKey: initial.apiKey, claudeEffort: initial.claudeEffort });

  const save = useMutation({
    mutationFn: () => api.saveLlm(draft),
    onSuccess: (r) => {
      setHealth(r.health);
      setNotSaved(!r.saved);
      if (r.saved) {
        qc.setQueryData(qk.llm, { settings: r.settings, available: r.health.reachable });
        void qc.invalidateQueries({ queryKey: qk.status });
        showToast({ message: 'Language model settings saved.', tone: 'info' });
      }
    },
    onError: (e) => toastError(errorText(e)),
  });
  const test = useMutation({
    mutationFn: api.testLlm,
    onSuccess: (h) => {
      setHealth(h);
      setNotSaved(false);
      void qc.invalidateQueries({ queryKey: qk.status });
    },
    onError: (e) => toastError(errorText(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="border border-line p-3 text-[13px]">
        <p className="font-medium">CV digest and cover letters always use {initial.writingModel} at {initial.writingEffort} effort.</p>
        <p className="mt-1">
          They run through the <code className="font-mono">claude</code> command, whatever provider you select below. Your CV text is sent to
          Anthropic for these two tasks. Without the command and its login, fill the profile by hand. Cover letters are then not available.
        </p>
      </div>
      <p className="text-[13px]">
        Current state:{' '}
        <strong>{available === null ? 'not checked yet' : available ? 'available' : 'not available'}</strong>
      </p>
      <Segmented
        label="Provider"
        value={draft.provider}
        onChange={(v) => {
          setHealth(null);
          set('provider', v);
        }}
        options={[
          { value: 'local', label: 'Local endpoint' },
          { value: 'claude-code', label: 'Claude Code' },
        ]}
      />
      {draft.provider === 'local' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Endpoint address" hint="An OpenAI-compatible server, such as Ollama or LM Studio." className="sm:col-span-2">
            {(id) => <TextInput id={id} value={draft.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="http://localhost:11434" />}
          </Field>
          <Field label="Model">{(id) => <TextInput id={id} value={draft.model} onChange={(e) => set('model', e.target.value)} />}</Field>
          <Field label="API key" hint="Leave empty when the server needs none.">
            {(id) => <TextInput id={id} type="password" autoComplete="off" value={draft.apiKey} onChange={(e) => set('apiKey', e.target.value)} />}
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div role="note" className="border border-dashed border-fg p-3 text-[13px]">
            <p className="font-medium">Your data leaves this machine.</p>
            <p className="mt-1">
              With Claude Code, posting text and your profile data are sent to Anthropic's hosted service. Each call counts against your Claude
              usage. The <code className="font-mono">claude</code> command and its login must exist on the machine that runs the server.
            </p>
          </div>
          <Segmented
            label="Effort"
            value={draft.claudeEffort}
            onChange={(v) => set('claudeEffort', v)}
            options={[
              { value: 'low', label: 'Low: faster' },
              { value: 'medium', label: 'Medium: more careful' },
            ]}
          />
          <p className="text-[13px] text-muted">
            Model: <span className="font-mono">{initial.claudeModel}</span>
          </p>
        </div>
      )}

      {health && <HealthResult health={health} />}
      {notSaved && (
        <p role="alert" className="text-[13px] text-danger">
          Not saved. A new provider is only saved when it responds.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          Save and test
        </Button>
        <Button busy={test.isPending} onClick={() => test.mutate()} disabled={dirty} title={dirty ? 'Save first; the test checks the saved settings.' : undefined}>
          Test saved settings
        </Button>
      </div>
      {dirty && <p className="text-xs text-muted">Save and test checks the settings above before it stores them.</p>}
    </div>
  );
}

// ---- Notifications

function NotificationsSection() {
  const q = useQuery({ queryKey: qk.notifications, queryFn: api.notifications });
  return (
    <Section
      id="notifications"
      title="Notifications"
      description="Push messages through ntfy when a posting scores above the threshold. A message holds only the title, company, score, and link."
    >
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <NotificationsForm key={JSON.stringify(q.data)} initial={q.data} />}
    </Section>
  );
}

function NotificationsForm({ initial }: { initial: NotificationSettingsDto }) {
  const qc = useQueryClient();
  const [server, setServer] = useState(initial.server);
  const [threshold, setThreshold] = useState(String(initial.threshold));
  const [windowSeconds, setWindowSeconds] = useState(String(initial.windowSeconds));
  const [appBaseUrl, setAppBaseUrl] = useState(initial.appBaseUrl);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const onSaved = (s: NotificationSettingsDto, message: string) => {
    qc.setQueryData(qk.notifications, s);
    showToast({ message, tone: 'info' }, 2500);
  };
  const save = useMutation({
    mutationFn: api.saveNotifications,
    onSuccess: (s) => onSaved(s, 'Notification settings saved.'),
    onError: (e) => toastError(errorText(e)),
  });
  const regenerate = useMutation({
    mutationFn: api.regenerateTopic,
    onSuccess: (s) => onSaved(s, 'New topic created. Subscribe again with the new link.'),
    onError: (e) => toastError(errorText(e)),
  });
  const test = useMutation({
    mutationFn: api.testNotification,
    onSuccess: setTestResult,
    onError: (e) => setTestResult({ ok: false, error: errorText(e) }),
  });

  const copy = async () => {
    if (!initial.subscribeUrl) return;
    try {
      await navigator.clipboard.writeText(initial.subscribeUrl);
      showToast({ message: 'Link copied.', tone: 'info' }, 2000);
    } catch {
      toastError('The link could not be copied. Select it and copy it by hand.');
    }
  };

  const t = Number(threshold);
  const w = Number(windowSeconds);
  const valid = Number.isFinite(t) && t >= 0 && t <= 100 && Number.isFinite(w) && w >= 0 && w <= 3600 && server.trim() !== '' && appBaseUrl.trim() !== '';
  const dirty = server !== initial.server || t !== initial.threshold || w !== initial.windowSeconds || appBaseUrl !== initial.appBaseUrl;

  return (
    <div className="flex flex-col gap-4">
      <Switch label="Send notifications" checked={initial.enabled} onChange={(v) => save.mutate({ enabled: v })} description="Enabling creates a private topic name." />

      {initial.subscribeUrl && (
        <div className="flex flex-col gap-1">
          <label htmlFor="subscribe-url" className="text-[13px] font-medium">
            Subscribe link
          </label>
          <div className="flex gap-2">
            <TextInput id="subscribe-url" readOnly value={initial.subscribeUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button onClick={() => void copy()}>Copy</Button>
          </div>
          <p className="text-xs text-muted">
            Open this link in the ntfy app or a browser. Anyone with the topic name can read the messages, so keep it private.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Score threshold" hint="Notify for postings at or above this score.">
          {(id) => <TextInput id={id} type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />}
        </Field>
        <Field label="Batching window in seconds" hint="Postings in this window go in one message.">
          {(id) => <TextInput id={id} type="number" min={0} max={3600} value={windowSeconds} onChange={(e) => setWindowSeconds(e.target.value)} />}
        </Field>
        <Field label="ntfy server">{(id) => <TextInput id={id} type="url" value={server} onChange={(e) => setServer(e.target.value)} />}</Field>
        <Field label="Address of this app" hint="Links in messages point here.">
          {(id) => <TextInput id={id} type="url" value={appBaseUrl} onChange={(e) => setAppBaseUrl(e.target.value)} />}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={!dirty || !valid}
          busy={save.isPending}
          onClick={() => save.mutate({ server: server.trim(), threshold: t, windowSeconds: w, appBaseUrl: appBaseUrl.trim() })}
        >
          Save
        </Button>
        <Button busy={test.isPending} onClick={() => test.mutate()}>
          Send test message
        </Button>
        {initial.topic && (
          <ConfirmButton
            label="Create new topic"
            confirmLabel="Yes, replace the topic"
            variant="primary"
            busy={regenerate.isPending}
            onConfirm={() => regenerate.mutate()}
          />
        )}
      </div>
      {initial.topic && <p className="text-xs text-muted">A new topic stops messages to the old one. Devices must subscribe again.</p>}
      {testResult && (
        <p role="status" className={`text-[13px] ${testResult.ok ? '' : 'text-danger'}`}>
          {testResult.ok ? 'Test message sent. Check your device.' : `The test failed. ${testResult.error ?? ''}`}
        </p>
      )}
    </div>
  );
}

// ---- Backups

function BackupsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.backups, queryFn: api.backups });
  const create = useMutation({
    mutationFn: api.createBackup,
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: qk.backups });
      showToast({ message: `Backup ${b.name} created.`, tone: 'info' });
    },
    onError: (e) => toastError(errorText(e)),
  });
  return (
    <Section
      id="backups"
      title="Backups"
      description={
        q.data
          ? `A backup is made every ${q.data.settings.intervalHours} hours and the newest ${q.data.settings.keep} are kept. Last backup: ${q.data.settings.lastAt ? relativeTime(q.data.settings.lastAt) : 'never'}.`
          : 'Copies of the full database.'
      }
      actions={
        <Button size="sm" busy={create.isPending} onClick={() => create.mutate()}>
          Create backup
        </Button>
      }
    >
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.backups.length === 0 && <p className="text-[13px] text-muted">No backups yet.</p>}
      {q.data && q.data.backups.length > 0 && (
        <ul className="divide-y divide-line text-[13px]">
          {q.data.backups.map((b) => (
            <li key={b.name} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="font-mono text-xs break-all">{b.name}</span>
                <span className="tabular ml-2 text-muted">
                  {bytes(b.size)} · {dateTime(b.createdAt)}
                </span>
              </span>
              <a href={api.backupUrl(b.name)} download={b.name} className="font-medium underline decoration-accent decoration-2 hover:decoration-fg">
                Download<span className="sr-only"> {b.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
