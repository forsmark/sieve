# Proposal

## Why

The first version of newera proved the idea: scrape job postings, score them against a CV, and show a ranked list. Its structure now limits it. Each source is a copied block in one fetch function. The score is one opaque number from one prompt. Queue and scheduler state live in memory. The scoring prompt hardcodes location rules for Denmark. This change rebuilds the product from an empty repository with the same principles and a structure that supports them.

## What Changes

- Add a source adapter contract. Each job board is one adapter with its own rate limit, and one failed source does not stop the others.
- Add a durable ingestion pipeline. It normalizes postings, removes duplicates across sources, fetches missing descriptions, and checks that links still work.
- Add a structured candidate profile. The system parses the CV into skills, experience, and languages. The user reviews and edits the result.
- Replace the single opaque score with a two-stage match. Stage one extracts facts from each posting once. Stage two scores those facts against the profile and returns sub-scores, matched skills, missing skills, and a short explanation.
- Apply hard constraints in code, not in the prompt. Location, language, and company exclusions come from the user's preferences.
- Rescore only what changed. A change to weights, excluded companies, or a location, language, or work arrangement preference does not call the language model again.
- Add a ranked job interface with a list and detail layout, filters, keyboard triage, a score breakdown, and live progress.
- Add application tracking with stages, notes, and a stage history.
- Keep all work state in the database so that a restart loses no queued work.
- Add an activity view with fetch runs, failed work, and logs, and add scheduled database backups.
- Add push notifications for new high-scoring postings through an ntfy topic with a generated name.
- Support two language model providers: a local endpoint as the default, and the locally installed Claude Code command line as an option.

Not in this change:

- Telegram notifications. ntfy replaces them.
- The InfoJobs and Tecnoempleo sources of the first version. The adapter contract lets a later change add them.
- An embedding prefilter for the match queue.
- Cover letter generation.
- File attachments on applications.
- Multiple user accounts.
- Data migration from the first version. The user starts with an empty database.

## Capabilities

### New Capabilities

- `job-sources`: Source adapters, search configuration, scheduled and manual fetch runs, rate limits, and run history.
- `job-ingestion`: Normalization of raw postings, duplicate detection across sources, description enrichment, and link liveness checks.
- `candidate-profile`: CV import, the structured profile, job preferences, and profile versions.
- `job-matching`: Fact extraction from postings, hard constraints, sub-scores, the total score, explanations, and rescoring.
- `job-browsing`: The ranked job list, filters, the detail view, triage actions, live progress, settings screens, the activity view, and backups.
- `application-tracking`: The application board, stages, notes, dates, and stage history.
- `notifications`: Push notifications for high-scoring postings through ntfy, the generated topic, and delivery handling.

### Modified Capabilities

None. The repository has no existing specs.

## Impact

- New codebase in an empty repository. No existing code changes.
- New dependencies: a web server, a database with a migration tool, a frontend framework, and a language model endpoint. See design.md for the choices.
- External systems: the job boards that the adapters read, one language model provider, and an ntfy server. The default ntfy server is the public one.
- With the Claude Code provider, posting text and profile data leave the machine. With the local endpoint they do not.
- The first version at github.com/forsmark/newera stays unchanged and serves as a behavior reference.
