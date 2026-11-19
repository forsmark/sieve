# Tasks

## 1. Project foundation

- [x] 1.1 Create the pnpm project with `src/server`, `src/shared`, and `src/client`, and verify that `pnpm dev` serves an empty page and a health route
- [x] 1.2 Add TypeScript strict mode, a linter, and a test runner, and verify that `pnpm check` and `pnpm test` pass on the empty project
- [x] 1.3 Add the Dockerfile and compose file with one data volume, and verify that `podman-compose up` serves the health route
- [x] 1.4 Write the README section for local start and Docker start, and verify that both documented commands run as written

## 2. Kernel: database, tasks, events

- [x] 2.1 Define the Drizzle schema from design D7 and generate the first migration, and verify that startup creates all tables in an empty file
- [x] 2.2 Make tests use an in-memory database, and verify with a test that fails if the database path is a file
- [x] 2.3 Implement the task queue from design D4 with claim, complete, fail, and backoff, and verify with tests for duplicate suppression, retry limit, and lane concurrency
- [x] 2.4 Reset `running` tasks to `pending` at startup, and verify with a test that simulates a restart
- [x] 2.5 Implement the event bus and the SSE endpoint, and verify with a test that a published event reaches a connected client
- [x] 2.6 Implement the settings store and the persisted logger, and verify with tests for read, write, and default values

## 3. Language model module

- [x] 3.1 Implement `generateObject` against the OpenAI-compatible endpoint with schema output, and verify with a test against a stub server
- [x] 3.2 Add validation with retry and the JSON mode fallback, and verify with tests for malformed output and for the retry limit
- [x] 3.3 Add the health probe and the `llm.status` event, and verify with a test that the language model lane pauses and resumes
- [ ] 3.4 Document the endpoint settings for Ollama, LM Studio, and llama.cpp in the README, and verify each documented base URL with the endpoint test
- [x] 3.5 Implement the Claude Code provider that starts `claude -p` with Haiku 5.5, the effort setting, a JSON schema, no tools, and the prompt on standard input, and verify with a test against a fake `claude` executable
- [x] 3.6 Add the call timeout that kills the child process and the mapping of a missing command or a login error to the unavailable state, and verify each case with the fake executable
- [x] 3.7 Add provider selection with local endpoint as the default, and verify each `job-matching` provider scenario with a test
- [x] 3.8 Document the Claude Code provider in the README with the host setup and the container mount setup, and verify one real call with each effort level on the host

## 4. Job sources

- [x] 4.1 Define `SourceAdapter`, `RawPosting`, and `FetchContext` from design D3, and verify with a fake adapter test
- [x] 4.2 Implement the rate-limited HTTP client with backoff on 429 and 5xx, and verify with tests that use a fake clock
- [x] 4.3 Implement the fetch runner with parallel adapters, failure isolation, and run history, and verify with tests for one failing adapter, one timeout, and one disabled adapter
- [x] 4.4 Implement the schedule with interval, pause, single active run, and overdue run at startup, and verify each `job-sources` schedule scenario with a test
- [x] 4.5 Implement the Jobindex and LinkedIn adapters with recorded fixtures, and verify that each parser test passes
- [x] 4.6 Implement the Remotive, Arbeitnow, and RemoteOK adapters with recorded fixtures, and verify that each parser test passes
- [x] 4.7 Add the API routes for sources, search configuration, runs, and manual fetch, and verify with integration tests

## 5. Job ingestion

- [x] 5.1 Implement normalization and validation of raw postings, and verify with tests for markup removal and for each missing required field
- [x] 5.2 Implement idempotent upsert on source and source identifier, and verify that a repeated posting keeps status, score, and first-seen time
- [x] 5.3 Implement exact and fuzzy duplicate detection with the `company_key` index, and verify with tests for each `job-ingestion` duplicate scenario
- [x] 5.4 Implement manual duplicate separation, and verify that the separated posting gets match tasks
- [x] 5.5 Implement the `enrich` task with page text extraction and the adapter description hook, and verify with fixture tests for success and failure
- [x] 5.6 Implement the `liveness` task with active, expired, and unknown results, and verify with a stub server test for each result

## 6. Candidate profile

- [x] 6.1 Implement CV import for PDF, Markdown, and pasted text, and verify with tests that include a PDF without text
- [x] 6.2 Implement the `derive_profile` task with the structured profile schema, and verify with a stub model test for success and failure
- [x] 6.3 Implement manual edits as a separate layer over the derived profile, and verify that a new derivation keeps the edits
- [x] 6.4 Implement preferences with validation, hard and soft flags, and weights, and verify with tests for invalid values
- [x] 6.5 Compute `judge_version` and `rule_version`, and verify with tests that only match-relevant changes alter each version
- [x] 6.6 Add the API routes for CV, profile, and preferences, and verify with integration tests

## 7. Job matching

- [x] 7.1 Implement the `extract` task and the `PostingFacts` schema, and verify with a stub model test that unknown facts stay unknown
- [x] 7.2 Implement hard constraint evaluation in code, and verify with tests for each `job-matching` constraint scenario
- [x] 7.3 Implement the `judge` task with dimension scores, matched skills, missing skills, and assessment, and verify with a stub model test
- [x] 7.4 Implement the location score, the soft constraint penalties, and the weighted total in code, and verify with tests that the same input gives the same total
- [x] 7.5 Implement the rescore planner from the table in design D5, and verify with tests that count model calls for each change type
- [x] 7.6 Implement match states, pause and resume, and the failed state after the retry limit, and verify with tests
- [x] 7.7 Implement automatic dismissal with the manual rescore exception, and verify with tests for both `job-matching` dismissal scenarios
- [x] 7.8 Add the API routes for ranked postings, posting detail, rescore, and queue status, and verify the ranking order with an integration test
- [x] 7.9 Run extraction and judgment on 20 real postings with the target local model and with the Claude Code provider at low and medium effort, and record score quality and time for each posting in `docs/matching-eval.md`

