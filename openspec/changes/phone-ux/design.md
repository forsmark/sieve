# Design

## Context

The audit measured the client at 430x932 and 375x667 with touch, and at 1440x900. Its findings and their IDs are listed in proposal.md. The client sizes every control from DESIGN.md: buttons of 36 and 28px, inputs of 36px in 14px text. It switches layouts at two widths: 640px (`sm`) for the phone layout of the bands, and 1024px (`lg`) for the detail view beside the list instead of over it. Below 1024px the detail view and the application panel cover the whole screen, the status bar included.

Two stores already exist in `lib/`: the toast store, and `lastUndo`, the latest undo that the `u` key runs. `lastUndo` lives in a module variable that the interface cannot observe.

## Goals / Non-Goals

**Goals:**
- Every finding of the audit is fixed, and the iOS zoom on focus too.
- Desktop with a mouse keeps its current sizes and layout, apart from the fixes that apply at every width: m4, m5, m6, m11 to m15, p2 to p5, p8 to p11, and the Activity header buttons.

**Non-Goals:**
- A web app manifest. The portal serves one for its apps at a path outside sieve, and the iPhone takes the home-screen icon from `apple-touch-icon`. Pointing at the portal's manifest would break sieve when it runs alone.
- Drag of board cards on iOS. The audit could not test it, and the stage menu does the same job.
- The unverified findings that the audit could not reproduce: the slow "Save search" and the "Live" indicator under offline emulation. The second one is covered anyway, because m11 replaces "Live" with "Offline".

## Decisions

### Touch is a pointer question, not a width question
A new Tailwind variant `touch:` stands for `@media (pointer: coarse)`. The 44px sizes (M2) and the 16px text of form controls (iOS zoom) use it. The other phone layouts (M4, M5, M6, m7, m8, m10) keep the 640px breakpoint, because they are about room on the screen.

- **Alternative: width (`max-sm:`) for the sizes too.** Rejected. A narrow desktop window would get finger-sized controls, and an iPad would keep 28px targets.
- **Alternative: `maximum-scale=1` in the viewport meta, to stop the iOS zoom.** Rejected. Android Chrome then also blocks pinch zoom, which harms reading.

Controls whose text must stay small get their hit area from padding or from an `::after` that reaches 44px around them, so the text and the look don't change: summary rows, text links in panel headers, the switch, and the "Model available" link.

### One CSS variable for the bars at the bottom
The detail action bar (M1) and the bulk bar (M6) sit at the bottom edge. The toasts stand above the status bar, so they would cover these bars. Whichever bar is shown sets `--bottom-bar` on the root element to its height, and the toaster adds that height to its offset.

- **Alternative: render the toasts inside each panel.** Rejected. The toast store is global, and a message must survive the panel closing, as it does after a triage that moves on.

### Detail action bar (M1)
Below 1024px, the triage buttons leave the detail header and stand in a bar under the detail's scroller. The bar is a flex sibling of the scroller, not fixed inside it, so it never covers text. It holds the buttons that the header holds today, for the posting's status: Save, Dismiss or Restore, and "Mark as applied" or "Open on board". They share the width, are 44px high, and the bar's bottom padding is the safe area. Rescore stays in the header.

### Undo (M3, m4)
- `lastUndo` moves into a store that the interface can observe. Each entry holds:
  - its kind (triage or stage),
  - its message,
  - whether its toast is still shown,
  - for a triage that moved the detail view on, the id of the posting the detail view showed.
- While the latest entry is a triage and its toast is closed, the job list's top row shows "Undo" with the message, truncated, for example `Undo · Dismissed “Mobile Developer”`. Its accessible name holds the whole message. The `u` key and this control run the same entry.
- After the restore, the job page opens the recorded posting again, if it is still mounted. The page uses the same mounted check as the swipe.
- The toast's Undo button gets a 44px height and at least 64px width, its close button a 44 by 44px area, and 16px between the two.

**Alternative: a longer toast.** Rejected. It covers the content for longer and still runs out.

