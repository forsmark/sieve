# Proposal

## Why

The user wants to start again with an empty job list, for example after a change of search terms or CV, or after a test period. Today the only way is to delete the SQLite file, which also deletes the profile, the settings and the applications.

## What Changes

- A new section "Postings" at the end of Settings. It states how many postings are stored and how many stay, and has a button that deletes the postings after a second click.
- The clear deletes every posting that has no application, with its match, extracted facts, cover letter, match analysis and queued or failed work.
- A posting that has an application stays, with its score and its application. The primary record of a kept duplicate stays too.
- The profile, the preferences, the settings, the fetch run history, the notification log and the system log stay.
- The system creates a backup before it deletes anything. When the backup fails, nothing is deleted.
- The system refuses to clear while a fetch run is active.
- After a clear, the next fetch run adds the postings that the sources still list as new, unread postings and scores them again. A posting that the user dismissed earlier comes back. This uses language model calls again.
- New API routes: `GET /api/postings/clear` for the counts, `POST /api/postings/clear` to clear.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-browsing`: a new requirement, *Clear postings*.

## Impact

- Server: a new `src/server/ingestion/clear.ts` with the delete logic, two routes in `src/server/http/app.ts`, a new event `postings.cleared` in `src/server/kernel/events.ts`, and a guard in `handleExtract` in `src/server/matching/handlers.ts` so that an extraction that ends after a clear does not store facts for a deleted posting.
- Client: a new section in `SettingsPage.tsx`, two endpoints, the new event in `api/events.ts`, and a `disabled` prop on `ConfirmButton`.
- Shared: a DTO for the counts and the result in `src/shared/api.ts`.
- Data: the delete cannot be undone in the interface. The backup made before the clear holds the earlier data and can be downloaded from Settings.
- Cost: postings that come back after a clear are extracted and judged again.

## Claims checked

- notifications › High score notification: "The system SHALL notify at most once for each posting." A posting that comes back after a clear is a new record, so it can cause a second notification for the same job. The claim gives way for cleared postings. The new requirement states it in the scenario "Deleted posting comes back", so the notifications spec needs no edit.
- job-matching › Posting fact extraction: "extract structured facts from each primary posting once". The same holds: a returning posting is a new record and is extracted again. No edit.
- job-ingestion › Idempotent ingestion: "SHALL NOT change the user's triage status or score" of a stored posting. After a clear the posting is no longer stored, so a returning posting gets the status "new". No conflict.
- job-ingestion › Duplicates stay out of ranking: "The primary record SHALL list every source that carries the job." A kept primary loses the duplicates that had no application until the next fetch run detects them again. Accepted; the gap lasts until the next run.
- application-tracking › Posting snapshot: "The copy SHALL stay readable after the original posting expires or is deleted." The clear keeps postings that have an application, so the copy and the original both stay. No conflict.
- job-browsing › Database backups: "SHALL keep a configured number of recent backups." The backup before a clear counts toward that number and can push out the oldest backup. No conflict.
- job-browsing › Access control: "SHALL require [the password] before it … accepts any change." The new routes sit behind the same check. No conflict.
