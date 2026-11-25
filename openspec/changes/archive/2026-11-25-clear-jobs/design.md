# Design

## Context

Postings live in `postings`. Rows keyed by the posting id live in `posting_facts`, `matches`, `cover_letters`, `match_analyses` and `applications` (with `application_events`). The task queue (`tasks`) refers to a posting through `subject_id` for the kinds `enrich`, `extract`, `constraints`, `judge`, `score`, `liveness`, `cover_letter` and `match_analysis`. The `notify` task uses the subject `batch`, and `derive_profile` uses the profile. No foreign keys exist, so the delete must name each table.

A duplicate refers to its primary through `postings.duplicate_of`. An application holds a snapshot of its posting, but the board also reads the live link status and score from the posting and its match.

Task handlers read the posting at the start and write at the end. A handler that runs during a clear can therefore finish after its posting is gone. Every write except one is an `UPDATE … WHERE posting_id = ?` and does nothing when the row is gone. The exception is `handleExtract`, which runs `INSERT … ON CONFLICT` into `posting_facts`.

## Goals / Non-Goals

**Goals:**
- One server call deletes the postings, and every row that refers to them, in one transaction.
- The clear can be undone by hand from the backup it makes.
- A task that ends after the clear leaves no row behind for a deleted posting.

**Non-Goals:**
- Remembering deleted postings so that they do not come back. That needs a table of tombstones and a rule for when they expire. The user can dismiss again.
- A restore button. Restoring a backup today means replacing the database file by hand; this change keeps it that way.
- Filters for what to clear, such as "only dismissed" or "older than 30 days".

## Decisions

**What stays.** The kept set is every posting with an application, plus the primary of each kept posting that is a duplicate. The primary stays so that `duplicate_of` never points to a missing row. Every other posting goes, whatever its triage status. Alternatives: keep saved postings as well, or delete applications too. Keeping only applications matches "start again" and the product promise not to lose an application; the confirmation names the number of saved postings that go, so the user is not surprised.

**Delete order in one transaction.** In `src/server/ingestion/clear.ts`, `clearPostings()`:

1. Fill a temporary table `clear_keep(id)` with the kept set.
2. Delete from `posting_facts`, `matches`, `cover_letters` and `match_analyses` where `posting_id NOT IN clear_keep`.
3. Delete from `tasks` where `kind` is one of the posting kinds and `subject_id NOT IN clear_keep`, in every state. Failed tasks of deleted postings then leave the activity view.
4. Delete from `postings` where `id NOT IN clear_keep`.
5. Drop the temporary table.

`fetch_runs`, `fetch_run_sources`, `notifications`, `logs`, `settings`, `profile`, `preferences`, `schedule` and `sessions` are not touched. The notification log keeps old posting ids; it shows only counts, so the ids are harmless.

**Backup first, outside the transaction.** `clearPostings()` is async. It checks `getActiveRunId()`, awaits `createBackup()`, checks `getActiveRunId()` again (a scheduled run can start during the backup), then runs the transaction. The second check closes the window between the backup and the delete. A failed backup throws and nothing is deleted.

**Refuse during a fetch run.** A run ingests in steps, and a clear in the middle would leave part of the run's postings and count them as "new" in the run history. The route answers 409 with "A fetch run is active. Clear the postings when it ends." The interface disables the button while `status.activeRunId` is set.

**Guard in `handleExtract`.** The insert into `posting_facts` becomes `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM postings WHERE id = ?)`, so an extraction that ends after the clear stores nothing. The follow-up `enqueue('constraints', …)` for a deleted posting is harmless: `handleConstraints` returns at once when the posting is missing. The same holds for `enrich` → `extract` and `judge` → `score`.

**Routes.** `GET /api/postings/clear` returns `{ delete, keep, saved }`: the postings that go, the postings that stay, and the saved postings among those that go. Duplicates count as postings, so the numbers can be higher than the counts in the navigation. `POST /api/postings/clear` returns `{ deleted, kept, backup }` with the backup's file name. Both routes sit under `/api/`, so the password and gateway checks apply.

**Live update.** A new event `postings.cleared` goes out after the transaction. In `effectsFor` it invalidates the status, the activity and every posting detail query, and sets `refreshList`. Other open tabs and devices then show the empty list without a reload. It also publishes `queue.changed`, since the queue shrank.

