// Scenario 3: swipe triage on a phone (OpenSpec change swipe-triage, task 3.2).
// Chrome emulates an iPhone-sized touch screen, and every swipe is a real touch sequence
// from Input.dispatchTouchEvent, so the browser's own touch-action and scrolling take part.
import { assert, assertEqual, sleep, until } from './driver.mjs';

const CARD_IDS = `[...document.querySelectorAll('[role=list] [data-row-button]')]
  .sort((a, b) => Number(a.dataset.rowButton) - Number(b.dataset.rowButton)).map((b) => b.id.slice(4))`;
const card = (id) => `document.getElementById(${JSON.stringify('row-' + id)})?.closest('[role=listitem]')`;
const cardBadge = (id, text) => `!!${card(id)} && [...${card(id)}.querySelectorAll('span')].some((s) => s.textContent.trim() === ${JSON.stringify(text)})`;
const toastWith = (text) => `[...document.querySelectorAll('[aria-live] [role=status]')].some((el) => el.textContent.includes(${JSON.stringify(text)}))`;
const DIALOG = 'document.querySelector("dialog[open]")';
/** The scroll position of the element that scrolls the list. */
const LIST_SCROLL = `(() => {
  let el = document.querySelector('[role=list]');
  while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement;
  return el ? el.scrollTop : -1;
})()`;

export async function runSwipe({ page, api, t, base }) {
  t.section('Scenario 3: swipe triage on a phone');

  const statusOf = async (id) => (await api.get(`/api/postings/${id}`)).triageStatus;
  const apiStatus = (id, expected) =>
    until(async () => (await statusOf(id)) === expected, { message: `GET /api/postings/${id} to return the status "${expected}"` });
  const allStatuses = async () => Object.fromEntries((await api.get('/api/postings?status=all&limit=50')).items.map((i) => [i.id, i.triageStatus]));

  /** The middle of a card on the screen. */
  const centerOf = async (id) => {
    await page.waitFor(`!!${card(id)}`, { message: `the card of posting ${id}` });
    return page.evaluate(`(() => { const r = ${card(id)}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  };

  /** One finger from `from` to `to` in small steps, as a person drags. */
  const touchDrag = async (from, to, steps = 12) => {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await sleep(16);
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const swipe = async (id, dx) => {
    const c = await centerOf(id);
    await touchDrag(c, { x: c.x + dx, y: c.y });
  };

  let first;
  let second;
  const ready = await t.check('setup: a 430x932 touch screen shows the default list', async () => {
    // The earlier scenarios may leave postings in other statuses. Every posting starts as new here.
    const others = (await api.get('/api/postings?status=all&limit=50')).items.filter((i) => i.triageStatus !== 'new');
    if (others.length) await api.post('/api/postings/restore', { previous: others.map((i) => ({ id: i.id, triageStatus: 'new' })) });
    assertEqual(Object.values(await allStatuses()).filter((s) => s !== 'new'), [], 'postings with another status than "new"');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.goto(`${base}/jobs`);
    await page.waitFor(`(${CARD_IDS}).length >= 3`, { message: 'the first cards of the default list' });
    [first, second] = await page.evaluate(CARD_IDS);
    assertEqual([await statusOf(first), await statusOf(second)], ['new', 'new'], 'statuses of the first two cards');
  });
  if (!ready) return;

  await t.check('swipe left on a new posting: dismissed, the card leaves, and the undo toast shows', async () => {
    await swipe(first, -220);
    await apiStatus(first, 'dismissed');
    await page.waitFor(`!${card(first)}`, { message: 'the dismissed card to leave the list' });
    await page.waitFor(toastWith('Dismissed'), { message: 'the undo toast' });
    assertEqual(await page.evaluate('new URLSearchParams(location.search).get("id")'), null, 'the posting opened by the swipe');
  });

  await t.check('swipe right on a new posting: saved, and the card stays with its badge', async () => {
    await swipe(second, 220);
    await apiStatus(second, 'saved');
    await page.waitFor(cardBadge(second, 'Saved'), { message: 'the Saved badge on the card' });
    await page.waitFor(toastWith('Saved'), { message: 'the undo toast' });
  });

  await t.check('swipe right on a saved posting: marked as applied, with an application in the first stage', async () => {
    await swipe(second, 220);
    await apiStatus(second, 'applied');
    const apps = await api.get('/api/applications');
    const app = apps.find((a) => a.postingId === second);
    assert(app, `an application for posting ${second} in GET /api/applications`);
    assertEqual(app.stage, 'applied', 'stage of the new application');
    await page.waitFor(`!${card(second)}`, { message: 'the applied card to leave the default list' });
  });

  await t.check('swipe left on an applied posting: a dialog asks, and Cancel keeps the application', async () => {
    await page.goto(`${base}/jobs?status=all`);
    await swipe(second, -220);
    await page.waitFor(`!!${DIALOG} && ${DIALOG}.textContent.includes('Remove the application?')`, { message: 'the removal dialog' });
    assertEqual(await page.evaluate('document.activeElement?.textContent.trim()'), 'Cancel', 'the focused button');
    await page.click(`[...${DIALOG}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')`);
    await page.waitFor(`!${DIALOG}`, { message: 'the dialog to close' });
    await sleep(300);
    assertEqual(await statusOf(second), 'applied', 'status after Cancel');
    assert((await api.get('/api/applications')).some((a) => a.postingId === second), 'the application after Cancel');
  });

  await t.check('a mostly vertical drag on a card scrolls the list and changes no status', async () => {
    await page.goto(`${base}/jobs`);
    await page.waitFor(`(${CARD_IDS}).length >= 3`, { message: 'the first cards of the default list' });
    const before = await allStatuses();
    const [id] = await page.evaluate(CARD_IDS);
    const c = await centerOf(id);
    const top = await page.evaluate(LIST_SCROLL);
    await touchDrag({ x: c.x + 10, y: c.y + 300 }, { x: c.x, y: c.y - 200 });
    await page.waitFor(`${LIST_SCROLL} > ${top + 100}`, { message: 'the list to scroll by the drag', timeout: 3000 });
    await sleep(400);
    assertEqual(await allStatuses(), before, 'statuses after the vertical drag');
  });

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
}
