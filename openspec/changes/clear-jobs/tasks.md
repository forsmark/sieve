# Tasks

## 1. Server

- [x] 1.1 Add `src/server/ingestion/clear.ts` with `clearPreview()` and `clearPostings()` as design.md describes: the kept set (postings with an application and the primary of each kept duplicate), the backup between two checks of the active fetch run, and the deletes in one transaction. Verify with tests in `src/server/ingestion/clear.test.ts` for "User clears postings", "Posting with an application stays", "Backup before the clear" (both the backup file and a failing backup) and "Fetch run is active".
- [x] 1.2 Change the insert into `posting_facts` in `handleExtract` so that it stores nothing when the posting is gone. Verify with a test that deletes the posting while the stub model call waits, and then finds no `posting_facts` row.
- [x] 1.3 Add `GET /api/postings/clear` and `POST /api/postings/clear` to `src/server/http/app.ts`, with 409 during a fetch run and 500 with the reason when the backup fails. Add the event `postings.cleared` to `AppEvent` and publish it with `queue.changed` after the clear. Add the DTOs to `src/shared/api.ts`. Verify with tests in `src/server/http/app.test.ts` for the counts, the clear and the 409.
- [x] 1.4 Add a test in `src/server/ingestion/clear.test.ts` that clears, then ingests a deleted posting again and finds it new, unread and queued for matching. Verify that it passes, for "Deleted posting comes back".

## 2. Client

- [x] 2.1 Add `api.clearPreview` and `api.clearPostings` to `endpoints.ts` and a query key. Handle `postings.cleared` in `effectsFor`: invalidate the status, the activity and the posting detail queries, and refresh the list. Verify with a test in `events.test.tsx`.
- [x] 2.2 Add a `disabled` prop to `ConfirmButton`. Add the "Postings" section to `SettingsPage.tsx` and its link in the section navigation, as design.md describes. Verify with tests in `SettingsPage.test.tsx` for "Confirmation states the counts", a disabled button during a fetch run, and a toast with the backup name after the clear.
- [x] 2.3 Check the section copy with the `fstack:humanize` skill. Verify that the section reads at 390px and 1440px width in a screenshot of a built client.

## 3. Coverage and checks

- [x] 3.1 Add the six scenarios of *Clear postings* to `e2e/coverage/job-browsing.json` with the tests from 1.1, 1.4 and 2.2. Verify that `pnpm check` and `pnpm test` pass. Note: `coverage` may report the new entries as "in no spec" until the delta syncs at archive.

## 4. Ship

- [ ] 4.1 After the owner approves the diff, merge to `main`, push, and run `portal app deploy sieve`. Verify that the deploy reports healthy and that the "Postings" section shows the counts at `https://olympus.tailf4d52f.ts.net/sieve/settings#postings`.

## Workflow follow-up

- At the sync gate, the owner answers the sync question. Then archive the change and run `pnpm check`.
