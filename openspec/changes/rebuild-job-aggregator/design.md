# Design

## Context

See proposal.md for the motivation. This design starts from an empty repository. The first version at github.com/forsmark/newera is the behavior reference. Its code shows the defects that this design must remove:

- `fetchJobs` in the old scheduler repeats one block per source with a fixed 30 second sleep between sources. Seven sources take more than three minutes of sleep.
- The scoring queue is an in-memory `Map`. A restart loses the queue, and startup rebuilds it with a table scan.
- Sessions, pause flags, and the last fetch time live in memory.
- The schema changes through `try { ALTER TABLE } catch {}` statements.
- One prompt returns one integer. The prompt carries location rules for Denmark as literal text.
- A hash of CV and preferences marks scores as stale. Every change forces a full language model call for each posting.
- Three provider functions call three different HTTP APIs, and a 60-line function repairs broken JSON.
- The jobs view is one 1028-line component that polls the server.

Constraints: one user, self-hosted, one machine, one process. The language model can be slow. A local model can need 10 to 60 seconds for each posting.

## Goals / Non-Goals

**Goals:**

- One process and one database file. `docker compose up` starts everything.
- A new source needs one new file and one registry line.
- A restart loses no work.
- Each score is explainable from stored data.
- A preference change costs as few language model calls as possible.
- The interface shows state changes without polling.

**Non-Goals:**

- Horizontal scaling or more than one worker process.
- A browser-driven scraper. Adapters use HTTP requests only.
- Embedding search or a vector index. The user decided to leave it out of this change.
- Import of data from the first version.

## Decisions

### D1. Stack: Node 24, Hono, React, SQLite

The user chose this stack on 2026-11-11:

- **Runtime and packages:** Node 24 with pnpm. `tsx` runs the TypeScript server.
- **Server:** Hono with the Node adapter.
- **Database:** SQLite through `better-sqlite3`, with Drizzle for the schema and the migrations.
- **Client:** React with Vite, Tailwind CSS, Framer Motion, and the TanStack libraries Query, Router, and Virtual.
- **Tests:** Vitest for server and client.

Alternative: Bun, as in the first version. Rejected by the user. Bun is not installed on the target machine.

Alternative: Next.js. Rejected, because the system needs a long-lived worker process, and a separate worker next to Next.js adds a second process for no gain.

Alternative: Postgres. Rejected, because one user and one writer do not need it, and a file database makes backup a file copy.

### D2. Modular monolith with one module for each capability

The server has one module for each capability, plus a shared kernel:

```
src/server/
  kernel/        db, migrations, task queue, event bus, config, logger
  sources/       adapter contract, registry, adapters/*, fetch runner
  ingestion/     normalize, dedup, enrich, liveness
  profile/       cv import, structured profile, preferences, versions
  matching/      extract, constraints, judge, score, rescore planner
  applications/  board, stage history, snapshots
  notifications/ ntfy client, topic, notify task
  llm/           provider contract, openai-compatible client, claude code client, schemas
  http/          routes, SSE endpoint, auth
src/shared/      Zod schemas and types used by server and client
src/client/      React application
```

Each module exports a small interface. A module imports another module only through that interface. The modules communicate in two ways: they enqueue tasks, and they publish events.

Alternative: separate services. Rejected for a single-user tool.

### D3. Source adapter contract

Each source implements one interface:

```ts
interface SourceAdapter {
  id: string;
  name: string;
  supports: { keywords: boolean; region: boolean };
  rate: { minDelayMs: number; maxConcurrent: number };
  search(query: SearchQuery, ctx: FetchContext): AsyncIterable<RawPosting>;
  fetchDescription?(posting: StoredPosting, ctx: FetchContext): Promise<string | null>;
}
```

`FetchContext` gives the adapter an HTTP client that applies the adapter's rate limit, a retry with backoff on HTTP 429 and 5xx, a timeout, and an abort signal. Adapters do not sleep and do not write to the database.

The fetch runner starts all enabled adapters in parallel. Each adapter talks to a different host, so the rate limit is per adapter. The runner writes a `fetch_runs` row and one `fetch_run_sources` row for each adapter. This replaces the fixed sleep between sources.

An adapter yields postings as a stream. The runner passes each posting to ingestion as it arrives. A timeout therefore keeps the postings that arrived before it.

Each adapter has a test that parses a recorded response fixture. The first set has five adapters: Jobindex, LinkedIn guest API, Remotive, Arbeitnow, and RemoteOK. InfoJobs and Tecnoempleo from the first version are not part of this change.

### D4. Durable task queue in SQLite

