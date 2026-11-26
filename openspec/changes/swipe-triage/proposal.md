# Proposal

## Why

On a phone, triage takes three steps: open a posting, find the button, then go back to the list. The keyboard shortcuts give the desktop a fast path through the list. The phone has none. The owner triages on an iPhone and wants to move a card through the statuses by swiping it.

## What Changes

- The statuses form one line: dismissed, new, saved, applied. On touch input, a swipe to the right moves a posting one step toward applied, and a swipe to the left one step toward dismissed:

  | Status | Swipe left | Swipe right |
  | --- | --- | --- |
  | dismissed | nothing | back to new |
  | new | dismiss | save |
  | saved | back to new | mark applied |
  | applied | remove the application, after a confirmation | nothing |

- A job card in the list follows the finger sideways. A release past a threshold takes the action. A shorter swipe returns the card to its place, and nothing changes.
- While the card moves, the space it uncovers names the action that a release will take, and shows when the swipe is far enough to take it.
- A swipe runs the same triage action as the buttons and the keyboard shortcuts, with the same optimistic update, the same undo toast and the same rollback on error. "Mark applied" creates the application in the first stage of the board, as the `a` key does, and its undo removes that application again.
- A left swipe on an applied posting removes its application, the same removal as on the board. Removal deletes the notes, the stage history and the interview date, and no undo can bring them back. So the card returns to its place at the release, and a dialog asks the user to confirm. Only after the confirmation does the system remove the application and set the posting to saved. Cancel leaves it applied. There is no undo, as on the board.
- A drag that is mostly up or down scrolls the list as before. A mouse or a pen does not swipe. A tap still opens the posting, and the select box still selects it.
- With reduced motion set in the system, the card does not slide out after the release. The triage still happens.
- A swipe acts on the swiped card only, also while other cards are selected for a bulk action. The selection of the other cards stays.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-browsing`: two new requirements, *Swipe triage* and *Swipe feedback*.

## Impact

- Client only. A new swipe hook in `src/client/src/features/jobs/`, used by `JobRow.tsx`. `JobsPage.tsx` passes a swipe handler to each card that calls the existing triage path in `useTriage.ts`, or opens the confirmation for the removal of an application. The removal moves from `ApplicationPanel.tsx` into a hook that the board and the job list share.
- No server, API, or data change. The removal uses the existing `DELETE /api/applications/:id`.
- `DESIGN.md` gets the look of the uncovered space and the motion of a swipe.
- Tests: unit tests for the gesture and the triage it calls, with pointer events in jsdom. A browser check with touch emulation on the iPhone 16 Plus size before the report.

## Claims checked

- job-browsing › Triage actions: "let the user save, dismiss, or mark a posting as applied, and undo each action." A swipe adds a way to take these actions and keeps the undo. Marking as applied by swipe creates the application in the first stage, as the scenario "User marks a posting as applied" requires. No conflict.
- application-tracking › Remove an application: "WHEN the user removes an application and confirms". The left swipe of an applied card is a second way to start that removal, and it asks for the same confirmation. The posting then returns to "saved", also when it was "new" before the user applied, as the scenario "Posting was new before" says. No conflict.
- job-browsing › Triage actions: "undo each action." The removal of an application is not a triage action, and the board offers no undo for it either. The new requirement says that this swipe asks for confirmation instead. No conflict.
- job-browsing › Keyboard operation: "apply every triage action with the keyboard." Swipes add touch input. The keyboard keeps every action. No conflict.
- job-browsing › Default visibility: dismissed postings leave the default list. A swiped-away card leaves it the same way. No conflict.
- job-browsing › Job detail view: "as a full screen on narrow screens." A swipe acts in the list and never opens the detail. No conflict.
- job-matching › Automatic dismissal: "SHALL apply only to postings that the user has not triaged." A swipe is a triage by the user, so the server marks it as one, as for the buttons. No conflict.