**Interface.** A section "Postings" (`#postings`) after "Backups", and a link to it in the section navigation. The description reads, for example, "412 postings are stored. 6 have an application and stay." Then a `ConfirmButton` labelled "Delete 406 postings", which asks "Yes, delete 406 postings" with Cancel beside it. When saved postings are among them, a line under the button says "This includes 4 saved postings." A hint says that a backup is made first, and that the next fetch adds again the postings the sources still list and scores them. `ConfirmButton` gets a `disabled` prop: the button is disabled when nothing would be deleted or a fetch run is active, with the reason in the hint. After success, a toast names the count and the backup file, and the section's counts and the backup list refetch.

## Risks / Trade-offs

- [The user clears by mistake] → Two clicks, the exact count in the button, and a backup made right before. Recovery means downloading the backup and replacing the database file by hand.
- [The pre-clear backup pushes out the oldest backup] → Accepted. The retention count already applies to manual backups the same way.
- [Postings that come back cost language model calls again] → Stated in the hint under the button. Matching can be paused before the next fetch.
- [A cover letter or match analysis that is being written for a deleted posting finishes after the clear] → Its `UPDATE` finds no row and writes nothing. The model call is wasted once.
- [A large table makes the transaction slow] → Each delete is one statement over an indexed key or a temporary table; a few thousand postings take well under a second in SQLite. The server stays single-process, so no other writer waits long.

## Migration Plan

No schema change. Deploy as usual with `portal app deploy sieve`. Rollback is a redeploy of the earlier commit; a clear that already ran is undone only from its backup.

## Changed during apply

### 2026-11-25: Wording of the refusals

The copy check (`fstack:humanize`) changed two messages. The 409 now reads "A fetch is running. Delete the postings when it ends.", the same words the settings page shows, and with the button's verb "Delete" instead of "Clear". A failed backup now answers "The backup could not be made, so no posting was deleted. The cause is in the Log on the Activity page." and writes the system error to the log, instead of showing the error text of the file system. No behaviour changed, and no task changed.

### 2026-11-25: The clear checks the counts the user confirmed

Changes the decisions **Routes**, **Interface** and **Live update**. Found by the code review.

The page could show counts that were out of date. Only `posting.added` and `application.updated` refreshed them, so a run that ingested only duplicates, or a posting saved in another tab, left "Delete 406 postings" on the button while the server would delete more, or delete a saved posting the page did not name. Now:

- `POST /api/postings/clear` takes the body `{ delete, saved }`, the counts on the button and in the saved line. The server compares them with its own counts twice: before the backup, so a stale page costs no backup, and again inside the delete transaction, since a posting can be saved or added while the backup is written (the verifier reproduced that case live). When they differ it deletes nothing and answers 409 "The postings changed after the page counted them. Check the new counts and delete again." A body without the counts answers 400. After a refusal the page fetches the counts again.
- `posting.updated` and `run.progress` also refresh the counts.
- The server answers 409 "No posting can be deleted." when nothing would go, before it makes a backup. The page already disables the button then; this stops a direct API call from adding an empty backup.

### 2026-11-25: The kept listings of applied jobs are named apart

Changes the decision **Interface**. Found by the code review.

The kept set holds the primary of each applied duplicate, which may have no application of its own, but the page counted every kept posting as one "with an application". `GET /api/postings/clear` now also returns `withApplication`, and the page names the rest apart, for example "23 postings are stored. 2 have an application, and 1 is another listing of a job you applied to. These stay when you delete the others." The README says the same. The kept set itself did not change.

### 2026-11-25: A refused clear keeps the oldest backup

Changes the decision **Backup first, outside the transaction** and narrows the risk "The pre-clear backup pushes out the oldest backup". Found by the code review.

A run that starts during the backup makes the second check refuse the clear, and the backup had already pruned the oldest stored one, so each refused attempt cost one old backup. The clear now makes its backup without the prune (`createBackup({ prune: false })`) and prunes (`pruneBackups()`) only after the delete went through. A clear that goes through still pushes out the oldest backup, as accepted. When that prune fails, the clear still reports success and publishes its events, because the postings are already gone, and the failure goes to the log. The other live update: `postings.cleared` now also refreshes the backup list and the log, so another device shows the backup it may need.

No task changed. Tasks 1.1, 1.3, 2.1 and 2.2 carry the new checks, and their tests are in `clear.test.ts`, `app.test.ts`, `SettingsPage.test.tsx` and `events.test.tsx`.
