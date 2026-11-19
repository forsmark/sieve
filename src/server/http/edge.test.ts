import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAll } from '../testing/helpers';
import { createApp } from './app';
import { setPasswordForTests } from './auth';
import { setAllowedUserForTests } from './edge';

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await resetAll();
  setPasswordForTests(undefined);
  setAllowedUserForTests(undefined);
  app = createApp();
});

afterEach(() => {
  setAllowedUserForTests(undefined);
});

describe('edge hosting', () => {
  it('answers /healthz without a session and without a gateway user', async () => {
    setAllowedUserForTests('Marc');
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
  });

  it('serves the icon as a PNG without a session and without a gateway user', async () => {
    setAllowedUserForTests('Marc');
    const res = await app.request('/icon.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('handles a request from the allowed gateway user as usual', async () => {
    setAllowedUserForTests('Marc');
    const res = await app.request('/api/status', { headers: { 'X-User': 'Marc' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authRequired: false });
  });

  it('refuses a request from another gateway user with 403 and no data', async () => {
    setAllowedUserForTests('Marc');
    const res = await app.request('/api/status', { headers: { 'X-User': 'Nemo' } });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('counts');
  });

  it('refuses a request without a gateway user header with 403 and no data', async () => {
    setAllowedUserForTests('Marc');
    const res = await app.request('/api/status');
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('counts');
  });

  it('handles a request without a gateway user as before when no allowed user is configured', async () => {
    const res = await app.request('/api/status');
    expect(res.status).toBe(200);
  });
});