One `tasks` table drives all background work:

```
tasks(id, kind, subject_id, payload, state, attempts, run_after,
      locked_at, last_error, created_at)
state: pending | running | done | failed
kind:  enrich | extract | constraints | judge | score | liveness | derive_profile | cover_letter | notify
```

A unique index on `(kind, subject_id)` for non-finished tasks removes duplicate work. One worker loop claims the next task whose `run_after` is in the past. At startup the worker resets `running` tasks to `pending`.

Each kind has a concurrency lane. Language model kinds share one lane with concurrency 1. Network kinds use a second lane. The code kinds `constraints` and `score` use a third lane. A failed task gets a later `run_after` with exponential backoff and moves to `failed` after the retry limit.

The scheduler is also data. A `schedule` row holds the interval, the paused flag, and the next run time. A timer checks it once a minute.

Alternative: a queue library with Redis. Rejected, because it adds a service.

### D5. Two-stage matching

The old design asked the model one question for each posting: "how good is this job for this CV?" The new design splits the work in four steps. Only two steps call the model.

1. **Extract** (model, once for each posting). Input: the posting text. Output: `PostingFacts` with required skills, optional skills, seniority, work arrangement, location, required languages, salary, and summary. The result does not depend on the profile.
2. **Constraints** (code). Input: `PostingFacts` and the preferences for location, language, work arrangement, and excluded companies. Output: excluded or not with a reason for hard constraints, and a list of violated soft constraints. An unknown fact never excludes.
3. **Judge** (model, once for each posting and profile content version). Input: `PostingFacts`, the structured profile, and the preferences that code cannot evaluate: target seniority, salary, wanted and unwanted technologies, and notes. Output: a score from 0 to 100 for skills fit, experience fit, and preference fit, plus matched skills, missing skills, and an assessment. Excluded postings skip this step.
4. **Score** (code). Location fit comes from the facts and the location preferences. The total is the weighted mean of the four dimension scores, minus a fixed penalty for each violated soft constraint on language or work arrangement.

The judge receives extracted facts and the structured profile, not the raw texts. The input is short, so the call is faster and the output is more stable.

The profile version has two parts:

- `judge_version`: a hash of the structured profile and the preferences that the judge reads.
- `rule_version`: a hash of the weights, the excluded companies, and the location, language, and work arrangement preferences with their hard or soft flags.

The rescore planner compares the versions stored on each match with the current versions:

| Changed | Work for each posting |
|---|---|
| `rule_version` only | constraints and score, in code |
| `judge_version` | judge, then score |
| posting description | extract, judge, score |

A weight change becomes one SQL-level recompute. This replaces the single hash of the first version.

Alternative: keep one prompt and add sub-scores to its output. Rejected, because every preference change would still need a model call for each posting.

### D6. One language model contract with two providers

The `llm` module exposes one function:

```ts
generateObject<T>(schema: ZodSchema<T>, messages: Message[], opts): Promise<T>
```

Two providers implement it. A setting selects one.

**Local endpoint (default).** One client calls the OpenAI-compatible chat endpoint with JSON schema output. Ollama, LM Studio, and llama.cpp all serve this API. One client replaces the three provider functions of the first version.

**Claude Code command line (option).** The client starts the locally installed `claude` command once for each call:

```
claude -p --model claude-haiku-5-5 --effort <low|medium> \
  --output-format json --json-schema '<schema>' \
  --tools "" --no-session-persistence --system-prompt '<instructions>'
```

The prompt goes to the process on standard input, so posting text never appears in the process list. `--tools ""` removes all tools, so the model can only answer. `--json-schema` makes the command return an object that fits the schema. The effort level is a setting with the values low and medium. The model is fixed to Haiku 5.5. The command uses the login of the Claude Code installation, so the application stores no API key.

The Claude Code provider keeps the language model lane at concurrency 1. Each call has a timeout, and a timeout kills the child process.

Both providers validate each response with the Zod schema. On a validation failure the client retries with the error text. It does not repair JSON by regular expression.

The health probe depends on the provider. For the local endpoint it requests the model list. For Claude Code it runs `claude --version` on a schedule, and a failed call with an authentication error marks the provider as unavailable. The probe sends no model request, so it costs nothing.

`posting_facts` and `matches` store the provider and model that produced them. A provider change does not make stored results stale.

The probe runs every 30 seconds. When it fails, the worker pauses the language model lane and publishes an event. When it succeeds again, the lane resumes.

### D7. Data model

