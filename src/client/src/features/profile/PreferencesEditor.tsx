import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RescorePlanDto } from '../../../../shared/api';
import { DEFAULT_PREFERENCES, Preferences, type Weights } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { Button, ErrorState, Field, ListInput, LoadingState, Section, Segmented, Select, Switch, TextArea, TextInput } from '../../components/ui';
import { showToast, toastError } from '../../lib/toast';
import { planText } from './plan';

const MODE_OPTIONS = [
  { value: 'soft' as const, label: 'Soft: lowers the score' },
  { value: 'hard' as const, label: 'Hard: excludes the posting' },
];

const WEIGHT_LABEL: Record<keyof Weights, string> = { skills: 'Skills', experience: 'Experience', preferences: 'Preferences', location: 'Location' };

export function PreferencesEditor() {
  const prefs = useQuery({ queryKey: qk.preferences, queryFn: api.preferences });
  return (
    <Section title="Preferences" description="What you want from a job. A change rescores the postings it affects. You see the cost before you save.">
      {prefs.isPending && <LoadingState label="Loading preferences" />}
      {prefs.isError && <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />}
      {prefs.data && <PreferencesForm key={JSON.stringify(prefs.data)} initial={prefs.data} />}
    </Section>
  );
}

function PreferencesForm({ initial }: { initial: Preferences }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Preferences>({ ...DEFAULT_PREFERENCES, ...initial });
  const [preview, setPreview] = useState<RescorePlanDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => {
    setPreview(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...DEFAULT_PREFERENCES, ...initial });
  const weightSum = draft.weights.skills + draft.weights.experience + draft.weights.preferences + draft.weights.location;

  const validate = (): Preferences | null => {
    const parsed = Preferences.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return null;
    }
    setError(null);
    return parsed.data;
  };

  const dryRun = useMutation({
    mutationFn: (p: Preferences) => api.previewPreferences(p),
    onSuccess: (r) => setPreview(r.plan),
    onError: (e) => toastError(errorText(e)),
  });
  const save = useMutation({
    mutationFn: (p: Preferences) => api.savePreferences(p),
    onSuccess: (r) => {
      setPreview(null);
      qc.setQueryData(qk.preferences, r.preferences);
      void qc.invalidateQueries({ queryKey: qk.postingsAll });
      void qc.invalidateQueries({ queryKey: qk.status });
      showToast({ message: `Preferences saved. Rescoring: ${planText(r.plan)}`, tone: 'info' }, 8000);
    },
    onError: (e) => toastError(errorText(e)),
  });

  const w = draft.weights;
  const setWeight = (k: keyof Weights, v: number) => set('weights', { ...w, [k]: Math.max(0, Math.min(100, Math.round(v) || 0)) });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const p = validate();
        if (p) dryRun.mutate(p);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Locations" hint="Cities or countries where you want to work. Separate with commas.">
          {(id) => <ListInput id={id} value={draft.locations} onChange={(v) => set('locations', v)} />}
        </Field>
        <Field label="Commutable locations" hint="Places close enough to commute to.">
          {(id) => <ListInput id={id} value={draft.commutableLocations} onChange={(v) => set('commutableLocations', v)} />}
        </Field>
      </div>
      <Segmented label="Location rule" value={draft.locationMode} onChange={(v) => set('locationMode', v)} options={MODE_OPTIONS} />

      <fieldset>
        <legend className="mb-1 text-[13px] font-medium">Work arrangements</legend>
        <div className="flex flex-wrap gap-4">
          {(['remote', 'hybrid', 'onsite'] as const).map((a) => (
            <label key={a} className="flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.workArrangements.includes(a)}
                onChange={(e) => set('workArrangements', e.target.checked ? [...draft.workArrangements, a] : draft.workArrangements.filter((x) => x !== a))}
              />
              {a === 'onsite' ? 'On site' : a[0]!.toUpperCase() + a.slice(1)}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">None checked means any arrangement.</p>
      </fieldset>
      <Segmented label="Work arrangement rule" value={draft.workArrangementMode} onChange={(v) => set('workArrangementMode', v)} options={MODE_OPTIONS} />
      <Segmented label="Language rule" value={draft.languageMode} onChange={(v) => set('languageMode', v)} options={MODE_OPTIONS} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Seniority">
          {(id) => (
            <Select id={id} value={draft.seniority} onChange={(e) => set('seniority', e.target.value as Preferences['seniority'])}>
              <option value="any">Any</option>
              <option value="junior">Junior</option>
              <option value="mid">Mid</option>
              <option value="senior">Senior</option>
              <option value="lead">Lead</option>
            </Select>
          )}
        </Field>
        <Field label="Minimum salary" hint="Per year. Empty means no minimum.">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={0}
              value={draft.minSalary ?? ''}
              onChange={(e) => set('minSalary', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
            />
          )}
        </Field>
        <Field label="Salary currency">
          {(id) => <TextInput id={id} maxLength={8} value={draft.salaryCurrency} onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())} />}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Technology you want">{(id) => <ListInput id={id} value={draft.wantedTech} onChange={(v) => set('wantedTech', v)} />}</Field>
        <Field label="Technology you avoid">{(id) => <ListInput id={id} value={draft.unwantedTech} onChange={(v) => set('unwantedTech', v)} />}</Field>
        <Field label="Excluded companies" hint="Postings from these companies are excluded." className="sm:col-span-2">
          {(id) => <ListInput id={id} value={draft.excludedCompanies} onChange={(v) => set('excludedCompanies', v)} />}
        </Field>
      </div>
      <Field label="Notes for the model" hint="Free text the model reads when it judges a posting.">
        {(id) => <TextArea id={id} rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />}
      </Field>

      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold">Weights</legend>
        <p className="mb-2 text-xs text-muted">
          How much each dimension counts in the total score. The weights are relative: each one counts as its share of the sum.
        </p>
        <div className="mb-3">
          <Switch
            label="Count location in the score"
            description="Turn this off when your search already limits the location. Then every posting has the same location fit, and it only raises all scores. A hard location constraint still excludes postings."
            checked={w.location > 0}
            onChange={(v) => setWeight('location', v ? DEFAULT_PREFERENCES.weights.location : 0)}
          />
        </div>
        <div className="flex flex-col gap-2">
          {(Object.keys(WEIGHT_LABEL) as Array<keyof Weights>).map((k) => (
            // Below 640px a weight takes two lines: the label and its share, then the slider and the number.
            <div key={k} className="grid grid-cols-[1fr_4.5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[6.5rem_1fr_4.5rem_3.5rem] sm:gap-3">
              <label htmlFor={`w-${k}`} className="text-[13px]">
                {WEIGHT_LABEL[k]}
              </label>
              <input
                id={`w-${k}`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={w[k]}
                onChange={(e) => setWeight(k, Number(e.target.value))}
                className="max-sm:order-3"
              />
              <TextInput
                aria-label={`${WEIGHT_LABEL[k]} weight`}
                type="number"
                min={0}
                max={100}
                value={w[k]}
                onChange={(e) => setWeight(k, Number(e.target.value))}
                className="max-sm:order-4"
              />
              <span className="tabular text-right text-xs text-muted max-sm:order-2">{weightSum > 0 ? `${Math.round((w[k] / weightSum) * 100)}%` : '–'}</span>
            </div>
          ))}
        </div>
        <p className="tabular mt-2 text-[13px]" aria-live="polite">
          Sum: <strong>{weightSum}</strong>
          {weightSum === 0 ? (
            <span className="text-danger"> At least one weight must be above 0.</span>
          ) : weightSum !== 100 ? (
            <span className="text-muted"> (not 100, which is fine)</span>
          ) : null}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-semibold">Auto-dismiss</legend>
        <Switch
          label="Dismiss low scores automatically"
          description="Postings below the threshold are dismissed. You can restore them from the dismissed filter."
          checked={draft.autoDismiss.enabled}
          onChange={(v) => set('autoDismiss', { ...draft.autoDismiss, enabled: v })}
        />
        <Field label="Threshold" className="max-w-32">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={0}
              max={100}
              disabled={!draft.autoDismiss.enabled}
              value={draft.autoDismiss.threshold}
              onChange={(e) => set('autoDismiss', { ...draft.autoDismiss, threshold: Math.max(0, Math.min(100, Math.round(Number(e.target.value)) || 0)) })}
            />
          )}
        </Field>
      </fieldset>

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {preview && (
        <div role="status" className="border border-fg p-3 text-[13px]">
          <p className="font-medium">Cost of this change</p>
          <p className="mt-1">{planText(preview)}</p>
          {preview.judge + preview.extract > 0 && <p className="mt-1 text-muted">Model calls take time, and with Claude Code they count against your usage.</p>}
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              busy={save.isPending}
              onClick={() => {
                const p = validate();
                if (p) save.mutate(p);
              }}
            >
              Save preferences
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!preview && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button type="submit" variant="primary" disabled={!dirty} busy={dryRun.isPending}>
            Review and save
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft({ ...DEFAULT_PREFERENCES, ...initial })}>
              Undo changes
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
