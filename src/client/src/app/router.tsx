import { Link, createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect, type RouterHistory } from '@tanstack/react-router';
import { RootLayout } from './Layout';
import { JobsPage } from '../features/jobs/JobsPage';
import { LoadingState } from '../components/ui';
import { parseJobSearch, parseSearchString, stringifySearchObject } from '../features/jobs/filters';

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="p-8 text-center">
      <p className="font-medium">This page does not exist.</p>
      <Link className="mt-2 inline-block font-medium underline decoration-accent decoration-2 hover:decoration-fg" to="/jobs">
        Go to jobs
      </Link>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/jobs' });
  },
});

export const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs',
  validateSearch: (raw: Record<string, unknown>) => parseJobSearch(raw),
  component: JobsPage,
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/board',
  validateSearch: (raw: Record<string, unknown>): { app?: string } => (typeof raw.app === 'string' && raw.app ? { app: raw.app } : {}),
  component: lazyRouteComponent(() => import('../features/board/BoardPage'), 'BoardPage'),
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: lazyRouteComponent(() => import('../features/profile/ProfilePage'), 'ProfilePage'),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('../features/settings/SettingsPage'), 'SettingsPage'),
});
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  component: lazyRouteComponent(() => import('../features/activity/ActivityPage'), 'ActivityPage'),
});

const routeTree = rootRoute.addChildren([indexRoute, jobsRoute, boardRoute, profileRoute, settingsRoute, activityRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    // The path prefix of this build, for example `/sieve` behind the olympus-edge portal.
    basepath: import.meta.env.BASE_URL.replace(/\/+$/, '') || '/',
    // Plain `key=value` search parameters, so `/jobs?id=abc` from a notification works and URLs stay readable.
    parseSearch: parseSearchString,
    stringifySearch: stringifySearchObject,
    defaultPreload: 'intent',
    defaultPendingComponent: () => <LoadingState />,
    scrollRestoration: false,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
