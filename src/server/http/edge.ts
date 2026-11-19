import type { MiddlewareHandler } from 'hono';
import { config } from '../config';
import { log } from '../kernel/logger';

/** Paths the platform and home screens fetch without a portal session. */
export const EDGE_PUBLIC_PATHS = new Set(['/healthz', '/icon.png']);

let allowedUserOverride: string | null | undefined;

/** Tests set the allowed user without an environment variable. */
export function setAllowedUserForTests(user: string | null | undefined): void {
  allowedUserOverride = user;
}

export function allowedGatewayUser(): string | null {
  return allowedUserOverride !== undefined ? allowedUserOverride : config.edgeAllowedUser;
}

/**
 * Behind the olympus-edge gateway every portal user reaches the app. When an allowed user is configured,
 * only requests whose `X-User` names that user pass. The gateway sets the header and strips client copies.
 */
export function gatewayUserCheck(): MiddlewareHandler {
  return async (c, next) => {
    const allowed = allowedGatewayUser();
    if (allowed === null || EDGE_PUBLIC_PATHS.has(c.req.path)) return next();
    const user = c.req.header('X-User');
    if (user === allowed) return next();
    // The path and the query stay out of the log.
    log('warn', `refused a request from gateway user ${user === undefined ? '(none)' : JSON.stringify(user)}`);
    return c.text('This app belongs to another user.', 403);
  };
}
