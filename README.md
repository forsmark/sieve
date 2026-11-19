# sieve

A personal job aggregator for one user. It fetches job postings from public job boards, compares each posting with your CV, ranks the postings, and tracks your applications. It runs as one process with one SQLite file.

## What it does

- Fetches postings from Jobindex, LinkedIn (guest search), Remotive, Arbeitnow, and Remote OK on a schedule.
- Removes duplicates of the same job across boards.
- Derives a structured profile from your CV. You can correct it by hand.
- Scores each posting in two stages. A language model extracts the facts of the posting and judges skills, experience, and preferences. Code checks location, spoken language, work arrangement, and excluded companies, and computes the total from your weights. You can remove location from the score in the preferences, which fits a search that already limits the location.
- Shows a ranked list with filters, keyboard shortcuts, and an explanation for each score.
- Writes a cover letter for a posting from your CV. You can edit it, copy it, and download it as a PDF file.
- Writes an expanded match analysis for the postings you select, with a verdict, strengths, gaps, and questions to ask.
- Tracks applications on a board with stages, notes, and interview dates.
- Sends a push notification through ntfy when a new posting scores high. This is optional.

## Requirements

- Node.js 24 or later and pnpm.
- One language model provider: a local OpenAI-compatible server, or the Claude Code command line.
- The Claude Code command line for the CV digest, cover letters, and the expanded analysis. Without it, fill the profile by hand.

## Start on your machine

```sh
pnpm install
pnpm build
pnpm start
```

Open http://localhost:3000. The interface asks for your CV and your search terms.

For development, run the server and the client with reload:

```sh
pnpm dev
```

The client then runs on http://localhost:5173 and sends API calls to port 3000. The dev server listens on the local machine only. Set `DEV_HOST=0.0.0.0` to open it to your network, and set `AUTH_PASSWORD` when you do.

## Start in a container

The compose file works with podman and with Docker.

```sh
podman-compose up -d --build
```

With Docker, use `docker compose up -d --build`.

Open http://localhost:3000. The data is in the volume `sieve-data`.

The compose file opens the port on the local machine only. To reach the application from other machines, change the port line and set a password:

```sh
AUTH_PASSWORD='a long password' podman-compose up -d --build
```

This setup was tested with rootless podman 5.7 and podman-compose. It was not tested with Docker.

## Configuration

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | The port of the server. |
| `DATA_DIR` | `./data` | The directory of the database and the backups. |
| `AUTH_PASSWORD` | not set | The login password. Without it there is no login. |
| `HOST` | `127.0.0.1` without a password, `0.0.0.0` with one | The address the server binds to. |

Without `AUTH_PASSWORD` the server accepts connections from the local machine only. All other settings are in the interface.

## Language model providers

Select the provider under Settings. Use "Save and test" to check new settings before they are stored. "Test saved settings" checks the stored ones again.

### Local endpoint (default)

Any server with the OpenAI chat completions API works. Enter the base URL and the model name.

| Server | Base URL | Model name example |
| --- | --- | --- |
| Ollama | `http://localhost:11434` | `gemma3:27b` |
| LM Studio | `http://localhost:1234` | the identifier that LM Studio shows |
| llama.cpp server | `http://localhost:8080` | the name passed with `--alias` |
| Lemonade Server | `http://localhost:13305/api/v1` | the name that `lemonade list` shows, for example `gemma-4-E4B-it-GGUF-Q4_K_M` |

From a container, use `http://host.docker.internal:<port>` to reach a server on the host. With rootless podman that name can refuse the connection. Then use the network address of the host, for example `http://192.168.1.10:<port>`, and make the model server listen on that address.

The system asks for JSON schema output. If the server rejects that, the system uses JSON mode and validates the result. A model of 12 B parameters or more is recommended.

The Lemonade Server address was tested with the endpoint test and with a full matching run. See `docs/matching-eval.md`. The llama.cpp server address form was tested against the llama.cpp server that Lemonade starts. The Ollama and LM Studio addresses follow the documentation of each server and were not tested.

A small model such as Gemma 4 E4B ranks postings in a sensible order but gives higher scores than the Claude Code provider, by about 20 points in the evaluation. Raise the notification threshold if you use one.

Gemma 4 26B A4B (`gemma-4-26B-A4B-it-GGUF-UD-IQ4_XS` on a GPU with 16 GB) gave scores close to the Claude Code provider in the evaluation, at 11 seconds for each posting. Turn reasoning off on the model server for such a model, for example with `--reasoning-budget 0` on a llama.cpp server. With reasoning on, calls passed the time limit of 180 seconds and matching stopped. `docs/matching-eval.md` has the load options.

### Claude Code

This provider starts the installed `claude` command once for each model call:

```sh
claude -p --model claude-haiku-5-5 --effort <low|medium> --output-format json --json-schema <schema> --tools "" --no-session-persistence --system-prompt <instructions>
```

The posting text goes to standard input. The command gets no tools. The model is always Haiku 5.5. You select the effort level, low or medium.

