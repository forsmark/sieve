import { useEffect, useLayoutEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CoverLetterDto, PostingDetail } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { Button, ConfirmButton, Field, Spinner, TextArea } from '../../components/ui';
import { showToast, toastError } from '../../lib/toast';

/** Sets the height of a textarea to the height of its text. */
function fitHeight(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  // The height includes the border; the scroll height does not.
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

/** The cover letter of one posting: generate, edit, copy, and download. */
export function CoverLetter({ postingId, letter }: { postingId: string; letter: CoverLetterDto | null }) {
  const qc = useQueryClient();
  const [instruction, setInstruction] = useState(letter?.instruction ?? '');
  const [draft, setDraft] = useState(letter?.text ?? '');

  // A new generation or a save on the server replaces the local text.
  useEffect(() => {
    setDraft(letter?.text ?? '');
  }, [letter?.text, letter?.updatedAt, postingId]);

  const setLetter = (next: CoverLetterDto | null) =>
    qc.setQueryData<PostingDetail>(qk.posting(postingId), (old) => (old ? { ...old, coverLetter: next } : old));

  const generate = useMutation({
    mutationFn: () => api.generateCoverLetter(postingId, instruction.trim() || null),
    onSuccess: setLetter,
    onError: (e) => toastError(errorText(e)),
  });
  const save = useMutation({
    mutationFn: () => api.saveCoverLetter(postingId, draft),
    onSuccess: (l) => {
      setLetter(l);
      showToast({ message: 'Cover letter saved.', tone: 'info' });
    },
    onError: (e) => toastError(errorText(e)),
  });

  const pending = letter?.state === 'pending' || generate.isPending;
  const hasText = !!letter?.text;

  // The letter field grows with its text, so only the panel scrolls. `field-sizing: content` does the same where the browser has it.
  const letterId = `letter-${postingId}`;
  useLayoutEffect(() => {
    const el = document.getElementById(letterId);
    if (el instanceof HTMLTextAreaElement) fitHeight(el);
  }, [draft, hasText, letterId]);
  // A narrower field wraps the text into more lines, after a resize or a rotation. The field hides its overflow,
  // so it measures again, or the end of the letter is cut off. Only a change of width counts: the height is its own.
  useEffect(() => {
    const el = document.getElementById(letterId);
    if (!hasText || !(el instanceof HTMLTextAreaElement)) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitHeight(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasText, letterId]);
  const dirty = hasText && draft !== letter?.text;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      showToast({ message: 'Cover letter copied.', tone: 'info' });
    } catch {
      toastError('The browser did not allow the copy. Select the text and copy it by hand.');
    }
  };

  const instructionField = (
    <Field label="Instruction for this letter (optional)" hint='For example "mention my open source work" or "at most 200 words".'>
      {(id) => (
        <TextArea
          id={id}
          rows={2}
          maxLength={2000}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={pending}
          className="min-h-14"
        />
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-3">
      {pending && (
        <div className="border border-line-strong px-3 py-2 text-[13px] font-medium">
          <Spinner small label="Fable 5.2 writes the letter. This takes up to a minute." />
        </div>
      )}

      {!pending && letter?.error && (
        <div role="alert" className="border border-danger bg-danger-soft px-3 py-2 text-[13px]">
          <p className="font-medium text-danger">
            {hasText ? 'The new letter could not be written. The earlier letter is kept.' : 'The letter could not be written. Try again.'}
          </p>
          <p className="mt-1 text-xs break-words text-muted">{letter.error}</p>
        </div>
      )}

      {hasText && (
        <>
          <label className="sr-only" htmlFor={letterId}>
            Cover letter text
          </label>
          <TextArea
            id={letterId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            rows={16}
            className="field-sizing-content min-h-72 resize-none overflow-hidden text-[15px] leading-relaxed"
          />
          <p className="text-xs text-muted">
            {letter?.language ? `${letter.language}. ` : ''}
            {draft.trim() ? `${draft.trim().split(/\s+/).length} words. ` : ''}
            {letter?.edited ? 'Edited by you. ' : ''}
            {dirty ? 'You have changes that are not saved.' : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => save.mutate()} busy={save.isPending} disabled={!dirty || !draft.trim() || pending}>
              Save changes
            </Button>
            <Button size="sm" onClick={copy} disabled={pending}>
              Copy
            </Button>
            {dirty || pending ? (
              <Button size="sm" disabled title="Save your changes first.">
                Download PDF
              </Button>
            ) : (
              <a
                className="inline-flex h-7 items-center border border-line-strong px-2.5 text-[13px] font-semibold hover:border-fg hover:bg-surface-2 touch:h-11"
                href={api.coverLetterPdfUrl(postingId)}
                download
              >
                Download PDF
              </a>
            )}
          </div>
        </>
      )}

      <details className="border-t border-line-strong pt-3" open={!hasText}>
        <summary className="cursor-pointer text-[13px] font-semibold">{hasText ? 'Write a new letter' : 'Write a letter'}</summary>
        <div className="mt-2 flex flex-col gap-2">
          {instructionField}
          <div>
            {hasText ? (
              <ConfirmButton
                label="Regenerate"
                confirmLabel="Replace the current letter"
                onConfirm={() => generate.mutate()}
                busy={pending}
                size="sm"
                variant="secondary"
              />
            ) : (
              <Button size="sm" variant="primary" onClick={() => generate.mutate()} busy={pending}>
                Generate cover letter
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">
            Fable 5.2 writes the letter through the claude command, in the language of the posting. Your CV text and the posting text are sent to Anthropic.
            Check every claim before you send the letter.
          </p>
        </div>
      </details>
    </div>
  );
}

/** The same section for a place that has only the posting identifier, such as the application board. */
export function CoverLetterForPosting({ postingId }: { postingId: string }) {
  const posting = useQuery({
    queryKey: qk.posting(postingId),
    queryFn: () => api.posting(postingId),
    refetchInterval: (q) => (q.state.data?.coverLetter?.state === 'pending' ? 4000 : false),
  });
  if (posting.isPending) return <Spinner small label="Loading" />;
  if (posting.isError) return <p className="text-[13px] text-muted">The cover letter is not available, because the posting no longer exists.</p>;
  return <CoverLetter postingId={postingId} letter={posting.data.coverLetter} />;
}
