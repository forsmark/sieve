// Scenario 1: first start and CV import (OpenSpec task 8.10).
// The user follows the "Getting started" guide: imports a CV as pasted text, sees the derived profile,
// adds a search term, and the guide goes away.
import { readFileSync } from 'node:fs';
import { assert, assertEqual } from './driver.mjs';

const CV_MARKER = 'Synthetic CV 7f3a for the end-to-end test';
const CV_TEXT = [
  CV_MARKER,
  'Robin Example, platform engineer',
  '',
  'Experience',
  '2019 to now: Platform Engineer at Stubworks. Builds test doubles with Fakelang and TypeScript.',
  '2016 to 2019: Developer at Sample Company. Built web applications.',
  '',
  'Languages: English',
].join('\n');

/** The values that e2e/bin/claude returns. */
const STUB_HEADLINE = 'Stub platform engineer from the fake claude command';
const STUB_SKILL = 'Fakelang';
const SEARCH_TERM = 'platform engineer';

const GUIDE = 'document.querySelector(\'aside[aria-label="Getting started"]\')';
const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.trim() === ${JSON.stringify(text)})`;
const toastWith = (text) => `[...document.querySelectorAll('[aria-live] [role=status], [aria-live] [role=alert]')].some((el) => el.textContent.includes(${JSON.stringify(text)}))`;

export async function runFirstStart({ page, api, t, base, claudeLog }) {
  t.section('Scenario 1: first start and CV import');

  await t.check('first start: the "Getting started" guide shows with both steps open', async () => {
    await page.goto(base + '/');
    await page.waitFor(`!!${GUIDE}`, { message: 'the "Getting started" guide' });
    const links = await page.evaluate(`[...${GUIDE}.querySelectorAll('a')].map((a) => a.textContent.trim())`);
    assertEqual(links, ['Add your CV', 'Add search terms'], 'open steps in the guide');
    const status = await api.get('/api/status');
    assertEqual({ hasCv: status.hasCv, searchTermCount: status.searchTermCount }, { hasCv: false, searchTermCount: 0 }, 'GET /api/status');
  });

  await t.check('guide: the link "Add your CV" opens the Profile page', async () => {
    await page.click(byText(`aside[aria-label="Getting started"] a`, 'Add your CV'));
    await page.waitFor('location.pathname === "/profile" && !!document.querySelector("#cv-file")', { message: 'the Profile page with the CV section' });
  });

  await t.check('profile: a pasted CV text can be imported', async () => {
    await page.click(byText('fieldset label', 'Paste text'));
    await page.click('document.querySelector("#cv-text")');
    await page.waitFor('document.activeElement?.id === "cv-text"', { message: 'focus in the CV text field' });
    await page.insertText(CV_TEXT);
    await page.waitFor(`document.querySelector("#cv-text").value.includes(${JSON.stringify(CV_MARKER)})`, { message: 'the pasted text in the field' });
    await page.click(byText('button[type=submit]', 'Import CV'));
    await page.waitFor(toastWith('CV imported'), { message: 'the message "CV imported"' });
  });

  await t.check('profile: the derived profile shows the headline and a skill from the fake claude command', async () => {
    // The digest is a queued task. The page shows a status line until the profile exists.
    await page.waitFor(
      `[...document.querySelectorAll('input')].some((i) => i.value === ${JSON.stringify(STUB_HEADLINE)})`,
      { timeout: 20_000, message: 'the derived headline in the profile editor' },
    );
    const skill = await page.evaluate('document.querySelector(\'[aria-label="Skill 1 name"]\')?.value');
    assertEqual(skill, STUB_SKILL, 'first skill in the profile editor');
  });

  await t.check('API: the profile is stored with the CV text and the derived data', async () => {
    const profile = await api.get('/api/profile');
    assert(profile.hasCv, 'GET /api/profile: hasCv is false');
    assert(profile.cvText.includes(CV_MARKER), 'GET /api/profile: the stored CV text does not contain the pasted text');
    assertEqual(profile.deriveState, 'idle', 'deriveState');
    assertEqual(profile.derived?.headline, STUB_HEADLINE, 'derived headline');
    assertEqual(profile.effective?.skills.map((s) => s.name), [STUB_SKILL, 'TypeScript'], 'effective skills');
  });

  await t.check('server: the CV digest ran the claude command with the CV text on standard input', async () => {
    const calls = readFileSync(claudeLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const digest = calls.filter((c) => c.isProfile);
    assert(digest.length >= 1, 'the fake claude command got no candidate profile call');
    assert(digest[0].prompt.includes(CV_MARKER), 'the prompt of the claude command does not contain the CV text');
    assertEqual(digest[0].outputFormat, 'json', '--output-format');
  });

  await t.check('guide: step 1 is done and step 2 is still open', async () => {
    await page.waitFor(`!!${GUIDE} && ${GUIDE}.querySelectorAll('a').length === 1`, { message: 'one open step in the guide' });
    const text = await page.evaluate(`${GUIDE}.textContent`);
    assert(text.includes('Add your CV (done)'), `the guide does not mark the CV step as done: ${text}`);
    const links = await page.evaluate(`[...${GUIDE}.querySelectorAll('a')].map((a) => a.textContent.trim())`);
    assertEqual(links, ['Add search terms'], 'open steps in the guide');
  });

  await t.check('guide: the link "Add search terms" opens the Settings page', async () => {
    await page.click(byText(`aside[aria-label="Getting started"] a`, 'Add search terms'));
    await page.waitFor('location.pathname === "/settings" && !!document.querySelector("#new-term")', { message: 'the Settings page with the search section' });
  });

  await t.check('settings: a search term can be added and saved', async () => {
    await page.click('document.querySelector("#new-term")');
    await page.waitFor('document.activeElement?.id === "new-term"', { message: 'focus in the search term field' });
    await page.insertText(SEARCH_TERM);
    await page.press('Enter');
    await page.waitFor(
      `[...document.querySelectorAll('ul[aria-label="Search terms"] li')].some((li) => li.textContent.trim() === ${JSON.stringify(SEARCH_TERM)})`,
      { message: 'the new term in the list of search terms' },
    );
    await page.click(byText('button', 'Save search'));
    await page.waitFor(toastWith('Search saved'), { message: 'the message "Search saved"' });
    const search = await api.get('/api/search');
    assertEqual(search.terms, [SEARCH_TERM], 'GET /api/search terms');
  });

  await t.check('guide: it is gone after the CV and a search term exist', async () => {
    await page.waitFor(`!${GUIDE}`, { message: 'the "Getting started" guide to go away' });
    const status = await api.get('/api/status');
    assertEqual({ hasCv: status.hasCv, searchTermCount: status.searchTermCount }, { hasCv: true, searchTermCount: 1 }, 'GET /api/status');
    // The guide also stays away after a reload.
    await page.goto(base + '/jobs');
    // The unread count in the navigation comes from the same status request as the guide.
    await page.waitFor('!!document.querySelector(\'nav[aria-label="Main"] [aria-label$="unread"]\')', { message: 'the loaded status after a reload' });
    assert(!(await page.evaluate(`!!${GUIDE}`)), 'the guide shows again after a reload');
  });
}