### Read only after a dwell (p9)
The job page passes `autoOpened` to the detail view when the open came from a triage that moved on. With `autoOpened`, the detail view marks the posting read after 1.5 seconds. A change of posting or a close before then cancels the timer. A posting the user opens marks read at once, as today.

### Status bar and Activity (M4)
Below 640px, the status bar shows one line: the status dots and the summary text. The whole bar is a link to `/activity`, at least 44px high above the safe area. The Activity page header gets "Fetch now" and "Pause matching" at every width, because they belong beside the runs they start. The desktop status bar keeps its buttons. The empty text "Use Fetch now in the status bar" becomes "Use Fetch now above to start one".

**Alternative: a sheet that opens from the status bar.** Rejected. It adds an overlay, while the Activity page already shows what the buttons change.

### Filter sheet (M5)
Below 640px, the Filters button opens the filter panel as a full-screen sheet. It has a header with "Filters" and Close, and a footer button "Show N postings" (44px) that closes it. Filters still write to the address at once, so the count is live. Below 640px the panel starts closed, also with filters in the address; the "Filters (N)" count says that filters are on. From 640px it keeps today's behavior.

**Alternative: the panel inside the scrolling list.** Rejected. The filters would scroll away, and the result would move under the finger while the user changes it.

### Bulk bar (M6)
Below 640px, the bulk actions leave the top row for a bar at the bottom of the list column. The bar holds Save, Dismiss and Applied as 44px buttons and a "More" select with Restore, Rescore, Analyze, "Mark read" and "Mark unread". The select runs the chosen action and then resets to its label. Clear stands beside "N selected" in the top row.

**Alternative: a custom menu.** Rejected. The native select opens the iOS picker, which is large and familiar, and it needs no new component.

### Notes and dates without save buttons (M7)
The application panel stores:
- the notes on blur, on close, on unmount, and when the page becomes hidden (`visibilitychange`, `pagehide`);
- the interview date on change.

The mutation's callbacks sit on the hook, so a store that starts on unmount still finishes. A caption beside the field says "Saving…" and then "Saved". When a store fails, the error toast names it, and a module-level map keeps the typed notes for that application. The panel prefers that draft over the stored notes when it opens again, and the draft clears once a store succeeds. The "Save notes" and "Save date" buttons go.

**Alternative: ask before closing when the notes are unsaved.** Rejected. It adds a tap, and it cannot stop the browser's back gesture.

### Stage change feedback (m5)
`useMoveApplication` shows "Moved to <Stage>." with Undo after a successful move, from the stage menu, by drag and by keyboard. The undo sends the earlier stage with the same PATCH, so the server records it in the history like any move. The server needs no change.

**Alternative: an undo that deletes the history entry.** Rejected. It needs a new endpoint, and it breaks "record every stage change".

### Smaller items
- **m2:** below 48rem of mosaic width, CSS `order` puts "Facts" and "Description" before the cover letter and the analysis. The DOM order stays, so the tab order on wide screens doesn't change.
- **m3:** the letter textarea takes its height from `scrollHeight` on input and on load. `field-sizing: content` serves where the browser supports it.
- **m1:** the heading takes focus when the posting's data arrives, not on mount. While the full-screen detail is open, the list column gets `inert`.
- **m12:** the shortcut dialog keeps the element that opened it and focuses it on close. A click whose target is the dialog element itself closes it, like the removal dialog.
- **m13:**
  - The detail view's close focuses `#row-<id>` of the posting it showed.
  - While a posting is open, a focus from Tab doesn't move the cursor. Cursor keys still do.
  - A skip link "Go to the open posting" stands first in the list while a posting is open, and shows on focus.
