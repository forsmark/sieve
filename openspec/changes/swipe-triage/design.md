# Design

## Context

The job list in `JobsPage.tsx` is a virtualized grid (`@tanstack/react-virtual`, in lanes). Each slot is an absolutely placed box of `CARD_HEIGHT` (184px) that holds one `JobRow`. A `JobRow` is a `div` with a select box in the top right corner and a full-card `button` that opens the posting. Below 640px the grid has one column, so a card is almost as wide as the screen.

Triage runs through `doTriage(ids, action, label)` in `JobsPage.tsx`. It opens the next posting when the open one leaves the list, calls `useTriage()` (optimistic update in every cached list, rollback on error, undo toast), and clears the selection. The server never changes the status of an applied posting (`applyTriage` skips it).

`framer-motion` is a dependency and wraps the app in `MotionConfig` with the system's reduced-motion setting. The board uses it for card enter and exit.

## Goals / Non-Goals

**Goals:**
- A swipe feels direct: the card follows the finger with no delay, and vertical scrolling stays as smooth as now.
- A swipe uses the same triage path as the keyboard, so undo, rollback and "open the next posting" behave the same.
- The gesture is testable in jsdom with pointer events.

**Non-Goals:**
- Swipe in the detail view, on the board, or for other actions (apply, restore). The detail view keeps its buttons.
- Haptic feedback. iOS Safari has no vibration API.
- A setting to turn swipes off. The undo toast covers a mistake. This can be added if the owner asks.

## Decisions

**Plain pointer events in a hook, not framer-motion drag.** A new hook `useSwipe` in `src/client/src/features/jobs/useSwipe.ts` handles `pointerdown`, `pointermove`, `pointerup` and `pointercancel` on the card. It reacts only to `pointerType === 'touch'`. It writes the card's `transform` through a ref, so a move does not re-render the grid. framer-motion's `drag="x"` was considered. It would need `dragListener={false}` and `dragControls` to ignore the mouse, its own handling to block one direction, and extra work to keep a click from firing after a drag. It is also harder to drive in jsdom. The hook is about a hundred lines and owns each of these rules.

**Vertical scroll stays with the browser.** The card's swipe surface gets `touch-action: pan-y pinch-zoom`. The browser then scrolls and zooms as before and sends `pointercancel` when it takes a vertical pan, which resets the swipe. Horizontal moves come to the hook. The hook also locks the direction after the first 10px of movement: when the vertical part is larger, it ignores the rest of the gesture.

**Threshold and fling.** A release commits when the card has moved at least 30% of its width, clamped to 72–140px (125px on a 430px phone), or when it moves at least 40px and the finger leaves at 0.6 px/ms or faster in the same direction. Below that, the card returns to its place in 180ms.

**The status line.** One table in `src/client/src/features/jobs/swipe.ts` maps a status and a direction to an action that already exists:

| Status | Left | Right |
| --- | --- | --- |
| dismissed | none | `restore` |
| new | `dismiss` | `save` |
| saved | `restore` | `apply` |
| applied | `remove-application` | none |

`restore` sets "new", which is the step back from both dismissed and saved. `remove-application` is not a triage action: `applyTriage` on the server skips applied postings, and the removal is `DELETE /api/applications/:id`, which sets the posting to "saved". No new server action is needed.

**Removal by swipe.** A commit of `remove-application` does not slide the card out. The card returns to its place, and `JobsPage` opens a confirmation in a native `<dialog>` with `showModal()`, as `ShortcutHelp` does. The dialog names the posting, says that the notes, the stage history and the interview date are deleted and cannot be restored, and that the posting goes back to saved. It has "Cancel" with the first focus and "Remove application" as a danger button. Escape and a click on the backdrop cancel. The removal mutation moves out of `ApplicationPanel.tsx` into a shared `useRemoveApplication` hook in `src/client/src/features/board/`, so the toast ("Application removed. The posting is saved in the job list.") and the cache updates stay the same on the board and in the list. The board keeps its own two-click confirmation.

