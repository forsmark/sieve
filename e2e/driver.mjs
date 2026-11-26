// A small browser driver for the end-to-end tests.
// It starts headless Chrome and talks to it over the DevTools protocol with Node's global WebSocket and fetch.
// No test library and no downloaded browser are needed.
import { spawn } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns a truthy value. Throws an error with `message` after `timeout` milliseconds. */
export async function until(fn, { timeout = 5000, interval = 50, message = 'the condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  let lastError;
  for (;;) {
    try {
      last = await fn();
      lastError = undefined;
      if (last) return last;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= end) break;
    await sleep(interval);
  }
  const seen = lastError ? ` Last error: ${lastError.message}` : last !== undefined ? ` Last value: ${JSON.stringify(last)}` : '';
  throw new Error(`Timed out after ${timeout} ms while waiting for ${message}.${seen}`);
}

// ---- Check reporter: one line for each check

export function createReporter() {
  const results = [];
  return {
    results,
    /** Runs one check. The check fails when `fn` throws. A failure does not stop the later checks. */
    async check(name, fn) {
      const start = Date.now();
      try {
        await fn();
        results.push({ name, ok: true });
        console.log(`PASS  ${name} (${Date.now() - start} ms)`);
        return true;
      } catch (err) {
        results.push({ name, ok: false, error: err.message });
        console.log(`FAIL  ${name}: ${err.message}`);
        return false;
      }
    },
    section(title) {
      console.log(`\n== ${title}`);
    },
    get failed() {
      return results.filter((r) => !r.ok);
    },
  };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

// ---- Keys for Input.dispatchKeyEvent

const SPECIAL_KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Escape: { code: 'Escape', vk: 27 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  '/': { code: 'Slash', vk: 191, text: '/' },
  '?': { code: 'Slash', vk: 191, text: '?', shift: true },
};

function keyInfo(key) {
  const special = SPECIAL_KEYS[key];
  if (special) return { key, ...special };
  if (/^[a-z]$/.test(key)) return { key, code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0), text: key };
  throw new Error(`The driver does not know the key "${key}".`);
}

// ---- Browser

/**
 * Starts headless Chrome and connects to its first page.
 * `close()` stops the browser. The caller removes the user data directory.
 */
export async function launchBrowser({ port, userDataDir, width = 1440, height = 900 }) {
  const chrome = spawn(
    process.env.E2E_CHROME ?? 'google-chrome',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--metrics-recording-only',
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let spawnError = null;
  chrome.on('error', (err) => (spawnError = err));

  let target;
  try {
    target = await until(
      async () => {
        if (spawnError || chrome.exitCode !== null) return { stopped: true };
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        return list.find((t) => t.type === 'page');
      },
      { timeout: 15_000, interval: 150, message: `Chrome to open its debugging port ${port}` },
    );
    if (target.stopped) {
      // One known cause: a long TMPDIR. Chrome puts a socket there, and a socket path has a length limit.
      throw new Error(`Chrome did not start: ${spawnError?.message ?? `it stopped with exit code ${chrome.exitCode}`}. Check the browser command and TMPDIR.`);
    }
  } catch (err) {
    chrome.kill('SIGKILL');
    throw err;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('The DevTools connection failed.'));
  });

  let nextId = 0;
  const pending = new Map();
  /** Uncaught exceptions, console errors, and failed HTTP responses of the page. */
  const problems = [];
  /** Pages that the application opened with window.open. */
  const openedTargets = [];

  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push(`exception: ${d.exception?.description ?? d.text}`.slice(0, 300));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push(`console error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 300));
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      problems.push(`http ${msg.params.response.status} ${msg.params.response.url}`);
    }
    if (msg.method === 'Target.targetCreated' && msg.params.targetInfo.type === 'page' && msg.params.targetInfo.targetId !== target.id) {
      openedTargets.push(msg.params.targetInfo);
    }
    if (msg.method === 'Target.targetInfoChanged') {
      const known = openedTargets.find((t) => t.targetId === msg.params.targetInfo.targetId);
      if (known) Object.assign(known, msg.params.targetInfo);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Target.setDiscoverTargets', { discover: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  /** Evaluates a JavaScript expression in the page and returns its JSON value. Promises are awaited. */
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`Page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }

  /** Waits until the expression is truthy in the page. Returns its value. */
  function waitFor(expression, { timeout = 5000, message = expression } = {}) {
    return until(() => evaluate(expression), { timeout, message });
  }

  async function goto(url) {
    await send('Page.navigate', { url });
    await waitFor('document.readyState === "complete"', { timeout: 15_000, message: `${url} to load` });
  }

  /**
   * Clicks the element that the expression returns, with real mouse events at its center.
   * The expression is JavaScript, for example `document.querySelector("#save")`.
   */
  async function click(elementExpression, { timeout = 5000, message = elementExpression } = {}) {
    const point = await until(
      () =>
        evaluate(`(() => {
          const el = ${elementExpression};
          if (!el || el.disabled) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return null;
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`),
      { timeout, message: `a clickable element: ${message}` },
    );
    const base = { x: point.x, y: point.y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }

  /** Presses one key with real key events. Known keys: a to z, Enter, Escape, the arrow keys, "/" and "?". */
  async function press(key) {
    const k = keyInfo(key);
    const common = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.shift ? 8 : 0 };
    await send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...common, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  /** Inserts text into the focused field, as a paste does. */
  async function insertText(text) {
    await send('Input.insertText', { text });
  }

  /** Types letters one key at a time, so key handlers see each letter. */
  async function typeKeys(text) {
    for (const ch of text) await press(ch);
  }

  async function closeTarget(targetId) {
    await send('Target.closeTarget', { targetId }).catch(() => {});
  }

  async function close() {
    try {
      ws.close();
    } catch {
      // The browser stops below in every case.
    }
    if (chrome.exitCode === null) {
      const exited = new Promise((r) => chrome.once('exit', r));
      chrome.kill('SIGTERM');
      await Promise.race([exited, sleep(3000)]);
      if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
    }
  }

  return { send, evaluate, waitFor, goto, click, press, insertText, typeKeys, closeTarget, close, problems, openedTargets, pid: chrome.pid };
}

/** A JSON client for the server's own API. The tests use it to verify what the interface shows. */
export function createApi(base) {
  async function request(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text.slice(0, 200)}`);
    return data;
  }
  return {
    get: (path) => request('GET', path),
    put: (path, body) => request('PUT', path, body),
    post: (path, body) => request('POST', path, body),
  };
}
