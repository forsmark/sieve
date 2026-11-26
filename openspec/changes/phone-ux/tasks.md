# Tasks

## 1. Shared controls

- [x] 1.1 Check in Chrome at 430x932 with `Emulation.setTouchEmulationEnabled` whether `matchMedia('(pointer: coarse)')` matches. If it does not, find the emulation that makes it match (for example `Emulation.setEmulatedMedia` with the `pointer` feature), and use it in the e2e and screenshot runs. Verify by recording the working call in design.md under "Changed during apply" when it differs from the plan. Note: `Emulation.setTouchEmulationEnabled` makes `(pointer: coarse)` match in Chrome 158, so the planned call holds. Turn it on before the page loads, because form controls keep their size until a reload. `Emulation.setEmulatedMedia` with `pointer` has no effect.
- [x] 1.2 Add the `touch:` variant to `styles.css`. Raise `Button` (both sizes), `TextInput`, `Select`, the status filter chip, the switch's hit area and `summary` rows to 44px on touch screens. Give inputs, selects and textareas 16px text on touch screens. Set `line-strong` to #76777d, draw the mixed state of a checkbox, and style the range input as design.md says. Verify with tests in `components/ui.test.tsx`, or the nearest existing test file, for the class names of each size, and by reading the computed sizes in the screenshot run of 6.2.
- [x] 1.3 Add `--bottom-bar` to the toaster's offset. Give the toast's Undo button 44px height and at least 64px width, the close button a 44 by 44px area, and 16px between them. Verify with a test in `lib/toast.test.tsx` that the offset follows the variable, and by reading the toast in the screenshots of 6.2.
- [x] 1.4 Set `networkMode: 'always'` for mutations, add `useOnline`, show "Offline" in the status bar, and make `errorText` name the offline state. Verify with tests for *Offline state* › "Connection is lost" and "Action while offline" (a triage while `navigator.onLine` is false fails, rolls back and shows the error toast).
- [x] 1.5 Write the touch rule, the 16px form text, the new `line-strong`, the mixed checkbox, the slider, the toast sizes and the "Offline" status into DESIGN.md. Verify by reading DESIGN.md against `styles.css` and `ui.tsx`.

## 2. Undo

- [x] 2.1 Move `lastUndo` into an observable store with the kind, the message, the toast state and the posting the detail view moved on from, as design.md says. Verify with tests in `lib/toast.test.tsx` that the `u` key path and a store reader see the same entry, and that a new undoable action replaces it.
- [ ] 2.2 Show the undo control in the job list's top row while the latest entry is a triage and its toast is closed. After an undo, open the recorded posting again while the job page is mounted. Verify with tests in `JobsPage.test.tsx` for *Undo after the message* › "Message has closed" and "Undo control in the job list", and *Undo returns to the posting* › "User undoes a triage action from the detail view".
- [ ] 2.3 Show "Moved to <Stage>." with Undo after each stage move by menu, drag or keyboard, and send the earlier stage on undo. Verify with tests in `board/BoardPage.test.tsx` for *Stage change feedback* › "User moves an application" and "User undoes a stage change" (two PATCH calls, the card back in its column).

## 3. Job list and detail

- [ ] 3.1 Move the detail's triage buttons into the bottom bar below 1024px, with `--bottom-bar` set while it shows. Verify with a test in `JobsPage.test.tsx` that the bar holds the buttons for each status at a narrow width (mocked `matchMedia`), and with the screenshots of 6.2.
- [ ] 3.2 Open the filters as a full-screen sheet below 640px, with "Show N postings", and keep the panel closed on load below 640px. Verify with tests in `FilterBar.test.tsx`, or the nearest existing test file, for the sheet, its count and its closed start, and that 640px and up keeps today's behavior.
- [ ] 3.3 Move the bulk actions into the bottom bar below 640px with the "More" select, put Clear beside the count, and make select-all clear a partial selection. Verify with tests in `JobsPage.test.tsx` for *Bulk actions* › "Part of the list is selected" and "User clears a partial selection", and for each "More" action at a narrow width.
- [ ] 3.4 Mark an auto-opened posting read after 1.5 seconds. Verify with a test in `JobsPage.test.tsx` for *Unread tracking* › "Next posting opens after a triage action" (no mark-read call before 1.5 seconds, one after), and that the existing "User opens an unread posting" test still passes.
- [ ] 3.5 Fix the focus findings m1 and m13: the heading takes focus when the data arrives, `inert` goes on the list behind the full-screen detail, close focuses the card, a Tab focus doesn't move the cursor while a posting is open, and the skip link. Verify with tests in `JobsPage.test.tsx` for *Keyboard operation* › "User closes the detail view", and for the heading focus and the cursor.
- [ ] 3.6 Fix m12 (the shortcut dialog's focus and backdrop), m14 (the job list `h1` and the document titles), p1 (keyboard hints on touch screens), p7 (13px card foot) and p10 (the card's accessible name). Verify with tests for the dialog's focus return and backdrop close, the title of each page and of an open posting, and the card's accessible name.
- [ ] 3.7 Fix the detail findings m2 (the order on a narrow mosaic), m3 (the growing letter field), p4 (one-line empty "Missing skills") and p5 (plain failure text). Verify with tests in `DetailPanel.test.tsx`, `CoverLetter.test.tsx` and `MatchAnalysis.test.tsx`, or the nearest existing test files.
- [ ] 3.8 Write the detail action bar, the filter sheet, the bulk bar, the mosaic order and the card foot into DESIGN.md. Verify by reading DESIGN.md against the screenshots of 6.2.

