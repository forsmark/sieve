import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/endpoints';
import { errorText } from '../api/client';
import { Button, Field, TextInput } from '../components/ui';

export function LoginScreen() {
  const [password, setPassword] = useState('');
  const qc = useQueryClient();
  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: async () => {
      setPassword('');
      await qc.invalidateQueries();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) login.mutate();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-xs border-t border-fg pt-5" aria-labelledby="login-title">
        <h1 id="login-title" className="text-5xl leading-none font-extrabold tracking-tight">
          sieve
        </h1>
        <p className="mt-3 text-[13px] text-muted">Enter the password to continue.</p>
        <Field label="Password" className="mt-4">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={login.isError || undefined}
              aria-describedby={login.isError ? 'login-error' : undefined}
            />
          )}
        </Field>
        {login.isError && (
          <p id="login-error" role="alert" className="mt-2 text-[13px] text-danger">
            {errorText(login.error)}
          </p>
        )}
        <Button type="submit" variant="primary" className="mt-4 w-full" busy={login.isPending} disabled={!password}>
          Log in
        </Button>
      </form>
    </main>
  );
}
