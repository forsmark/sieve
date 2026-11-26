import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ApplicationDto } from '../../../../shared/api';
import { APPLICATION_STAGES, type ApplicationStage } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { Badge, Button, ConfirmButton, ErrorState, Field, Select, Spinner, TextArea, TextInput, Icon } from '../../components/ui';
import { dateOnly, dateTime, fromLocalInput, toLocalInput } from '../../lib/format';
import { STAGE_LABEL, useMoveApplication, useRemoveApplication } from './stages';
import { clearNotesDraft, notesDraft, useStoreApplicationField } from './notes';
import { CoverLetterForPosting } from '../jobs/CoverLetter';

/**
 * True for a datetime-local value whose year has four digits and is at least 1900. While the user types a year
 * into a filled field, the field holds the years in between, such as 0002, 0020 and 0202.
 */
function isWholeDate(value: string): boolean {
  const year = /^(\d+)-/.exec(value)?.[1];
  return !!year && year.length === 4 && Number(year) >= 1900;
}

export function ApplicationPanel({ app, onClose }: { app: ApplicationDto; onClose: () => void }) {
  const qc = useQueryClient();
  const move = useMoveApplication();
  const events = useQuery({ queryKey: qk.applicationEvents(app.postingId), queryFn: () => api.applicationEvents(app.postingId) });
  const id = app.postingId;
  // Notes that could not be stored come back from the draft map in place of the stored ones.
  const [notes, setNotes] = useState(() => notesDraft(id) ?? app.notes ?? '');
  const [interview, setInterview] = useState(toLocalInput(app.interviewAt));
  const expired = app.linkStatus === 'expired' || app.linkStatus === null;

  const notesStore = useStoreApplicationField(id, 'notes');
  const dateStore = useStoreApplicationField(id, 'interviewAt');
  const { mutate: storeNotesValue } = notesStore;
  const { mutate: storeDateValue } = dateStore;
  /** The values in the fields now, for the handlers that run on blur, close, unmount and page hide. */
  const current = useRef({ notes, interview });
  /** The values the server holds or that are on their way to it. Null after a failed store, so the next chance stores again. */
  const sent = useRef<{ notes: string | null; interview: string | null }>({ notes: app.notes ?? '', interview: toLocalInput(app.interviewAt) });

  /** False once the application is gone from the board, for example after its removal. Then nothing is stored. */
  const exists = useCallback(() => qc.getQueryData<ApplicationDto[]>(qk.applications)?.some((a) => a.postingId === id) ?? false, [qc, id]);

  const storeNotes = useCallback(() => {
    const value = current.current.notes;
    if (value === sent.current.notes || !exists()) return;
    sent.current.notes = value;
    storeNotesValue(value || null, {
      onError: () => {
        if (sent.current.notes === value) sent.current.notes = null;
      },
    });
  }, [exists, storeNotesValue]);

  const storeDate = useCallback(() => {
    const value = current.current.interview;
    if (value === sent.current.interview || !exists()) return;
    sent.current.interview = value;
    storeDateValue(fromLocalInput(value), {
      onError: () => {
        if (sent.current.interview === value) sent.current.interview = null;
      },
    });
  }, [exists, storeDateValue]);

  // The notes are stored when the page is hidden or left, and when the panel unmounts: by Close, by the
  // browser's back gesture, or because another application opens.
  useEffect(() => {
    const flush = () => {
      storeNotes();
      storeDate();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [storeNotes, storeDate]);

  const close = () => {
    storeNotes();
    storeDate();
    onClose();
  };

  const remove = useRemoveApplication({
    onRemoved: () => {
      clearNotesDraft(id);
      onClose();
    },
  });

  const notesCaption = notesStore.isPending ? 'Saving…' : notesStore.isSuccess && (notesStore.variables ?? '') === notes ? 'Saved' : '';
  const dateCaption = dateStore.isPending ? 'Saving…' : dateStore.isSuccess && dateStore.variables === fromLocalInput(interview) ? 'Saved' : '';
  const s = app.snapshot;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3 touch:h-12">
        <Button size="sm" variant="ghost" onClick={close}>
          <Icon name="arrow-left" /> Close
        </Button>
        {!expired && (
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-semibold underline decoration-accent decoration-2 touch:inline-flex touch:min-h-11 touch:items-center touch:gap-1"
          >
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
            {/* On a touch screen an invisible area of at least 44px around the link takes the tap, without moving the line. */}
            <Link
              to="/jobs"
              search={{ id: app.postingId, status: 'all' }}
              className="relative font-semibold underline decoration-accent decoration-2 touch:after:absolute touch:after:-inset-x-2 touch:after:-inset-y-4"
            >
              Show in job list
            </Link>
          </p>
        </header>

        <Field label="Stage">
          {(fieldId) => (
            <Select id={fieldId} value={app.stage} onChange={(e) => move.mutate({ id: app.postingId, stage: e.target.value as ApplicationStage })}>
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
            {(fieldId) => (
              <TextInput
                id={fieldId}
                type="datetime-local"
                value={interview}
                onChange={(e) => {
                  setInterview(e.target.value);
                  current.current.interview = e.target.value;
                  // An empty value, or a year of fewer than four digits, can be a date the user is still typing.
                  // Only a whole date stores at once. Blur, close and page hide store the rest.
                  if (isWholeDate(e.target.value)) storeDate();
                }}
                onBlur={storeDate}
              />
            )}
          </Field>
          <div className="flex min-h-4 flex-wrap items-center gap-2">
            {app.interviewAt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setInterview('');
                  current.current.interview = '';
                  storeDate();
                }}
              >
                Clear date
              </Button>
            )}
            <SaveCaption text={dateCaption} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Field label="Notes">
            {(fieldId) => (
              <TextArea
                id={fieldId}
                rows={6}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  current.current.notes = e.target.value;
                }}
                onBlur={storeNotes}
                placeholder="Contacts, salary talks, next steps"
              />
            )}
          </Field>
          <div className="min-h-4">
            <SaveCaption text={notesCaption} />
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

/** "Saving…" while a store runs, then "Saved". Screen readers hear the change. */
function SaveCaption({ text }: { text: string }) {
  return (
    <span role="status" className="text-xs text-muted">
      {text}
    </span>
  );
}