## 8. Job browsing interface

- [x] 8.1 Set up the router, the query client, the SSE handler, and the design tokens, and verify that a route renders data from the API
- [x] 8.2 Build the virtualized ranked list with row content and score bands, and verify with a component test and a list of 2000 rows
- [x] 8.3 Build the detail pane with breakdown, skills, facts, description, and source links, and verify with a component test
- [x] 8.4 Put filters, sort order, and selection in typed search parameters, and verify that a reload restores the view
- [x] 8.5 Implement triage actions with optimistic update and undo, and verify with tests for success and for rollback on error
- [x] 8.6 Implement filters, text search, hidden groups, and the empty state, and verify with component tests
- [x] 8.7 Implement unread tracking, bulk selection, and bulk actions, and verify with component tests
- [x] 8.8 Implement keyboard shortcuts and the shortcut help, and verify full triage with the keyboard in an end-to-end test
- [x] 8.9 Apply live updates for runs, scores, and model status without row movement, and verify with a test that sends SSE events
- [x] 8.10 Build the first-start setup step and the settings screens, and verify the CV import path in an end-to-end test
- [x] 8.11 Implement login, persistent sessions, the login rate limit, and the local-only bind without a password, and verify with integration tests
- [x] 8.12 Check the screens for accessibility, and verify that each score band has a text label, that focus order follows the layout, and that motion respects the reduced motion setting

## 9. Application tracking

- [x] 9.1 Implement application create with the posting snapshot, and verify that a second create keeps one application
- [x] 9.2 Implement stage changes with stage history, and verify with integration tests
- [x] 9.3 Build the board with drag, keyboard move, and rollback on error, and verify with component tests
- [x] 9.4 Implement notes, interview date, the history view, and removal, and verify that removal returns the posting to "saved"

## 10. Notifications

- [x] 10.1 Implement topic generation with 120 random bits and topic regeneration, and verify with tests that names differ and that the old topic receives nothing
- [x] 10.2 Implement the ntfy publish call with title, link, priority, and tags, and verify with a stub server test that the body holds only title, company, score, and link
- [x] 10.3 Implement the `notify` task with the threshold, the first-score rule, `notified_at`, and the batching window, and verify each `notifications` scenario for high scores and batching with a test
- [x] 10.4 Implement retry with backoff and the failure record, and verify with a stub server that matching continues while the server fails
- [x] 10.5 Build the notification settings with enable, threshold, server address, subscribe link, regenerate, and test message, and verify with a component test
- [x] 10.6 Send one real test message to a generated topic on the public server, and verify that a subscribed phone or browser shows it

## 11. Operations and integration

- [x] 11.1 Implement scheduled and manual database backup with retention and download, and verify that a downloaded backup opens as a valid database
- [x] 11.2 Build the activity screen with fetch runs, failed tasks with retry, and logs, and verify with a component test
- [x] 11.3 Run one end-to-end flow on a clean container: import a CV, fetch from two sources, wait for scores, triage, and apply
- [x] 11.4 Stop the container during scoring and start it again, and verify that the queue resumes and no posting is lost
- [x] 11.5 Run `openspec validate rebuild-job-aggregator --strict` and verify that every spec scenario maps to a passing test

## 12. Writing tasks with Fable 5.2

- [x] 12.1 Add the `writing` lane and the Fable 5.2 client at medium effort, and verify the command arguments with a test
- [x] 12.2 Run the CV digest through the writing client, and verify with a real call that a profile is derived
- [x] 12.3 Add the cover letter table, task, prompt, and routes, and verify generation, edit, failure, and delete with tests
- [x] 12.4 Render the letter as a PDF file, and verify the download with a test and with one rendered page
- [x] 12.5 Add the cover letter section to the job detail and the application panel, and verify with a real letter and screenshots
- [x] 12.6 Add a component test for the cover letter section

## 13. Redesign and rename

- [x] 13.1 Rename the product to Sieve in the interface, the package, the data file, and the documents
- [x] 13.2 Replace the visual system: one dark grey theme, four color fields, no corner radius, hairline rules, a self-hosted grotesk font
- [x] 13.3 Show the jobs list as a virtual grid of cards with at most 6 columns, and keep the card width when the detail panel opens
- [x] 13.4 Show the posting detail and the board as connected tiles with notches
- [x] 13.5 Add arrow-key movement between cards in the grid
- [x] 13.6 Use one left edge for all screens, and place unequal detail tiles side by side in a wide panel
- [x] 13.7 Generate one real cover letter for a Danish posting, and verify the language and the PDF text
- [x] 13.8 Keep the opened posting in view when the column count changes, and verify with a component test and in a browser

## 14. Live order and expanded analysis

- [x] 14.1 Move a card to its new rank with a visible motion when a score arrives, and keep the keyboard cursor on its posting
- [x] 14.2 Add the expanded match analysis: table, writing task, routes, and the bulk action "analyze" with a limit of 20
- [x] 14.3 Show the analysis in the posting detail, a badge with the verdict on the card, and the "Analyze" action for selected postings
- [x] 14.4 Run one real analysis with Fable 5.2 on synthetic data, and verify the result in a browser
- [x] 14.5 Fetch the full job text for Jobindex postings through the "Se jobbet" link, and verify on real postings

## Workflow follow-up

- Archive the change after the end-to-end flow passes and the user accepts the result.