**What the swipe uncovers.** Behind the card, inside its slot, a layer shows the action on the side the card leaves: on the left when the card moves right, on the right when it moves left. The words are "Dismiss", "Save", "Mark applied", "Back to new" and "Remove application". Before the threshold the layer is the raised ground with the words in muted text. At the threshold, "Save" turns into a yellow field with ink text (yellow is the primary action in DESIGN.md), "Mark applied" turns into a pink field with ink text (pink is applications), "Dismiss" and "Back to new" get a strong hairline frame and off-white text in weight 700, and "Remove application" gets the danger frame and danger text, the look of a destructive action in DESIGN.md. No field color fits a dismissal or a step back. DESIGN.md gets these rules under the job card.

**Commit.** On a commit the card slides out to its own width plus the channel in 180ms, then calls `onSwipe(action)`. `JobsPage` passes one `onSwipe` that calls `doTriage([id], action, title, { keepSelection: true })`. `doTriage` gets that option so a swipe removes only the swiped id from the selection and leaves the other cards selected. When the posting stays in the list after the action (for example a save in the default list, which shows new and saved postings), the card returns to its place and shows the new status badge. The undo of "Mark applied" is the existing restore to "saved", which removes the application the swipe just created, as the undo of the `a` key does today.

**Blocked directions.** `JobRow` takes the two actions from the table. A direction without an action is blocked, and the card does not move in it.

**No click after a swipe.** After a gesture that moved the card, the hook stops the next `click` in the capture phase on the card root. So neither the open button nor the select box reacts to a swipe.

**Slot reuse.** The virtualizer reuses a slot for the next posting when a card leaves. The hook resets the transform and its state when the posting id changes, so a new card never appears moved.

**Reduced motion.** With reduced motion set in the system, the card still follows the finger, because that is direct control. The slide out and the return happen at once, without a transition.

## Risks / Trade-offs

- [In Safari, a swipe that starts at the very left edge of the screen goes to the system's back gesture.] → The cards sit 6px in from the edge, and most swipes start on the card's body. Nothing more can be done in the page.
- [A diagonal scroll triggers a dismissal by mistake.] → The direction lock, the threshold, and the undo toast. The undo toast is the same as for the `d` key.
- [A right swipe on a saved card marks it applied by mistake, which is easier than pressing `a` by mistake.] → The pink field at the threshold names it before the release, and the undo removes the fresh application.
- [jsdom's pointer events can differ from a real phone.] → A browser check in Chrome with touch emulation at 430×932, and an end-to-end scenario that swipes with `Input.dispatchTouchEvent`.
- [The applied posting quirk.] Today the `d` key on an applied posting updates the list optimistically although the server ignores it. A swipe avoids it, because the left swipe of an applied card asks for the removal instead of sending a triage action. The key's quirk is outside this change.
- [A removal by mistake deletes notes and history for good.] → The danger look at the threshold names the action, the dialog asks again with "Cancel" focused, and the backup of the database holds the earlier data.

## Migration Plan

Client only. Deploy as usual. To roll back, deploy the previous commit.

## Changed during apply

### 2026-11-26: The non-goals no longer exclude apply and restore by swipe

The non-goal "Swipe … for other actions (apply, restore)" stayed from the first draft, which had only dismiss and save. The owner then chose the status line, and the table under "The status line" is what the owner approved at the gate. The build follows the table. The other non-goals hold.

### 2026-11-26: The uncovered space is the ground, not the raised ground

The card itself is the raised ground. A layer in the same color would hide the edge of the moving card before the threshold. The layer is the ground, the color of the channel between cards. DESIGN.md says so under the job card.

### 2026-11-26: A card that stays after it slid out returns after a second

"Slot reuse" assumed that the virtualizer hands a card to the next posting. It keys each slot by the posting id, so a card that leaves unmounts, and a reset on a new id never runs. The hook instead brings a card back when it is still in the list one second after it slid out. Task 1.2 checks this return in place of the reset.

### 2026-11-26: The click guard stops a pointer click for 400ms, and a card on its way out keeps its swipe

A browser often sends no click after a touch that moved, so a guard that waits for "the next click" stayed set and swallowed the next Enter on the card. The guard now stops only a pointer click (a `detail` above 0) in the 400ms after a sideways drag. A click from the keyboard or from assistive technology always goes through. A card that slides out ignores new touches and stops every click until it is gone or back, so a tap during the slide cannot cancel the swipe or open the posting. When the card unmounts before its slide out ends, for example by a fast scroll, the swipe still runs. When the user has left the jobs page by then, it changes the status and nothing else, so no next posting opens and the user stays on the new page.

