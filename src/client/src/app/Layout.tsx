import { Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/endpoints';
import { qk } from '../api/keys';
import { useServerEvents } from '../api/events';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { Toaster } from '../lib/toast';
import { LoginScreen } from './Login';
import { StatusBar } from './StatusBar';
import { PHONE_QUERY } from './media';
import { useLogout } from './actions';
import { useMediaQuery } from '../lib/useMediaQuery';
import { FirstRunGuide } from './FirstRunGuide';

const NAV = [
  { to: '/jobs', label: 'Jobs' },
  { to: '/board', label: 'Board' },
  { to: '/profile', label: 'Profile' },
  { to: '/settings', label: 'Settings' },
  { to: '/activity', label: 'Activity' },
] as const;

export function RootLayout() {
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.me, staleTime: Infinity });
  const allowed = auth.data ? !auth.data.authRequired || auth.data.authenticated : false;
  useServerEvents(allowed);

  if (auth.isPending) return <LoadingState label="Starting" />;
  if (auth.isError) {
    return (
      <main className="mx-auto max-w-lg pt-16">
        <ErrorState title="The server cannot be reached." error={auth.error} onRetry={() => void auth.refetch()} />
      </main>
    );
  }
  if (!allowed) return <LoginScreen />;
  return <Shell authRequired={auth.data.authRequired} />;
}

function Shell({ authRequired }: { authRequired: boolean }) {
  const status = useQuery({ queryKey: qk.status, queryFn: api.status, refetchInterval: 60_000 });
  const logout = useLogout();
  // Below 640px the top bar has no room for "Log out". It stands in the Account section of Settings.
  const phone = useMediaQuery(PHONE_QUERY);
  const counts = status.data?.counts;

  return (
    // The sides keep clear of the notch and the rounded corners in landscape, opened from the home screen.
    <div className="flex h-dvh flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-[calc(0.5rem+env(safe-area-inset-top))] focus:left-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:font-semibold focus:text-on-accent"
      >
        Skip to content
      </a>
      {/* Opened from the home screen, the page runs under the device's status bar. The top bar keeps its 56px below it. */}
      <header className="box-content flex h-14 shrink-0 items-stretch pt-[env(safe-area-inset-top)] gap-2.5 border-b border-fg px-3 sm:gap-8 sm:px-6">
        <Link to="/jobs" className="flex items-center text-xl leading-none font-extrabold tracking-tight sm:text-2xl" aria-label="sieve, go to jobs">
          sieve
        </Link>
        <nav aria-label="Main" className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto sm:gap-6">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="relative flex items-center border-b-2 border-transparent pt-0.5 text-[13px] font-medium whitespace-nowrap text-muted hover:text-fg sm:text-sm"
              activeProps={{ className: 'text-fg border-b-accent!', 'aria-current': 'page' }}
            >
              {n.label}
              {n.to === '/jobs' && counts && counts.unread > 0 && (
                <span className="tabular ml-1 bg-fg px-1 text-xs font-bold text-bg" aria-label={`${counts.unread} unread`}>
                  {counts.unread}
                </span>
              )}
              {n.to === '/board' && counts && counts.openApplications > 0 && (
                <span className="tabular ml-1 bg-field-pink px-1 text-xs font-bold text-ink" aria-label={`${counts.openApplications} open applications`}>
                  {counts.openApplications}
                </span>
              )}
            </Link>
          ))}
        </nav>
        {authRequired && !phone && (
          <Button size="sm" variant="ghost" className="self-center" onClick={() => logout.mutate()} busy={logout.isPending}>
            Log out
          </Button>
        )}
      </header>
      {status.data && <FirstRunGuide status={status.data} />}
      <main id="main" className="relative min-h-0 flex-1 overflow-clip">
        <Outlet />
      </main>
      {/* Toasts sit just above the status bar, whose height changes with the width and the device's safe area. */}
      <div className="relative shrink-0">
        <Toaster />
        <StatusBar status={status} />
      </div>
    </div>
  );
}
