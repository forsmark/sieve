// Scenario 2: full triage with the keyboard (OpenSpec task 8.8).
// Every key is a real key event. After each triage key the result is verified in the interface
// and through the server's API.
import { assert, assertEqual, until } from './driver.mjs';

/** The shortcuts that the help dialog must list. See src/client/src/features/jobs/ShortcutHelp.tsx. */
const HELP_KEYS = ['j', 'k', 'Arrow keys', 'Enter', 's', 'd', 'r', 'a', 'o', 'u', 'x', '/', '?', 'Escape'];

// ---- Page expressions

const CARD_IDS = `[...document.querySelectorAll('[role=list] [data-row-button]')]
  .sort((a, b) => Number(a.dataset.rowButton) - Number(b.dataset.rowButton)).map((b) => b.id.slice(4))`;
const CURSOR_INDEX = 'Number(document.querySelector(\'[role=listitem][aria-current="true"]\')?.dataset.index ?? -1)';
const FOCUSED_ROW = 'document.activeElement?.dataset?.rowButton === undefined ? null : Number(document.activeElement.dataset.rowButton)';
const DETAIL = 'document.querySelector(\'aside[aria-label="Posting details"]\')';
const DETAIL_TITLE = `${DETAIL}?.querySelector('h2')?.textContent.trim()`;
const URL_ID = 'new URLSearchParams(location.search).get("id")';
const HELP = 'document.querySelector("dialog[open]")';
const SELECTION_LABEL = 'document.querySelector(\'[role=list]\').previousElementSibling.querySelector("label span").textContent.trim()';
const card = (id) => `document.getElementById(${JSON.stringify('row-' + id)})?.closest('[role=listitem]')`;
const cardBadge = (id, text) => `!!${card(id)} && [...${card(id)}.querySelectorAll('span')].some((s) => s.textContent.trim() === ${JSON.stringify(text)})`;
const cardChecked = (id) => `${card(id)}?.querySelector('input[type=checkbox]')?.checked === true`;
const toastWith = (text) => `[...document.querySelectorAll('[aria-live] [role=status]')].some((el) => el.textContent.includes(${JSON.stringify(text)}))`;

