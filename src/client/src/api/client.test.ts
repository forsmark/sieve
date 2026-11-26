import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiPath, errorText, joinBase, request } from './client';
import { api } from './endpoints';

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('path prefix', () => {
  it('sends API requests under the prefix the client was built for', async () => {
    vi.stubEnv('BASE_URL', '/sieve/');
    const fetchMock = stubFetch();
    await request('/api/status');
    expect(fetchMock).toHaveBeenCalledWith('/sieve/api/status', expect.anything());
  });

  it('puts download links under the prefix', () => {
    vi.stubEnv('BASE_URL', '/sieve/');
    expect(api.backupUrl('sieve-1.db')).toBe('/sieve/api/backups/sieve-1.db');
    expect(api.coverLetterPdfUrl('p1')).toBe('/sieve/api/postings/p1/cover-letter.pdf');
    expect(apiPath('/api/events')).toBe('/sieve/api/events');
  });

  it('sends API requests to the root without a prefix', async () => {
    vi.stubEnv('BASE_URL', '/');
    const fetchMock = stubFetch();
    await request('/api/status');
    expect(fetchMock).toHaveBeenCalledWith('/api/status', expect.anything());
    expect(joinBase('/', '/api/status')).toBe('/api/status');
  });
});

describe('errorText', () => {
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'onLine');
  });

  it('says the device is offline when a request reached no server while the device has no network', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = await request('/api/postings/bulk', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(errorText(err)).toBe('The device is offline.');
  });

  it('says the server cannot be reached when the device is online', () => {
    expect(errorText(new ApiRequestError(0, 'The server cannot be reached. Check that it is running.', null))).toBe(
      'The server cannot be reached. Check that it is running.',
    );
  });

  it('keeps the message of a server error while offline', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    expect(errorText(new ApiRequestError(500, 'Database is locked.', null))).toBe('Database is locked.');
  });
});