Host setup:

1. Install Claude Code and run `claude` once to log in.
2. Start sieve as the same user, so the command finds the login.
3. Select "Claude Code" under Settings.

Container setup: the image does not contain Claude Code. Add `RUN npm install -g @anthropic-ai/claude-code` to the `Dockerfile`, and mount your login into the container, for example `~/.claude:/root/.claude` and `~/.claude.json:/root/.claude.json`. This setup was not tested.

With this provider, posting text and your profile data leave your machine and go to Anthropic. Each posting needs two calls. The usage counts against your Claude Code plan.

### CV digest, cover letters, and expanded analysis

These three tasks always use Fable 5.2 at medium effort through the `claude` command:

```sh
claude -p --model claude-fable-5-2 --effort medium --output-format json --json-schema <schema> --tools "" --no-session-persistence --system-prompt <instructions>
```

The provider setting does not change this. Your CV text goes to Anthropic for these tasks, also when you selected the local endpoint for matching. They do not wait for posting scores.

Open a posting and select "Generate cover letter". The letter uses the language of the posting. You can add an instruction for one letter, for example a word limit. The system stores one letter for each posting. The model gets a rule to use only facts from your CV, but check every claim before you send the letter. The PDF uses a standard font that covers Western European text.

Open a posting and select "Run expanded analysis", or select cards in the list and select "Analyze". Fable 5.2 compares the full posting with your CV and preferences. It gives a verdict of "Apply", "Consider", or "Skip", strengths with evidence from your CV, gaps with a severity, questions to ask the employer, and points to emphasize. The analysis does not change the score. One request takes at most 20 postings, and each posting is one model call of about 20 seconds. The system stores one analysis for each posting, and the card shows the verdict.

`docs/matching-eval.md` shows results and times for 20 real postings at both effort levels.

## Notifications

Under Settings, enable notifications. The system generates a topic name with 120 random bits and shows a subscribe link. Open the link in the ntfy app or in a browser.

- The default server is the public server `https://ntfy.sh`. You can enter your own server.
- Topics on the public server have no password. Everyone who knows the topic name can read the messages. Keep the name private, and regenerate it if it leaks.
- A message holds only the title, the company, the score, and a link to your installation. It never holds CV text, profile data, or assessment text.
- A posting notifies at most once, when its first score is at or above the threshold. The default threshold is 80.
- Postings that score within the batching window arrive as one message. The window is 120 seconds by default.
- Set "Address of this app" so the link in the message opens your installation.

## Backups

The system writes a copy of the database to `DATA_DIR/backups` every 6 hours and keeps the newest 10. Under Activity you can create a backup and download one. To restore, stop the server and replace `DATA_DIR/sieve.db` with the backup file.

## Job boards and terms of use

The system reads public pages and public APIs with a low request rate for each board. The LinkedIn guest search has no official support and can change or stop. The terms of each board remain your responsibility. You can disable each source under Settings.

A Jobindex search result holds only a teaser. For each Jobindex posting, the system opens the job page and follows the "Se jobbet" link to the full text. That link leads to an advertisement on Jobindex or to a page of the employer, so the system also reads pages on employer sites. This costs two more requests for each posting, at the Jobindex rate of one request in 2 seconds. When the full text is not reachable, the posting keeps the teaser. To fetch the full text for an older posting, select it and select "Rescore".

## Development

```sh
pnpm test        # all tests
pnpm e2e         # browser end-to-end tests, needs google-chrome, no network
pnpm typecheck   # TypeScript
pnpm lint        # ESLint
pnpm check       # typecheck, lint, and spec checks
```

Tests always use an in-memory database and never open `DATA_DIR`.

Structure:

```
src/shared/            Zod schemas and API types for server and client
src/server/kernel/     database, task queue, events, settings, logger
src/server/sources/    adapter contract, HTTP client with rate limit, fetch runner, schedule
src/server/ingestion/  normalization, duplicates, description fetch, link check
src/server/profile/    CV import, profile derivation, preferences, versions
src/server/matching/   extract, constraints, judge, score, rescore planner
src/server/llm/        local endpoint client and Claude Code client
src/server/letters/    cover letters and PDF
src/server/analysis/   expanded match analysis
src/server/notifications/  ntfy
src/server/applications/   application tracking
src/server/http/       API routes, login, backups
src/client/            React interface
drizzle/               SQL migrations
openspec/              specification of the behaviour
```

### Add a job board

1. Create `src/server/sources/adapters/<name>.ts` that exports a `SourceAdapter`. See `adapter.ts` for the contract.
2. Add a recorded fixture and a parser test next to it.
3. Add the adapter to the list in `src/server/sources/registry.ts`.
4. When the search result holds only a teaser, set `teaserOnly` and add `fetchDescription`. See the Jobindex adapter.

### Change the database

Edit `src/server/kernel/schema.ts`, then run `pnpm db:generate`. The server applies new migrations at startup.
