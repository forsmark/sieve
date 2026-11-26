# Proposal

## Why

A UX audit of sieve on an iPhone-sized screen (2026-11-26) found 7 major, 15 minor and 11 polish problems. Controls are sized for a mouse, the fixed bands take a third of the screen, the triage actions scroll away, and notes are lost without warning. Safari on iOS also zooms the page when a field gets focus, because every form control uses 14px text. The owner confirmed the zoom on the phone. The owner asked to fix every finding.

## What Changes

The finding IDs are those of the audit (M = major, m = minor, p = polish).

**Triage on a phone**
- M1: Below 1024px width, the detail view keeps Save, Dismiss or Restore, and "Mark as applied" in a bar fixed to its bottom edge, in 44px buttons.
- M3: The undo message gets a 44px Undo button and a 44px close button, 16px apart. After the message closes, the job list shows an Undo control for the latest triage action, the same action the `u` key undoes.
- m4: When a triage action made the detail view move on to the next posting, its undo shows the earlier posting in the detail view again.
- p9: The next posting that the detail view opens by itself after a triage action is marked read only after it stays open for 1.5 seconds.

**Sizes and text on touch screens**
- M2: On a touch screen (coarse pointer), every button, input, select, chip, summary row, switch and text link in a panel header has a hit area of at least 44 by 44px.
- iOS zoom: on a touch screen, inputs, selects and text areas use 16px text, so Safari does not zoom.
- p7: The foot of a job card uses 13px text.
- p1: Keyboard hints are hidden on touch screens. The `?` key still opens the shortcut list.

**Layout of the bands**
- M4: Below 640px width, the status bar shows one line of status. A tap on it opens the Activity page, which gains "Fetch now" and "Pause matching" buttons in its header at every width.
- M5: Below 640px width, the filters open as a full-screen sheet with a "Show N postings" button, and the sheet never opens by itself on load.
- M6: Below 640px width, the bulk actions sit in a 44px bar at the bottom of the list, with Save, Dismiss, Applied and a "More" menu. Clear stands beside the selection count.
- m10: Below 640px width, "Log out" moves from the top bar to the Settings page.
- Standalone mode: when sieve is opened from the home screen, the top bar and the sides keep clear of the notch and the status bar.

**Board and applications**
- M7: Notes and the interview date are stored without a save button: notes when the field loses focus and when the application closes, and the date when it changes. When a store fails, the typed text comes back when the application opens again.
- m5: A stage change shows "Moved to <stage>" with Undo.
- p2: The board page is titled "Board", as in the navigation.
- p3: The pink count beside "Board" counts open applications (applied, interview, offer).

**Detail view**
- m2: When the mosaic is narrower than 768px, "Facts" and "Description" come before the cover letter and the match analysis.
- m3: The cover letter field grows with its text, so only the panel scrolls.
- p4: An empty "Missing skills" tile shrinks to one line.
- p5: A failed letter or analysis shows a plain sentence first, with the technical error below it in small text.

**Focus and accessibility**
- m1: On narrow screens, focus moves into the detail view when the posting loads, and the list behind it is inert.
- m12: The shortcut dialog returns focus to the control that opened it, and a tap on its backdrop closes it.
- m13: Closing the detail view moves focus to the card of the posting it showed. A focus that comes from Tab no longer moves the keyboard cursor while a posting is open. A skip link leads from the list into the open posting.
- m14: The job list has a heading. Each page has its own document title, and an open posting puts its title first.
- m15: The strong hairline gets lighter, from #6e6f75 to #76777d, so control borders reach 3:1.
- p10: A card's accessible name starts with the posting title.

**Other screens**
- m6: The select-all checkbox shows its mixed state, and a tap on it in that state clears the selection.
- m7: Below 640px width, the profile weights and skill rows stack, so the Profile page fits at 375px.
- m8: Below 640px width, each fetch run on the Activity page takes two lines instead of a wide table.
- m9: The weight sliders get the look of DESIGN.md: a square yellow thumb on a hairline track, in a 44px row.
- m11: Offline, the status bar says so, and an action fails with a message instead of a spinner that never ends.
- p6: The skill rows get a header row: Skill, Level, Years.
- p8: The page gets a home-screen icon and the web-app meta tags.
- p11: The schedule switch reads "Fetch on a schedule", and it is on while fetching runs on its schedule.

DESIGN.md changes with these rules: a touch-size rule, the status bar and bulk bar on a phone, the filter sheet, the detail action bar, the slider, the strong hairline value, the mosaic order, and the card foot size.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-browsing`:
  - *Unread tracking*: a delay before an auto-opened posting is marked read.
  - *Bulk actions*: the mixed state of select-all.
  - *Keyboard operation*: focus returns to the card.
  - New: *Undo after the message*, *Undo returns to the posting*, *Offline state*.
- `application-tracking`:
  - *Notes and dates*: stored without a save step, and kept when a store fails.
  - New: *Stage change feedback*, with undo.

## Impact

- Client only, apart from one server field: the status counts gain the number of open applications for p3.
- Client files:
  - the shared controls in `components/ui.tsx`, `styles.css` and `lib/toast.tsx`;
  - `app/Layout.tsx` and `app/StatusBar.tsx`;
  - the jobs feature: `JobsPage.tsx`, `DetailPanel.tsx`, `FilterBar.tsx`, `JobRow.tsx`, `useTriage.ts`, `CoverLetter.tsx`, `MatchAnalysis.tsx` and `ShortcutHelp.tsx`;
  - the board feature: `BoardPage.tsx`, `ApplicationPanel.tsx` and `stages.ts`;
  - the profile, settings and activity pages;
  - `index.html`.
- DESIGN.md and the e2e coverage map change too.
- No new dependency.

## Claims checked

`openspec/checks.json` names no glossary, so these come from a search of every spec for SHALL sentences that contain any, every, never, no, only or whatever, and a noun this change uses.

- application-tracking › Application stages ("move an application to any other stage"): the undo of a stage change is a move back to the earlier stage. No conflict.
- application-tracking › Stage history ("record every stage change"): the undo move is recorded like any other move, as *Stage change feedback* says. No conflict.
- job-browsing › Job detail view (the list of parts the detail view shows): the parts stay. m2 changes their order on narrow mosaics, and p4 shows an empty "Missing skills" tile as one line, which still shows missing skills. No conflict.
- job-browsing › Keyboard operation ("apply every triage action with the keyboard"): unchanged. No conflict.
- job-browsing › Swipe triage ("Every other swipe SHALL offer the same undo as the other triage actions"): swipes share the triage undo, so they also get the undo control of *Undo after the message*. No conflict.
- notifications › Notification content ("only the posting title, ..."), and the three "whatever provider" sentences in candidate-profile, cover-letters and match-analysis: these share only a word with this change. No conflict.