- **m14:** a `useDocumentTitle` hook per page gives "Jobs · sieve", "Board · sieve" and so on. An open posting gives "<title> · sieve". The job page gets a visually hidden `h1` "Jobs".
- **m15:** `line-strong` becomes #76777d (3.3:1 on the ground).
- **p10:** the card button's accessible name starts with the title, then company, score and band.
- **m6:** `input[type='checkbox']:indeterminate` draws a 2px dash in the text color. A click in the mixed state clears the selection.
- **m7, p6:** below 640px, each weight is two lines (label and percent, then slider and number), and each skill row puts the name on its own line above level and years. A header row "Skill, Level, Years" stands above the rows from 640px. Below that, each field shows its label.
- **m8:** below 640px, each fetch run row is two lines: source and state, then the counts.
- **m9:** the range input gets a square 20px yellow thumb on a 1px strong hairline track, in a 44px row on touch screens.
- **m10:** below 640px, the top bar has no "Log out". The Settings page gets an "Account" section with "Log out" when a password is set.
- **m11:**
  - Mutations use `networkMode: 'always'`, so a request fails instead of waiting. Queries keep the default.
  - A `useOnline` hook reads `navigator.onLine` and its events, and the status bar shows "Offline" with a danger dot in place of "Live".
  - While offline, `errorText` turns a failed fetch into "The device is offline."
- **p1:** `touch:hidden` on the "Shortcuts ?" button and the board's drag hint. The search placeholder drops "/" on touch screens.
- **p2:** the board's page title reads "Board".
- **p3:** the status counts gain `openApplications`, the applications in applied, interview or offer. The pink count shows it, with the label "N open applications".
- **p4:** an empty "Missing skills" tile shrinks to one line: "Missing skills: none".
- **p5:** a failed letter or analysis shows "The letter could not be written. Try again." or "The analysis could not be made. Try again.", with the technical error below it in 12px muted text.
- **p7:** the card foot goes to 13px. The card keeps its 184px height.
- **p8:**
  - `index.html` gets `apple-touch-icon` (Vite adds the base path), `apple-mobile-web-app-capable`, `apple-mobile-web-app-title` "sieve" and `apple-mobile-web-app-status-bar-style` `black-translucent`.
  - The top bar pads by `env(safe-area-inset-top)`.
  - The page padding adds the left and right insets.
- **p11:** the switch reads "Fetch on a schedule" and shows `!paused`. The stored setting stays `paused`.

## Risks / Trade-offs

- [Chrome's touch emulation may not report `pointer: coarse`, so e2e could not see the touch sizes] → Check it at the start of apply. If it doesn't, emulate the media feature with `Emulation.setEmulatedMedia`, and read the computed sizes in the screenshot run.
- [The iOS zoom fix can't be seen in Chrome] → Check that every input, select and textarea has a computed font size of at least 16px under touch emulation. The owner confirms on the iPhone after the deploy.
- [44px controls make the touch layout taller: board cards, filter rows, settings forms] → Read the screenshots of every page at 430 and 375px in the check task, and fix what breaks.
- [Storing notes on unmount may run after the board has refetched] → The hook-level `onSuccess` writes the stored application into the cache, as the stage move does.
- [`inert` on the list hides it from find-in-page while the detail is open] → Accepted. The list is covered then anyway.

## Migration Plan

Nothing to migrate. Deploy with `portal app deploy sieve`. Redeploying the earlier image rolls it back.

## Changed during apply

### 2026-11-26: An empty interview date is stored on blur, not on change
The design stores the interview date on change. A date field also changes while the user types a date by hand, and its value is empty until the date is whole. A store on change would then clear a stored date in the middle of typing. A whole date is stored on change, as planned. An empty value is stored when the field loses focus, when the panel closes, and when the page is hidden. "Clear date" still clears at once.

### 2026-11-26: The full-screen panels keep clear of the notch too
p8 pads only the top bar by the top safe area. With `black-translucent`, the page runs under the iPhone's status bar, and the job detail view and the application panel cover the screen below 1024px, outside the top bar and the shell's side padding. Their headers and Close buttons would sit under the clock and the notch. Both panels pad by the top, left and right insets below 1024px, as the top bar and the shell do. Application stores also use `keepalive`, so a store that starts on `pagehide` survives the page closing. Browsers refuse `keepalive` for bodies over 64 KB, so a larger body goes without it.