## 4. Shell, Activity, Profile and Settings

- [ ] 4.1 Make the status bar one line below 640px that links to `/activity`, and add "Fetch now" and "Pause matching" to the Activity header. Verify with tests in `app/StatusBar.test.tsx` and `features/activity/ActivityPage.test.tsx`, or the nearest existing test files.
- [ ] 4.2 Show the fetch runs as two-line rows below 640px (m8). Move "Log out" into the Settings page below 640px (m10). Rename the schedule switch to "Fetch on a schedule" (p11). Verify with tests for the Settings switch's state and request, and for the log-out button in Settings.
- [ ] 4.3 Stack the profile weights and the skill rows below 640px, and add the skill header row (m7, p6). Verify with a test for the header row, and with the 375x667 screenshots of 6.2, where the page doesn't scroll sideways.
- [ ] 4.4 Add `openApplications` to the status counts on the server and use it for the board count (p3). Name the board page "Board" (p2). Verify with a server test in `src/server/http/app.test.ts` that the count leaves out rejected and withdrawn applications, and a client test for the label.
- [ ] 4.5 Add the home-screen icon and the web-app meta tags to `index.html`, and pad the top bar and the sides by the safe area (p8). Verify that `pnpm build` writes the icon link with the base path, by reading `dist/client/index.html` after a build with `APP_BASE=/sieve/`.
- [ ] 4.6 Write the status bar, the Activity header, the log-out place and the safe areas into DESIGN.md. Verify by reading DESIGN.md against the screenshots of 6.2.

## 5. Board

- [ ] 5.1 Store the notes on blur, close, unmount and `pagehide`, store the interview date on change, keep a draft when a store fails, and remove the two save buttons (M7). Verify with tests in `board/BoardPage.test.tsx` for *Notes and dates* › "User edits the notes", "User closes the application while typing" and "Notes cannot be stored", and that "User sets an interview date" still passes.
- [ ] 5.2 Raise the board's stage menu and panel controls to the touch sizes, and hide the drag hint on touch screens. Verify with the board screenshots of 6.2.

## 6. Coverage and checks

- [ ] 6.1 Add the new and changed scenarios to `e2e/coverage/job-browsing.json` and `e2e/coverage/application-tracking.json`. These are the 9 new scenarios of job-browsing, the 4 new scenarios of application-tracking, and "User edits the notes", whose test changes. Verify that `pnpm test` passes and that `pnpm check` fails only because `coverage` reports the new entries as "in no spec". They resolve when the delta syncs at archive.
- [ ] 6.2 Take screenshots of the built client at 430x932 and 375x667 with touch and a 34px bottom safe area, and at 1440x900. Cover every page and every state the audit showed: the detail with its action bar, the filter sheet, the bulk bar, the toast and the undo control, the status bar, Activity, Profile, Settings, the board and the application panel. Verify by reading each screenshot. Check that no page scrolls sideways at 375px. Check that every control on a touch screen is at least 44px in each direction, apart from the text-sized links that get their area from padding, and that every input, select and textarea has a computed font size of at least 16px.
- [ ] 6.3 Run `pnpm e2e`. Verify that the swipe scenario still passes, and that no other scenario fails beyond the 10 failures of the keyboard scenario that `main` has today.

## 7. Ship

- [ ] 7.1 After the owner approves the diff, merge to `main`, push, and run `portal app deploy sieve`. Verify that the deploy reports healthy, and ask the owner to confirm on the iPhone that tapping into the search field doesn't zoom the page.

## Workflow follow-up

- At the sync gate, the owner answers the sync question. Then archive the change and run `pnpm check`.