```
postings         id, source, external_id, title, company, location, url,
                 description, posted_at, first_seen_at, fingerprint,
                 duplicate_of, link_status, link_checked_at,
                 triage_status, triage_origin, read_at
posting_facts    posting_id, facts_json, description_hash, model, created_at
matches          posting_id, judge_version, rule_version, excluded_reason,
                 skills_score, experience_score, preference_score,
                 location_score, total_score, matched_skills, missing_skills,
                 assessment, state, model, created_at
profile          id=1, cv_text, derived_json, edits_json, judge_version
preferences      id=1, prefs_json, rule_version
applications     posting_id, stage, notes, interview_at, applied_at, snapshot_json
application_events  id, posting_id, from_stage, to_stage, created_at
fetch_runs       id, trigger, started_at, ended_at, state
fetch_run_sources  run_id, source, state, found, new, invalid, error
tasks            see D4
schedule         id=1, interval_hours, paused, next_run_at
sessions         token_hash, expires_at
settings         key, value
notifications    id, posting_ids, state, attempts, created_at, sent_at
```

`matches` has a `notified_at` column. It gives the rule "at most one notification for each posting".

Drizzle defines the schema and generates versioned SQL migrations. The server applies pending migrations at startup. `UNIQUE(source, external_id)` on `postings` gives idempotent ingestion. Indexes cover `fingerprint`, `(triage_status, total_score)`, and the task claim query.

`profile.derived_json` and `profile.edits_json` stay separate. The effective profile is the derived profile with the edits applied on top. A new derivation therefore keeps the manual edits.

### D8. Duplicate detection

Detection has two steps, as in the first version, with one fix.

1. Exact: equal `fingerprint`, which is the normalized title joined with the normalized company.
2. Fuzzy: equal normalized company, and a title token overlap of at least 0.6 or one title contained in the other.

The fix: the first version loaded every posting to run the fuzzy step. The new version adds a `company_key` column with an index and reads only postings of the same company.

The first posting stays primary. A later duplicate gets `duplicate_of`. The user can clear `duplicate_of` by hand.

### D9. Live updates over server-sent events

The server has an in-process event bus. Modules publish events such as `run.progress`, `posting.added`, `match.updated`, and `llm.status`. One SSE endpoint forwards them to the client.

The client uses TanStack Query for server state. An SSE handler patches or invalidates the matching query. A new score updates the row in place. The list changes its order only when the user asks for a refresh, so rows do not move while the user reads.

Alternative: WebSocket. Rejected, because the data flows one way.

Alternative: polling, as in the first version. Rejected, because it delays updates and loads the server for no reason.

### D10. Frontend structure

Routes with TanStack Router: `/jobs`, `/jobs/$id`, `/board`, `/settings/*`, `/activity`. Filters, sort order, and the selected posting are typed search parameters. This gives the shareable view state that the spec requires.

The jobs screen has two panes on wide screens: the ranked list on the left and the detail on the right. On narrow screens the detail is a separate route. The list is virtualized.

Each feature has a folder with its components, queries, and tests. No component file holds more than one screen's logic. Styling uses Tailwind with a small set of design tokens for the score bands. Each band has a color and a label.

Mutations are optimistic with rollback. Each triage action returns the earlier status of each posting. The client sends that list back to undo the action. No server-side undo state exists.

### D11. Authentication

Access control is optional and has one password, set through an environment variable. The server stores session token hashes in the `sessions` table, so sessions survive a restart. The cookie is HTTP-only with `SameSite=Lax`. Login attempts have a rate limit.

Without a password the server binds to `127.0.0.1` only. With a password it can bind to all interfaces.

### D12. Deployment and backup

One Dockerfile builds the client and runs the server. One volume holds the database file. A backup is a `VACUUM INTO` copy on a schedule, with a retention count. The activity screen shows fetch runs, task failures, and the log.

### D13. Notifications through ntfy

The `notifications` module sends an HTTP POST to `<server>/<topic>`. The default server is `https://ntfy.sh`. The request sets the `Title`, `Click`, `Priority`, and `Tags` headers. `Click` holds the link to the posting, built from an application base URL setting.

The topic is public. Any person who knows the topic name can read the messages and can publish to the topic. Two rules follow:

- The topic name is `sieve-` plus 24 random characters from a base32 alphabet. That is 120 bits from a cryptographic random source. The user can regenerate it at any time.
- A message holds only the title, the company, the score, and the link. It holds no CV text, no profile data, and no assessment. The application never reads from the topic, so a message that a third party publishes cannot affect the application.

