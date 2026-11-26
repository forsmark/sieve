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

describe('keepalive', () => {
  it('lets a request outlive the page when the caller asks and the body is small', async () => {
    const fetchMock = stubFetch();
    await request('/api/applications/1', { method: 'PATCH', body: { notes: 'Call back on Monday.' }, keepalive: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/applications/1', expect.objectContaining({ keepalive: true }));
  });

  it('sends a large body without keepalive, which browsers refuse above 64 KB', async () => {
    const fetchMock = stubFetch();
    await request('/api/applications/1', { method: 'PATCH', body: { notes: 'x'.repeat(70_000) }, keepalive: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/applications/1', expect.objectContaining({ keepalive: false }));
  });

  it('counts the body in bytes, so a body of fewer characters but more than 64 KB goes without keepalive', async () => {
    const fetchMock = stubFetch();
    // 40,000 characters of two bytes each in UTF-8.
    await request('/api/applications/1', { method: 'PATCH', body: { notes: 'ø'.repeat(40_000) }, keepalive: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/applications/1', expect.objectContaining({ keepalive: false }));
  });

  it('sends the request again without keepalive when the browser refuses keepalive', async () => {
    // Browsers share one 64 KB keepalive budget across the requests in flight, and refuse a request beyond it.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.keepalive) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/api/applications/1', { method: 'PATCH', body: { notes: 'Call back.' }, keepalive: true })).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map(([, init]) => init.keepalive)).toEqual([true, false]);
  });

  it('tries a failed request once more only when it went with keepalive', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const withKeepalive = await request('/api/applications/1', { method: 'PATCH', body: {}, keepalive: true }).catch((e: unknown) => e);
    expect(withKeepalive).toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    await request('/api/status').catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends no keepalive unless the caller asks', async () => {
    const fetchMock = stubFetch();
    await request('/api/status');
    expect(fetchMock).toHaveBeenCalledWith('/api/status', expect.objectContaining({ keepalive: false }));
  });
});
