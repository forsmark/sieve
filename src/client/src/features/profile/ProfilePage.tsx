import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileDto } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { errorText } from '../../api/client';
import { Button, ErrorState, LoadingState, PageHeader, Section, Segmented, Spinner, TextArea } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { showToast, toastError } from '../../lib/toast';
import { ProfileEditor } from './ProfileEditor';
import { PreferencesEditor } from './PreferencesEditor';

export function ProfilePage() {
  const profile = useQuery({
    queryKey: qk.profile,
    queryFn: api.profile,
    // While the CV is being read, poll as a fallback to the live events.
    refetchInterval: (q) => (q.state.data?.deriveState === 'pending' ? 5000 : false),
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-4 p-3 sm:p-6">
        <PageHeader title="Profile" />
        {profile.isPending && <LoadingState label="Loading profile" />}
        {profile.isError && <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />}
        {profile.data && (
          <>
            <CvSection profile={profile.data} />
            <DeriveStatus profile={profile.data} />
            {profile.data.effective && <ProfileEditor key={profile.data.updatedAt ?? 'none'} profile={profile.data} />}
          </>
        )}
        <PreferencesEditor />
      </div>
    </div>
  );
}

function CvSection({ profile }: { profile: ProfileDto }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [text, setText] = useState('');
  const [edits, setEdits] = useState<'keep' | 'discard'>('keep');

  const upload = useMutation({
    mutationFn: () => (mode === 'file' && file ? api.uploadCv(file, edits) : api.pasteCv(text, edits)),
    onSuccess: (p) => {
      qc.setQueryData(qk.profile, p);
      void qc.invalidateQueries({ queryKey: qk.status });
      setFile(null);
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      showToast({ message: 'CV imported. The system now reads it.', tone: 'info' });
    },
    onError: (e) => toastError(errorText(e)),
  });

  const ready = mode === 'file' ? !!file : text.trim().length > 0;

  return (
    <Section
      title="CV"
      description={
        profile.hasCv
          ? `A CV is stored${profile.updatedAt ? `, updated ${relativeTime(profile.updatedAt)}` : ''}. Import a new one to replace it.`
          : 'Import your CV as a text-based PDF, a Markdown or text file, or paste the text. The system builds your profile from it.'
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) upload.mutate();
        }}
      >
        <Segmented
          label="Source"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'file', label: 'Upload a file' },
            { value: 'text', label: 'Paste text' },
          ]}
        />
        {mode === 'file' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="cv-file" className="text-[13px] font-medium">
              CV file
            </label>
            <input
              ref={fileRef}
              id="cv-file"
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[13px] file:mr-3 file:border file:border-line-strong file:bg-surface file:px-3 file:py-1 file:text-sm file:text-fg hover:file:bg-surface-2"
            />
            <p className="text-xs text-muted">At most 5 MB.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="cv-text" className="text-[13px] font-medium">
              CV text
            </label>
            <TextArea id="cv-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        {profile.hasEdits && (
          <Segmented
            label="Your profile edits"
            value={edits}
            onChange={setEdits}
            options={[
              { value: 'keep', label: 'Keep my edits' },
              { value: 'discard', label: 'Discard my edits' },
            ]}
          />
        )}
        {profile.cvText && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-muted">Show the stored CV text</summary>
            <pre className="mt-2 max-h-72 overflow-auto border border-line bg-surface-2 p-3 font-sans text-[13px] whitespace-pre-wrap">{profile.cvText}</pre>
          </details>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={!ready} busy={upload.isPending}>
            Import CV
          </Button>
        </div>
      </form>
    </Section>
  );
}

function DeriveStatus({ profile }: { profile: ProfileDto }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: api.derive,
    onSuccess: (p) => qc.setQueryData(qk.profile, p),
    onError: (e) => toastError(errorText(e)),
  });
  if (profile.deriveState === 'pending') {
    return (
      <div role="status" className="border border-line px-4 py-3 text-[13px]">
        <Spinner small label="The system reads your CV and builds your profile. This takes a minute or two." />
      </div>
    );
  }
  if (profile.deriveState === 'failed') {
    return (
      <div role="alert" className="border border-danger bg-danger-soft px-4 py-3 text-[13px]">
        <p className="font-medium text-danger">The profile could not be built from your CV.</p>
        {profile.deriveError && <p className="mt-1">{profile.deriveError}</p>}
        <Button size="sm" className="mt-2" onClick={() => retry.mutate()} busy={retry.isPending}>
          Try again
        </Button>
      </div>
    );
  }
  if (profile.hasCv && !profile.effective) {
    return (
      <div className="border border-line bg-surface px-4 py-3 text-[13px]">
        <p>No profile exists yet.</p>
        <Button size="sm" className="mt-2" onClick={() => retry.mutate()} busy={retry.isPending}>
          Build profile from CV
        </Button>
      </div>
    );
  }
  return null;
}
