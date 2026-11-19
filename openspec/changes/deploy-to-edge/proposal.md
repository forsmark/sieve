# Proposal

## Why

sieve runs only on the machine of its user. The user wants to open it from any device through the olympus-edge portal (`https://olympus.tailf4d52f.ts.net/sieve/`). The portal serves each app under its own path prefix and signs users in before a request reaches the app. sieve builds absolute URLs, has no health route at the path the platform probes, and cannot reach the user's host login for the Claude Code command line from inside the edge container.

## What Changes

- The interface and every API, event-stream, PDF and backup URL work under the path prefix the build names (`APP_BASE`). Without `APP_BASE` the prefix is `/` and local use is unchanged.
- A health route `GET /healthz` and a public `GET /icon.png` (512x512), both without a login.
- An optional allowed gateway user (`EDGE_ALLOWED_USER`). When it is set, the system accepts a request only when the gateway's `X-User` header names that user. Other portal users get 403. The health route and the icon stay open.
- When `EDGE_ALLOWED_USER` is set and `HOST` is not, the server binds to all addresses, because the gateway does the sign-in.
- The HTML head gets the portal manifest link and the Apple web-app tags when the build has a prefix other than `/`.
- A root `Containerfile` for the platform: it accepts `ARG APP_BASE`, installs the Claude Code command line, runs as uid 1000, keeps data under `/data`, and checks `/healthz`. Claude Code signs in with the `CLAUDE_CODE_OAUTH_TOKEN` environment variable from `claude setup-token`. The token is set on the platform with `portal app env set`, never in the repo.
- README: a section on hosting on olympus-edge.

## Capabilities

### New Capabilities

- `edge-hosting`: running sieve behind a gateway that serves it under a path prefix and signs users in: the prefix, the health route, the public icon and the allowed gateway user.

### Modified Capabilities

None. The Access control requirement in `job-browsing` keeps its meaning: the password check still applies when a password is set, also behind the gateway.

## Impact

- Client: `src/client/src/api/client.ts`, `endpoints.ts`, `events.ts`, `app/router.tsx`, `index.html`, `vite.config.ts`.
- Server: `src/server/http/app.ts`, `src/server/config.ts`, a new `src/server/http/edge.ts`.
- New files: `Containerfile`, `src/client/public/icon.png`. The existing `Dockerfile` and `docker-compose.yml` stay for local container use.
- Platform: register sieve as a gated app, set `EDGE_ALLOWED_USER` and `CLAUDE_CODE_OAUTH_TOKEN`, deploy.
- Privacy: as today, posting text and CV text go to Anthropic through Claude Code. The OAuth token gives the container access to the user's Claude plan, so it lives only in the platform's 0600 env file.

## Claims checked

- job-browsing › Access control: "the system SHALL require [the password] before it shows any data or accepts any change". Applies only when a password is set. The gateway check adds a second check and removes none, so no conflict.
- job-browsing › Backups: "SHALL let the user … download any stored backup". The backup link must carry the prefix. Covered by the path-prefix requirement.
- notifications › Notification content: "a link that opens the posting in the application". The link comes from the "Address of this app" setting. With `https://olympus.tailf4d52f.ts.net/sieve` the link joins to `/sieve/jobs?id=…`, which works. No change.
- job-matching › Language model provider selection: "the Claude Code command line that is installed on the same machine". In the container the command is installed in the image, which is the same machine as the server. No change.
