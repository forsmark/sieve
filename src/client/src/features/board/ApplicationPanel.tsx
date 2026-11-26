import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ApplicationDto } from '../../../../shared/api';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { Badge, Button, ConfirmButton, ErrorState, Field, Select, Spinner, TextArea, TextInput, Icon } from '../../components/ui';
import { dateOnly, dateTime, fromLocalInput, toLocalInput } from '../../lib/format';
import { showToast, toastError } from '../../lib/toast';
import { STAGE_LABEL, useMoveApplication, useRemoveApplication } from './stages';
import { CoverLetterForPosting } from '../jobs/CoverLetter';

export function ApplicationPanel({ app, onClose }: { app: ApplicationDto; onClose: () => void }) {
  const qc = useQueryClient();
  const move = useMoveApplication();
  const events = useQuery({ queryKey: qk.applicationEvents(app.postingId), queryFn: () => api.applicationEvents(app.postingId) });
  const [notes, setNotes] = useState(app.notes ?? '');
  const [interview, setInterview] = useState(toLocalInput(app.interviewAt));
  const expired = app.linkStatus === 'expired' || app.linkStatus === null;

  const save = useMutation({
    mutationFn: (patch: { notes?: string | null; interviewAt?: string | null }) => api.updateApplication(app.postingId, patch),
    onSuccess: (updated) => {
      qc.setQueryData<ApplicationDto[]>(qk.applications, (list) => list?.map((a) => (a.postingId === updated.postingId ? updated : a)));
      showToast({ message: 'Saved.', tone: 'info' }, 2000);
    },
    onError: (e) => toastError(`Not saved. ${errorText(e)}`),
  });

  const remove = useRemoveApplication({ onRemoved: onClose });

  const notesDirty = notes !== (app.notes ?? '');
  const interviewDirty = interview !== toLocalInput(app.interviewAt);
  const s = app.snapshot;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <Button size="sm" variant="ghost" onClick={onClose}>
          <Icon name="arrow-left" /> Close
        </Button>
        {!expired && (
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold underline decoration-accent decoration-2">
            Open posting <Icon name="arrow-up-right" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      {/* Full screen below 1024px: the last lines stay above the home indicator of a phone. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header>
          <h2 className="text-2xl leading-[1.15] font-bold tracking-tight">{s.title}</h2>
          <p className="text-muted">{[s.company, s.location].filter(Boolean).join(' · ')}</p>
          <p className="mt-1 text-xs text-muted">
            Applied {dateOnly(app.appliedAt)} · updated {dateTime(app.updatedAt)} ·{' '}
            <Link to="/jobs" search={{ id: app.postingId, status: 'all' }} className="font-semibold underline decoration-accent decoration-2">
              Show in job list
            </Link>
          </p>
        </header>

        <Field label="Stage">
          {(id) => (
            <Select id={id} value={app.stage} onChange={(e) => move.mutate({ id: app.postingId, stage: e.target.value as ApplicationStage })}>
              {APPLICATION_STAGES.map((st) => (
                <option key={st} value={st}>
                  {STAGE_LABEL[st]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <Field label="Interview date and time">
            {(id) => <TextInput id={id} type="datetime-local" value={interview} onChange={(e) => setInterview(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!interviewDirty}
              busy={save.isPending && save.variables?.interviewAt !== undefined}
              onClick={() => save.mutate({ interviewAt: fromLocalInput(interview) })}
            >
              Save date
            </Button>
            {app.interviewAt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setInterview('');
                  save.mutate({ interviewAt: null });
                }}
              >
                Clear date
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Field label="Notes">
            {(id) => <TextArea id={id} rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contacts, salary talks, next steps" />}
          </Field>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={!notesDirty}
              busy={save.isPending && save.variables?.notes !== undefined}
              onClick={() => save.mutate({ notes: notes || null })}
            >
              Save notes
            </Button>
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-base font-bold">Stage history</h3>
          {events.isPending && <Spinner small label="Loading history" />}
          {events.isError && <ErrorState error={events.error} onRetry={() => void events.refetch()} />}
          {events.data && events.data.length === 0 && <p className="text-[13px] text-muted">No stage changes yet.</p>}
          {events.data && events.data.length > 0 && (
            <ol className="space-y-1 text-[13px]">
              {events.data.map((ev) => (
                <li key={ev.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular text-muted">{dateTime(ev.createdAt)}</span>
                  <span>
                    {ev.fromStage ? `${STAGE_LABEL[ev.fromStage as ApplicationStage] ?? ev.fromStage} to ` : 'Created in '}
                    <strong>{STAGE_LABEL[ev.toStage as ApplicationStage] ?? ev.toStage}</strong>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-base font-bold">
            Stored copy of the posting
            {expired && <Badge tone="warn">Original link expired</Badge>}
          </h3>
          {expired && <p className="mb-2 text-[13px]">The original posting is no longer available. This is the copy saved when you applied.</p>}
          <details open={expired} className="field bg-field-beige p-4">
            <summary className="cursor-pointer text-[13px] font-semibold">Description and facts</summary>
            {s.facts?.summary && <p className="mt-2 text-[13px]">{s.facts.summary}</p>}
            {s.facts && s.facts.requiredSkills.length > 0 && (
              <p className="mt-2 text-[13px]">
                <span className="text-muted">Required skills:</span> {s.facts.requiredSkills.join(', ')}
              </p>
            )}
            <div className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap">{s.description ?? 'No description was stored.'}</div>
          </details>

          <details className="field mt-1.5 bg-field-pink p-4">
            <summary className="cursor-pointer text-[13px] font-semibold">Cover letter</summary>
            <div className="mt-2">
              <CoverLetterForPosting postingId={app.postingId} />
            </div>
          </details>
        </section>

        <section className="border-t border-line pt-4">
          <p className="mb-2 text-[13px] text-muted">Removing deletes the application and its history. The posting returns to the job list as saved.</p>
          <ConfirmButton
            label="Remove application"
            confirmLabel="Yes, remove it"
            onConfirm={() => remove.mutate(app.postingId)}
            busy={remove.isPending}
            size="sm"
          />
        </section>
      </div>
    </div>
  );
}