export async function runKeyboardTriage({ page, api, t, base }) {
  t.section('Scenario 2: triage with the keyboard');

  /** The postings in the order of the default list: new and saved, best match first. */
  let ids = [];
  let titles = {};
  let columns = 0;

  const statusOf = async (id) => (await api.get(`/api/postings/${id}`)).triageStatus;
  const apiStatus = (id, expected) =>
    until(async () => (await statusOf(id)) === expected, { message: `GET /api/postings/${id} to return the status "${expected}"` });
  const listIds = async () => (await api.get('/api/postings?status=new,saved&sort=score&limit=50')).items.map((i) => i.id);
  const cursorAt = (index) =>
    page.waitFor(`${CURSOR_INDEX} === ${index} && ${FOCUSED_ROW} === ${index}`, { message: `the cursor and the focus on card ${index}` });
  const cardCount = (n) => page.waitFor(`(${CARD_IDS}).length === ${n}`, { message: `${n} cards in the list` });
  const allNew = async () => {
    const all = (await api.get('/api/postings?status=all&limit=50')).items;
    const changed = all.filter((i) => i.triageStatus !== 'new').map((i) => `${i.title}: ${i.triageStatus}`);
    assertEqual(changed, [], 'postings with another status than "new"');
  };

  const ready = await t.check('setup: the stub model scored all seeded postings', async () => {
    await until(
      async () => {
        const [status, list] = await Promise.all([api.get('/api/status'), api.get('/api/postings?status=all&limit=50')]);
        return status.queueTotal === 0 && list.items.length >= 12 && list.items.every((i) => i.match?.state === 'scored');
      },
      { timeout: 60_000, interval: 250, message: 'an empty task queue and a score for every posting' },
    );
    const list = await api.get('/api/postings?status=new,saved&sort=score&limit=50');
    ids = list.items.map((i) => i.id);
    titles = Object.fromEntries(list.items.map((i) => [i.id, i.title]));
    assertEqual(ids.length, 12, 'number of postings in the default list');
  });
  if (!ready) return;

  await t.check('list: /jobs shows the postings in the order of the API, with the cursor on the first card', async () => {
    await page.goto(base + '/jobs');
    await cardCount(12);
    assertEqual(await page.evaluate(CARD_IDS), ids, 'order of the cards');
    await page.waitFor(`${CURSOR_INDEX} === 0`, { message: 'the cursor on the first card' });
    columns = await page.evaluate(
      "new Set([...document.querySelectorAll('[role=list] [role=listitem]')].map((c) => Math.round(c.getBoundingClientRect().left))).size",
    );
    assert(columns >= 2 && columns < ids.length - 1, `the grid needs 2 or more columns and 2 or more rows for the arrow keys, it has ${columns} columns`);
  });

  // ---- Open and close

  await t.check('Enter: opens the detail of the current posting and marks it as read', async () => {
    await page.press('Enter');
    await page.waitFor(`${URL_ID} === ${JSON.stringify(ids[0])} && ${DETAIL_TITLE} === ${JSON.stringify(titles[ids[0]])}`, {
      message: `the detail panel of "${titles[ids[0]]}"`,
    });
    await until(async () => (await api.get(`/api/postings/${ids[0]}`)).unread === false, { message: 'GET /api/postings/:id to return unread: false' });
  });

  await t.check('Escape: closes the detail and returns the focus to the card', async () => {
    await page.press('Escape');
    await page.waitFor(`!${DETAIL} && ${URL_ID} === null`, { message: 'the detail panel to close' });
    await cursorAt(0);
  });

  // ---- Movement

  await t.check('j and k: move the cursor to the next and the previous posting', async () => {
    await page.press('j');
    await cursorAt(1);
    await page.press('j');
    await cursorAt(2);
    await page.press('k');
    await cursorAt(1);
  });

  await t.check('ArrowRight and ArrowLeft: move the cursor by one card', async () => {
    await page.press('ArrowRight');
    await cursorAt(2);
    await page.press('ArrowLeft');
    await cursorAt(1);
  });

  await t.check('ArrowDown and ArrowUp: move the cursor by one row of the grid', async () => {
    await page.press('ArrowDown');
    await cursorAt(1 + columns);
    await page.press('ArrowUp');
    await cursorAt(1);
    // A vertical step stops at the first row.
    await page.press('ArrowUp');
    await page.waitFor('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    await cursorAt(1);
  });

  await t.check('Enter on a focused card, then j and k: the open detail follows the cursor', async () => {
    await page.press('Enter');
    await page.waitFor(`${URL_ID} === ${JSON.stringify(ids[1])} && ${DETAIL_TITLE} === ${JSON.stringify(titles[ids[1]])}`, {
      message: `the detail panel of "${titles[ids[1]]}"`,
    });
    await page.press('j');
    await page.waitFor(`${URL_ID} === ${JSON.stringify(ids[2])} && ${DETAIL_TITLE} === ${JSON.stringify(titles[ids[2]])}`, {
      message: `the detail panel of "${titles[ids[2]]}" after j`,
    });
    await page.press('k');
    await page.waitFor(`${URL_ID} === ${JSON.stringify(ids[1])} && ${DETAIL_TITLE} === ${JSON.stringify(titles[ids[1]])}`, {
      message: `the detail panel of "${titles[ids[1]]}" after k`,
    });
    await page.press('Escape');
    await page.waitFor(`!${DETAIL} && ${URL_ID} === null`, { message: 'the detail panel to close' });
    await cursorAt(1);
  });

  // ---- Triage keys. The cursor is on card 1.

  await t.check('s: saves the current posting (card badge, message, and API)', async () => {
    await page.press('s');
    await page.waitFor(cardBadge(ids[1], 'Saved'), { message: 'the badge "Saved" on the card' });
    await page.waitFor(toastWith(`Saved “${titles[ids[1]]}”.`), { message: 'the message with the Undo button' });
    await apiStatus(ids[1], 'saved');
  });

  await t.check('u: undoes the save (badge gone, API status "new")', async () => {
    await page.press('u');
    await apiStatus(ids[1], 'new');
    await page.waitFor(`!!${card(ids[1])} && !(${cardBadge(ids[1], 'Saved')})`, { message: 'the badge "Saved" to go away' });
  });

  await t.check('d: dismisses the current posting (card leaves the list, API status "dismissed")', async () => {
    await page.press('d');
    await page.waitFor(`!${card(ids[1])}`, { message: 'the card to leave the list' });
    await cardCount(11);
    await page.waitFor(toastWith(`Dismissed “${titles[ids[1]]}”.`), { message: 'the message with the Undo button' });
    await apiStatus(ids[1], 'dismissed');
    assertEqual(
      await listIds(),
      ids.filter((id) => id !== ids[1]),
      'GET /api/postings after the dismissal',
    );
    // The cursor stays at its place, so it is now on the next posting.
    await page.waitFor(`${CURSOR_INDEX} === 1 && (${CARD_IDS})[1] === ${JSON.stringify(ids[2])}`, { message: 'the cursor on the next posting' });
  });

  await t.check('u: undoes the dismissal (card returns at its place, API status "new")', async () => {
    await page.press('u');
    await apiStatus(ids[1], 'new');
    await cardCount(12);
    assertEqual(await page.evaluate(CARD_IDS), ids, 'order of the cards after undo');
    assertEqual(await listIds(), ids, 'GET /api/postings after undo');
    await page.waitFor(`${CURSOR_INDEX} === 1`, { message: 'the cursor on card 1' });
  });

  await t.check('s then r: r restores a saved posting to "new"', async () => {
    await page.press('s');
    await page.waitFor(cardBadge(ids[1], 'Saved'), { message: 'the badge "Saved" on the card' });
    await apiStatus(ids[1], 'saved');
    await page.press('r');
    await page.waitFor(`!(${cardBadge(ids[1], 'Saved')})`, { message: 'the badge "Saved" to go away' });
    await page.waitFor(toastWith(`Restored “${titles[ids[1]]}”.`), { message: 'the message "Restored"' });
    await apiStatus(ids[1], 'new');
  });

  // ---- Selection

  await t.check('x: selects and unselects the current posting', async () => {
    await page.press('x');
    await page.waitFor(`${cardChecked(ids[1])} && ${SELECTION_LABEL} === "1 selected"`, { message: 'one selected posting' });
    await page.press('x');
    await page.waitFor(`!(${cardChecked(ids[1])}) && ${SELECTION_LABEL} === "Select all loaded"`, { message: 'no selected posting' });
  });

  await t.check('x, j, x, then s: a triage key acts on all selected postings', async () => {
    await page.press('x');
    await page.waitFor(cardChecked(ids[1]), { message: 'the first selected posting' });
    await page.press('j');
    await page.waitFor(`${CURSOR_INDEX} === 2`, { message: 'the cursor on card 2' });
    await page.press('x');
    await page.waitFor(`${cardChecked(ids[2])} && ${SELECTION_LABEL} === "2 selected"`, { message: 'two selected postings' });
    await page.press('s');
    await page.waitFor(`${cardBadge(ids[1], 'Saved')} && ${cardBadge(ids[2], 'Saved')}`, { message: 'the badge "Saved" on both cards' });
    await page.waitFor(toastWith('Saved 2 postings.'), { message: 'the message "Saved 2 postings."' });
    await apiStatus(ids[1], 'saved');
    await apiStatus(ids[2], 'saved');
    assertEqual(await statusOf(ids[3]), 'new', 'status of a posting that was not selected');
    await page.waitFor(`${SELECTION_LABEL} === "Select all loaded"`, { message: 'the selection to clear after the action' });
    await page.press('u');
    await apiStatus(ids[1], 'new');
    await apiStatus(ids[2], 'new');
    await page.waitFor(`!(${cardBadge(ids[1], 'Saved')}) && !(${cardBadge(ids[2], 'Saved')})`, { message: 'both badges to go away after undo' });
  });

  await t.check('x then Escape: Escape clears the selection', async () => {
    await page.press('x');
    await page.waitFor(`${SELECTION_LABEL} === "1 selected"`, { message: 'one selected posting' });
    await page.press('Escape');
    await page.waitFor(`${SELECTION_LABEL} === "Select all loaded"`, { message: 'the selection to clear' });
    await allNew();
  });

  // ---- Applied. The cursor is on card 2.

  await t.check('a: marks the current posting as applied (card leaves the list, application exists in the API)', async () => {
    await page.waitFor(`${CURSOR_INDEX} === 2`, { message: 'the cursor on card 2' });
    await page.press('a');
    await page.waitFor(`!${card(ids[2])}`, { message: 'the card to leave the list' });
    await page.waitFor(toastWith(`Marked as applied “${titles[ids[2]]}”.`), { message: 'the message "Marked as applied"' });
    await apiStatus(ids[2], 'applied');
    const applications = await api.get('/api/applications');
    assertEqual(
      applications.map((a) => [a.postingId, a.stage]),
      [[ids[2], 'applied']],
      'GET /api/applications',
    );
    await page.waitFor('!!document.querySelector(\'nav[aria-label="Main"] [aria-label="1 applications"]\')', {
      message: 'the count 1 beside "Board" in the navigation',
    });
  });

  await t.check('u: undoes "applied" (application removed, card returns)', async () => {
    await page.press('u');
    await apiStatus(ids[2], 'new');
    await until(async () => (await api.get('/api/applications')).length === 0, { message: 'GET /api/applications to return no application' });
    await cardCount(12);
    assertEqual(await page.evaluate(CARD_IDS), ids, 'order of the cards after undo');
  });

  // ---- Triage with the detail open

  await t.check('d with the detail open: dismisses the posting and the detail follows with the next one', async () => {
    await page.waitFor(`${CURSOR_INDEX} === 2`, { message: 'the cursor on card 2' });
    await page.press('Enter');
    await page.waitFor(`${URL_ID} === ${JSON.stringify(ids[2])} && ${DETAIL_TITLE} === ${JSON.stringify(titles[ids[2]])}`, {
      message: `the detail panel of "${titles[ids[2]]}"`,
    });
    await page.press('d');
    await page.waitFor(`${URL_ID} === ${JSON.stringify(ids[3])} && ${DETAIL_TITLE} === ${JSON.stringify(titles[ids[3]])}`, {
      message: `the detail panel of the next posting "${titles[ids[3]]}"`,
    });
    await apiStatus(ids[2], 'dismissed');
    await page.press('u');
    await apiStatus(ids[2], 'new');
    await cardCount(12);
    await page.press('Escape');
    await page.waitFor(`!${DETAIL} && ${URL_ID} === null`, { message: 'the detail panel to close' });
    await allNew();
  });

  // ---- Help

  await t.check('?: opens the shortcut help, and it lists every shortcut', async () => {
    await page.press('?');
    await page.waitFor(`${HELP}?.querySelector('h2')?.textContent.trim() === "Keyboard shortcuts"`, { message: 'the dialog "Keyboard shortcuts"' });
    assertEqual(await page.evaluate(`[...${HELP}.querySelectorAll('dt')].map((d) => d.textContent.trim())`), HELP_KEYS, 'keys in the help dialog');
  });

  await t.check('help open: a triage key does nothing, and ? closes the help', async () => {
    await page.press('d');
    await page.press('?');
    await page.waitFor(`!${HELP}`, { message: 'the help dialog to close' });
    await cardCount(12);
    await allNew();
  });

  await t.check('? then Escape: Escape closes the help', async () => {
    await page.press('?');
    await page.waitFor(`!!${HELP}`, { message: 'the help dialog to open' });
    await page.press('Escape');
    await page.waitFor(`!${HELP}`, { message: 'the help dialog to close' });
  });

  // ---- Search

  await t.check('/: moves the focus to the search field and types no character', async () => {
    await page.press('/');
    await page.waitFor('document.activeElement?.id === "job-search"', { message: 'the focus in the search field' });
    assertEqual(await page.evaluate('document.querySelector("#job-search").value'), '', 'text in the search field');
  });

  await t.check('search field: letters are text and not shortcuts, and the list follows the search', async () => {
    // The word contains the triage keys d, a, and s.
    await page.typeKeys('database');
    await page.waitFor('document.querySelector("#job-search").value === "database"', { message: 'the typed text in the search field' });
    const expected = (await api.get('/api/postings?status=new,saved&sort=score&limit=50&q=database')).items.map((i) => i.id);
    assertEqual(expected.length, 1, 'number of postings that the API finds for "database"');
    await page.waitFor(`JSON.stringify(${CARD_IDS}) === ${JSON.stringify(JSON.stringify(expected))}`, { message: 'the list to show only the found posting' });
    await allNew();
    await page.press('Escape');
    await page.waitFor('document.activeElement?.id !== "job-search"', { message: 'the focus to leave the search field' });
  });

  await t.check('o: opens the source link of the current posting in a new tab', async () => {
    const [found] = (await api.get('/api/postings?status=new,saved&sort=score&limit=50&q=database')).items;
    await page.waitFor(`${CURSOR_INDEX} === 0`, { message: 'the cursor on the found posting' });
    const before = page.openedTargets.length;
    await page.press('o');
    const opened = await until(() => page.openedTargets.slice(before).find((tab) => tab.url === found.url), {
      message: `a new tab with the address ${found.url}`,
    });
    await page.closeTarget(opened.targetId);
    await allNew();
  });
}