The `score` task enqueues a `notify` task when a posting gets its first score at or above the threshold and `notified_at` is empty. The `notify` task waits for a batching window of two minutes, collects all postings that qualify, and sends one message. A run that scores many postings therefore sends one message, which also stays far below the rate limit of the public server. The task runs in the network lane with the normal retry and backoff.

Alternative: Telegram, as in the first version. Rejected by the user in favor of ntfy, which needs no bot and no account.

Alternative: a private topic with an access token on a self-hosted server. Not built now. The server address is a setting, so a later change can add a token field.

## Risks / Trade-offs

- [Two model calls for each new posting, where the first version used one] → Extraction input is only the posting. The judge input is short structured data. The extract result is reused for every later rescore, so the total cost falls after the first profile change.
- [The Claude Code provider sends posting text and profile data to a hosted service] → It is an option, not the default. The settings screen states this when the user selects it.
- [The `claude` command is not available inside the Docker container] → The provider needs the command and its login on the machine that runs the server. The README documents two setups: run the server on the host, or mount the command and its configuration directory into the container. The provider test in settings reports a missing command or login.
- [A process start for each call makes the Claude Code provider slow for a large backlog, and each call counts against the user's Claude usage] → The queue takes the newest postings first, and the interface shows queue length. Task 7.9 measures the time for each posting with both providers.
- [A third party learns the ntfy topic name and reads job titles or publishes false messages] → The name has 120 random bits. Messages hold no personal data. The user can regenerate the topic. The application never acts on topic content.
- [A local model may not support JSON schema output] → The client falls back to JSON mode with schema validation and retry. The settings screen tests this when the user saves the endpoint.
- [Extraction errors lead to wrong exclusions] → An unknown fact never excludes. The detail view shows the extracted facts and the exclusion reason. The user can show excluded postings.
- [Job boards change their markup or block requests] → Fixture tests for each adapter detect parse changes. Failure isolation keeps the other sources running. The run history shows the error.
- [The LinkedIn guest endpoint has no official support and limits requests hard] → The adapter has a conservative rate and is the first candidate to disable. The terms of each board remain the user's responsibility.
- [Fuzzy duplicate detection merges different roles] → The user can separate a duplicate. The threshold is one constant with tests on real title pairs from the first version.
- [SQLite allows one writer] → One worker process, WAL mode, and short transactions. This load is far below the limit.
- [A single worker with a slow local model takes hours for a large backlog] → The queue orders by posted date, newest first. The interface shows queue length and estimated time.

## Migration Plan

No data migrates. The steps to first use:

1. Start the container with an empty volume.
2. Import the CV and confirm the structured profile.
3. Set preferences, search terms, and the language model endpoint.
4. Start the first fetch run.

Rollback: stop the container. The first version and its database are unchanged.

## Decisions by the user

The user answered the open questions of the first draft on 2026-11-11:

- **Sources:** five adapters ship first. See D3.
- **Deferred features:** attachments and data import stay out. Cover letters are in. See D14. Notifications move in, through ntfy on a public topic with a generated name. See D13.
- **Language model:** the local endpoint is the default. The Claude Code command line with Haiku 5.5 at low or medium effort is an option. See D6. The CV digest and cover letters always use Fable 5.2 at medium effort. See D14.
- **Embedding prefilter:** not in this change.
- **Default weights:** skills 40, experience 25, preferences 20, location 15.

## Open Questions

- **Batching window and notification threshold defaults.** The design uses two minutes and a score of 80. Tune them after the first week of use.
- **Default effort for the Claude Code provider.** The design uses low. Task 7.9 compares low and medium on real postings.

## D14: Writing tasks use Fable 5.2

The CV digest and cover letters are writing tasks. They always run `claude -p --model claude-fable-5-2 --effort medium`, with the same flags as D6. The matching provider setting does not change this. With the local endpoint selected, CV text still goes to Anthropic for these two tasks, and the settings screen says so.

- **Lane:** the task kinds `derive_profile` and `cover_letter` run in a lane named `writing` with one worker. A long match queue, a paused match queue, or a blocked match lane does not delay them.
- **Failure:** a writing task does not retry in the queue and does not block a lane. The system stores the cause, and the user starts the task again. Without the `claude` command, the user fills the profile by hand and cover letters are not available.
- **Storage:** the table `cover_letters` holds one row for each posting: state, text, language, instruction, error, model, edited flag, and times. A failed regeneration keeps the earlier text.
- **Prompt:** the model gets the posting, the extracted facts, the CV text, the effective profile, and the instruction. The rules forbid invented facts. The user must still check every claim.
- **PDF:** `pdf-lib` renders the text on A4 pages with a standard font. That font covers Western European text. Other characters print as "?".
