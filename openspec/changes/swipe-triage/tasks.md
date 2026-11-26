# Tasks

## 1. Gesture

- [x] 1.1 Check whether jsdom (30.x) has `PointerEvent` with `pointerType` and `clientX`. If not, add a small polyfill to the client test setup. Verify with a throwaway test that `fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 10 })` reaches a handler with both values.
- [x] 1.2 Add `src/client/src/features/jobs/useSwipe.ts` as design.md describes: touch only, direction lock after 10px, blocked directions, threshold and fling, slide out or return in 180ms (at once with reduced motion), the click stopped after a swipe, and a return of a card that is still in the list after it slid out (see "Changed during apply" in design.md). Verify with tests in `src/client/src/features/jobs/useSwipe.test.tsx` for a commit to each side, a short swipe, a fling, a mouse drag, a vertical drag, a blocked direction, the stopped click, and the return.

## 2. Job card and list

- [x] 2.1 Add the status line table to `src/client/src/features/jobs/swipe.ts` as design.md shows. Use the hook in `JobRow.tsx`: the uncovered layer with "Dismiss", "Save", "Mark applied", "Back to new" and "Remove application", its look before and at the threshold, `touch-action: pan-y pinch-zoom` on the card, and the blocked directions from the table. Verify with tests in `src/client/src/features/jobs/JobsList.test.tsx` for "Swipe in progress" and "Swipe past the end of the line".
- [x] 2.2 Pass `onSwipe` from `JobsPage.tsx` to each card. Add the `keepSelection` option to `doTriage`. Verify with tests in `src/client/src/features/jobs/JobsPage.test.tsx` for the five "User swipes …" scenarios (each with the triage call and the undo toast; the left swipe of a new posting also gone from the default list and not opened), "Short swipe", "Mouse drag", "Vertical drag" and "Swipe while cards are selected".
- [x] 2.3 Move the removal mutation from `ApplicationPanel.tsx` into `useRemoveApplication` in `src/client/src/features/board/`. Add the confirmation dialog for a removal by swipe to `JobsPage.tsx` as design.md describes. Verify that the existing `ApplicationPanel` tests still pass, and add tests in `src/client/src/features/jobs/JobsPage.test.tsx` for "User swipes an applied posting to the left" (the card back in place, the dialog with its text, no request yet), "User confirms the removal by swipe" (`DELETE /api/applications/:id`, the toast without undo) and "User cancels the removal by swipe" (no request).
- [x] 2.4 Describe the swipe in DESIGN.md under the job card: the uncovered layer, its looks for each action, the threshold and the motion. Add one sentence to the job list part of README.md. Verify by reading both against the built card.

## 3. Coverage and checks

- [x] 3.1 Add the fourteen scenarios of *Swipe triage* and *Swipe feedback* to `e2e/coverage/job-browsing.json` with the tests from 2.1, 2.2 and 2.3. Verify that `pnpm test` passes, and that `pnpm check` fails only because `coverage` reports the new entries as "in no spec"; they resolve when the delta syncs at archive.
- [x] 3.2 Add a scenario to `pnpm e2e` that swipes a new card left, a new card right, a saved card right and an applied card left (then cancel the dialog) with `Input.dispatchTouchEvent` at 430×932 and drags another card upward. Verify that `pnpm e2e` passes: the swiped postings change status, the undo toast shows, the dialog opens for the applied card and its cancel keeps the application, and the upward drag scrolls the list and changes no status. Note: the six checks of the swipe scenario pass. `pnpm e2e` still fails, with the same 10 failures in scenario 2 (keyboard triage) that `main` at 80c09ba has without this change; they start at "u: undoes the dismissal".
- [x] 3.3 Check on the built client with touch emulation at 430×932 and a 34px bottom safe area: screenshots of a new, a saved and an applied card before and at the threshold to each side, the removal dialog, and after a save that keeps the card in the default list. Verify by reading the screenshots.

## 4. Ship

- [ ] 4.1 After the owner approves the diff, merge to `main`, push, and run `portal app deploy sieve`. Verify that the deploy reports healthy and that the served bundle holds the swipe code.

## Workflow follow-up

- At the sync gate, the owner answers the sync question. Then archive the change and run `pnpm check`.
