import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProfileDto } from '../../../../shared/api';
import { EMPTY_PROFILE, StructuredProfile } from '../../../../shared/schemas';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { Badge, Button, ConfirmButton, Field, ListInput, Section, Select, TextArea, TextInput, cx } from '../../components/ui';
import { showToast, toastError } from '../../lib/toast';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { PHONE_QUERY } from '../../app/media';
import { planText } from './plan';

const LEVELS = ['basic', 'working', 'strong', 'expert'] as const;

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A field of a skill row. Below 640px it shows its label above it; from 640px the header row names the column. */
function SkillField({ label, phone, className, children }: { label: string; phone: boolean; className?: string; children: ReactNode }) {
  if (!phone) return <div className={className}>{children}</div>;
  return (
    <label className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[13px] font-medium text-fg">{label}</span>
      {children}
    </label>
  );
}

export function ProfileEditor({ profile }: { profile: ProfileDto }) {
  const qc = useQueryClient();
  const phone = useMediaQuery(PHONE_QUERY);
  const [draft, setDraft] = useState<StructuredProfile>(profile.effective ?? EMPTY_PROFILE);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.effective);
  const set = <K extends keyof StructuredProfile>(k: K, v: StructuredProfile[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: (p: StructuredProfile) => api.saveProfile(p),
    onSuccess: (r) => {
      qc.setQueryData(qk.profile, r.profile);
      void qc.invalidateQueries({ queryKey: qk.status });
      void qc.invalidateQueries({ queryKey: qk.postingsAll });
      showToast({ message: `Profile saved. Rescoring: ${planText(r.plan)}`, tone: 'info' }, 8000);
    },
    onError: (e) => toastError(errorText(e)),
  });
  const discard = useMutation({
    mutationFn: api.discardEdits,
    onSuccess: (r) => {
      qc.setQueryData(qk.profile, r.profile);
      setDraft(r.profile.effective ?? EMPTY_PROFILE);
      void qc.invalidateQueries({ queryKey: qk.postingsAll });
      showToast({ message: `Your edits were discarded. Rescoring: ${planText(r.plan)}`, tone: 'info' }, 8000);
    },
    onError: (e) => toastError(errorText(e)),
  });

  const submit = () => {
    const parsed = StructuredProfile.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  };

  return (
    <Section
      title="Structured profile"
      description="Built from your CV. Your edits are kept when the CV is read again, unless you discard them."
      actions={profile.hasEdits ? <Badge tone="accent">Edited by you</Badge> : undefined}
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="Headline">{(id) => <TextInput id={id} value={draft.headline} onChange={(e) => set('headline', e.target.value)} />}</Field>
          <Field label="Total years of experience">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                step={0.5}
                value={draft.totalYears ?? ''}
                onChange={(e) => set('totalYears', numOrNull(e.target.value))}
              />
            )}
          </Field>
        </div>
        <Field label="Languages" hint="Separate with commas.">
          {(id) => <ListInput id={id} value={draft.languages} onChange={(v) => set('languages', v)} />}
        </Field>

        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold">Skills ({draft.skills.length})</legend>
          {/*
            From 640px the rows share the columns of one grid, under a header row. Below 640px each row puts the name on
            a line of its own above the level and the years, and each field shows its label.
          */}
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_7.5rem_5rem_auto] sm:items-center sm:gap-x-2 sm:gap-y-1.5">
            {!phone && draft.skills.length > 0 && (
              <div aria-hidden className="col-span-4 grid grid-cols-subgrid text-xs font-medium text-muted">
                <span>Skill</span>
                <span>Level</span>
                <span>Years</span>
              </div>
            )}
            {draft.skills.map((s, i) => {
              const upd = (patch: Partial<typeof s>) =>
                set(
                  'skills',
                  draft.skills.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                );
              return (
                <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-end gap-2 sm:col-span-4 sm:grid-cols-subgrid sm:items-center">
                  <SkillField label="Skill" phone={phone} className="col-span-3 sm:col-span-1">
                    <TextInput aria-label={`Skill ${i + 1} name`} value={s.name} onChange={(e) => upd({ name: e.target.value })} />
                  </SkillField>
                  <SkillField label="Level" phone={phone}>
                    <Select aria-label={`Skill ${i + 1} level`} value={s.level} onChange={(e) => upd({ level: e.target.value as (typeof LEVELS)[number] })}>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l[0]!.toUpperCase() + l.slice(1)}
                        </option>
                      ))}
                    </Select>
                  </SkillField>
                  <SkillField label="Years" phone={phone}>
                    <TextInput
                      aria-label={`Skill ${i + 1} years`}
                      type="number"
                      min={0}
                      placeholder="Years"
                      value={s.years ?? ''}
                      onChange={(e) => upd({ years: numOrNull(e.target.value) })}
                    />
                  </SkillField>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove skill ${s.name || i + 1}`}
                    onClick={() =>
                      set(
                        'skills',
                        draft.skills.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
          <Button size="sm" className="mt-2" onClick={() => set('skills', [...draft.skills, { name: '', level: 'working', years: null }])}>
            Add skill
          </Button>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold">Roles ({draft.roles.length})</legend>
          <div className="flex flex-col gap-3">
            {draft.roles.map((r, i) => {
              const upd = (patch: Partial<typeof r>) =>
                set(
                  'roles',
                  draft.roles.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                );
              return (
                <div key={i} className="grid gap-2 border border-line p-3 sm:grid-cols-2">
                  <Field label="Title">{(id) => <TextInput id={id} value={r.title} onChange={(e) => upd({ title: e.target.value })} />}</Field>
                  <Field label="Company">{(id) => <TextInput id={id} value={r.company} onChange={(e) => upd({ company: e.target.value })} />}</Field>
                  <Field label="Start">
                    {(id) => <TextInput id={id} placeholder="2021-03" value={r.start ?? ''} onChange={(e) => upd({ start: e.target.value || null })} />}
                  </Field>
                  <Field label="End" hint="Leave empty for a current role.">
                    {(id) => <TextInput id={id} value={r.end ?? ''} onChange={(e) => upd({ end: e.target.value || null })} />}
                  </Field>
                  <Field label="Summary" className="sm:col-span-2">
                    {(id) => <TextArea id={id} rows={2} value={r.summary} onChange={(e) => upd({ summary: e.target.value })} />}
                  </Field>
                  <div className="sm:col-span-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        set(
                          'roles',
                          draft.roles.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove role
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <Button size="sm" className="mt-2" onClick={() => set('roles', [...draft.roles, { title: '', company: '', start: null, end: null, summary: '' }])}>
            Add role
          </Button>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold">Education ({draft.education.length})</legend>
          <div className="flex flex-col gap-1.5">
            {draft.education.map((ed, i) => {
              const upd = (patch: Partial<typeof ed>) =>
                set(
                  'education',
                  draft.education.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                );
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] items-center gap-2">
                  <TextInput
                    aria-label={`Education ${i + 1} degree`}
                    placeholder="Degree"
                    value={ed.degree}
                    onChange={(e) => upd({ degree: e.target.value })}
                  />
                  <TextInput
                    aria-label={`Education ${i + 1} institution`}
                    placeholder="Institution"
                    value={ed.institution}
                    onChange={(e) => upd({ institution: e.target.value })}
                  />
                  <TextInput
                    aria-label={`Education ${i + 1} year`}
                    placeholder="Year"
                    value={ed.year ?? ''}
                    onChange={(e) => upd({ year: e.target.value || null })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      set(
                        'education',
                        draft.education.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
          <Button size="sm" className="mt-2" onClick={() => set('education', [...draft.education, { degree: '', institution: '', year: null }])}>
            Add education
          </Button>
        </fieldset>

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            Check the profile: {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="primary" disabled={!dirty} busy={save.isPending} onClick={submit}>
            Save profile
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(profile.effective ?? EMPTY_PROFILE)}>
              Undo changes
            </Button>
          )}
          {profile.hasEdits && (
            <ConfirmButton
              label="Discard my edits"
              confirmLabel="Yes, use the profile from the CV"
              onConfirm={() => discard.mutate()}
              busy={discard.isPending}
            />
          )}
        </div>
      </div>
    </Section>
  );
}
