import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AnalysisVerdict, MatchAnalysisDto, PostingDetail } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { updateListItems } from '../../api/events';
import { Button, ConfirmButton, Spinner } from '../../components/ui';
import { showToast, toastError } from '../../lib/toast';

export const VERDICT_LABEL: Record<AnalysisVerdict, string> = { apply: 'Apply', consider: 'Consider', skip: 'Skip' };
const SEVERITY_LABEL = { blocking: 'Blocking', significant: 'Significant', minor: 'Minor' } as const;

/** The expanded match analysis of one posting: start it, read it, run it again, and remove it. */
export function MatchAnalysis({
  postingId,
  analysis,
  currentScore = null,
}: {
  postingId: string;
  analysis: MatchAnalysisDto | null;
  /** The total score that the posting has now. */
  currentScore?: number | null;
}) {
  const qc = useQueryClient();
  const setAnalysis = (next: MatchAnalysisDto | null) => {
    qc.setQueryData<PostingDetail>(qk.posting(postingId), (old) => (old ? { ...old, matchAnalysis: next } : old));
    updateListItems(qc, postingId, (i) => ({ ...i, analysis: next ? { state: next.state, verdict: next.content?.verdict ?? null } : null }));
  };

  const run = useMutation({
    mutationFn: () => api.requestAnalysis(postingId),
    onSuccess: setAnalysis,
    onError: (e) => toastError(errorText(e)),
  });
  const applyScore = useMutation({
    mutationFn: () => api.applyAnalysisScore(postingId),
    onSuccess: (next) => {
      setAnalysis(next);
      void qc.invalidateQueries({ queryKey: qk.posting(postingId) });
      showToast({ message: `The score is now ${next.proposedTotal ?? 'updated'}.`, tone: 'info' }, 2500);
    },
    onError: (e) => toastError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteAnalysis(postingId),
    onSuccess: () => setAnalysis(null),
    onError: (e) => toastError(errorText(e)),
  });

  const pending = analysis?.state === 'pending' || run.isPending;
  const c = analysis?.content ?? null;

  return (
    <div className="flex flex-col gap-4">
      {pending && (
        <div className="border border-current px-3 py-2 text-[13px] font-medium">
          <Spinner small label="Fable 5.2 analyzes the match. This takes up to a minute." />
        </div>
      )}

      {!pending && analysis?.error && (
        <div role="alert" className="border border-current px-3 py-2 text-[13px]">
          <p className="font-bold">{c ? 'The last analysis failed. The earlier analysis is kept.' : 'The analysis failed.'}</p>
          <p className="mt-1 break-words">{analysis.error}</p>
        </div>
      )}

      {c && (
        <>
          <div>
            <p className="text-xs font-semibold tracking-wide uppercase">Verdict</p>
            <p className="text-[2rem] leading-tight font-extrabold tracking-tight">{VERDICT_LABEL[c.verdict]}</p>
            <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed">{c.summary}</p>
          </div>

          {c.scores && (
            <section aria-label="Revised score" className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-current px-3 py-2 text-[13px]">
              <p>
                <span className="font-bold">Revised score: {analysis?.proposedTotal ?? 'not available'}</span>
                {currentScore !== null && <span> (now {currentScore})</span>}
                <span className="tabular block text-xs">
                  Skills {c.scores.skills}, experience {c.scores.experience}, preferences {c.scores.preferences}. Location and the rules come from your
                  settings.
                </span>
              </p>
              {analysis?.scoreApplied ? (
                <span className="text-xs font-semibold">The posting uses this score.</span>
              ) : (
                analysis?.proposedTotal != null && (
                  <Button size="sm" variant="primary" onClick={() => applyScore.mutate()} busy={applyScore.isPending} disabled={pending}>
                    Use this score
                  </Button>
                )
              )}
            </section>
          )}

          <div className="grid gap-x-8 gap-y-4 @3xl:grid-cols-2">
            <section aria-label="Strengths">
              <h4 className="mb-2 border-b border-current pb-1 font-bold">Strengths ({c.strengths.length})</h4>
              {c.strengths.length === 0 ? (
                <p className="text-[13px]">The analysis found none.</p>
              ) : (
                <ul className="space-y-2.5">
                  {c.strengths.map((s, i) => (
                    <li key={i}>
                      <p className="font-semibold">{s.point}</p>
                      <p className="text-[13px] leading-relaxed">{s.evidence}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Gaps">
              <h4 className="mb-2 border-b border-current pb-1 font-bold">Gaps ({c.gaps.length})</h4>
              {c.gaps.length === 0 ? (
                <p className="text-[13px]">The analysis found none.</p>
              ) : (
                <ul className="space-y-2.5">
                  {c.gaps.map((g, i) => (
                    <li key={i}>
                      <p className="font-semibold">
                        {g.point}{' '}
                        <span className="ml-1 border border-current px-1 text-[11px] font-bold tracking-wide uppercase">{SEVERITY_LABEL[g.severity]}</span>
                      </p>
                      <p className="text-[13px] leading-relaxed">{g.mitigation}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {c.unknowns.length > 0 && (
              <section aria-label="Questions to ask">
                <h4 className="mb-2 border-b border-current pb-1 font-bold">Questions to ask</h4>
                <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
                  {c.unknowns.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </section>
            )}
            {c.positioning.length > 0 && (
              <section aria-label="What to emphasize">
                <h4 className="mb-2 border-b border-current pb-1 font-bold">What to emphasize</h4>
                <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
                  {c.positioning.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={c ? 'secondary' : 'primary'} onClick={() => run.mutate()} busy={pending}>
          {c ? 'Run again' : 'Run expanded analysis'}
        </Button>
        {c && !pending && (
          <ConfirmButton
            label="Remove"
            confirmLabel="Remove the analysis"
            onConfirm={() => remove.mutate()}
            busy={remove.isPending}
            size="sm"
            variant="secondary"
          />
        )}
        {c && analysis?.generatedAt && (
          <span className="text-xs">
            Written {analysis.generatedAt.slice(0, 10)}
            {analysis.model ? ` by ${analysis.model}` : ''}. A later change of your CV or preferences does not update it.
          </span>
        )}
      </div>
      <p className="max-w-[70ch] text-xs">
        Fable 5.2 compares the full posting with your CV and preferences through the claude command. Your CV text and the posting text are sent to Anthropic.
        The analysis changes the score only when you select "Use this score". A later change of your CV or preferences scores the posting again and replaces it.
        Check its claims against the posting.
      </p>
    </div>
  );
}
