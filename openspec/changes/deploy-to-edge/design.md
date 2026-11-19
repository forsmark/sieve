# Design

## Context

The olympus-edge platform builds `git archive HEAD` of the repo with `--build-arg APP_BASE=/sieve/`. It runs the image rootless as uid 1000 with `/data` mounted, probes `/healthz` within 30 seconds, and puts Caddy in front. Caddy strips the `/sieve` prefix before the request reaches the app. It sends `X-User`, `X-User-Id` and `X-Forwarded-Prefix` only after the gateway approves the session, and it strips client copies of those headers. The container cannot read anything from the host. The `claude` command and its login must therefore come from the image and the environment.

Today the client calls absolute paths (`/api/...`, `new EventSource('/api/events')`, `href="/jobs"`), the router has no base path, and the server serves `dist/client` at `/`.

## Goals / Non-Goals

**Goals:**
- One build serves both local use (prefix `/`) and the edge (prefix `/sieve/`).
- Only the named portal user can open sieve.
- Claude Code works in the container with the user's plan.

**Non-Goals:**
- Using `@edge/app-kit`. sieve only needs one header comparison, and the package lives in another repo.
- Removing the existing `Dockerfile` and `docker-compose.yml`. They stay for local container use.
- Per-user data. sieve stays a single-user app.

## Decisions

**Prefix from Vite's `BASE_URL`.** `vite.config.ts` sets `base: process.env.APP_BASE ?? '/'`. The client reads `import.meta.env.BASE_URL` in one helper, `apiPath(path)`, which `request`, `EventSource` and the download URLs use. The router gets `basepath` from the same value. The server needs no prefix logic, because Caddy strips the prefix. A runtime prefix from `X-Forwarded-Prefix` was rejected: it would need the server to rewrite `index.html` and every asset URL, while the platform already passes the prefix at build time.

**Gateway check on `X-User`, the display name.** `EDGE_ALLOWED_USER=Marc` is compared exactly with `X-User`. The name is what `portal user list` shows, so the user can set it without looking up an internal id. A rename through `portal user rename` locks the user out until the variable is updated. The admin makes renames, so this is acceptable. The check is a Hono middleware registered before every route, with `/healthz` and `/icon.png` exempt. A refusal answers 403 with a short plain text and logs the refused name, not the path or the query.

**Bind address.** `config.host` defaults to `0.0.0.0` when `AUTH_PASSWORD` or `EDGE_ALLOWED_USER` is set. The startup warning about an open port stays for the case without both.

**Manifest and Apple tags only with a prefix.** A small Vite plugin adds `<link rel="manifest" href="/_auth/manifest/<id>.webmanifest" crossorigin="use-credentials">`, `<link rel="apple-touch-icon" href="icon.png">` and the `apple-mobile-web-app-*` meta tags when `APP_BASE` is not `/`. The id is the last segment of the prefix. Local builds stay free of a link to a route that does not exist.

**Icon.** `src/client/public/icon.png`, 512x512, in the colors of DESIGN.md. Vite copies it to `dist/client/icon.png`. The server serves it at `/icon.png` from the static handler, before the gateway check.

**Containerfile.** It uses `node:24-bookworm-slim`, because better-sqlite3 and the Claude Code binary need glibc. It installs Claude Code with `pnpm add -g @anthropic-ai/claude-code@<pinned>`, with `DISABLE_AUTOUPDATER=1`. It builds the client with `APP_BASE` and runs as the `node` user (uid 1000) with `HOME=/home/node`. The server runs through `tsx`, as in the current Dockerfile. `HEALTHCHECK` runs `wget -qO- http://localhost:3000/healthz`. Claude Code reads `CLAUDE_CODE_OAUTH_TOKEN` from the environment that `spawn` inherits. The token comes from `claude setup-token`. It is a long-lived token for the user's subscription, so usage still counts against the plan. Mounting `~/.claude` was rejected: edge containers must not get host access.

## Risks / Trade-offs

- [Another container on the `edge` network could reach `sieve:3000` directly and send its own `X-User`] → The other edge apps belong to the same user. For defence in depth, `AUTH_PASSWORD` can be set as well, and the existing login then applies on top.
- [The OAuth token leaks] → It lives only in the platform's 0600 env file. It is never logged, and `portal app env list` shows names only. Revoke it on claude.ai and run `setup-token` again.
- [A Claude Code release changes flags or output] → The version in the Containerfile is pinned and the auto-updater is off. An upgrade is a deliberate commit.
- [Claude Code writes config to `HOME`, which is lost on redeploy] → sieve runs `claude` with `--no-session-persistence` and needs no state between calls. The token login needs no files.

## Migration Plan

1. Merge to `main`, then `portal app add sieve --name "Sieve" --src ~/development/sieve`.
2. Set `EDGE_ALLOWED_USER=Marc` with `portal app env set`. The user sets `CLAUDE_CODE_OAUTH_TOKEN` by typing it into `portal app env set` themselves.
3. `portal app deploy sieve`. Under Settings, select Claude Code, run "Save and test", and set "Address of this app" to `https://olympus.tailf4d52f.ts.net/sieve`.
4. The edge install starts with an empty database. The user uploads the CV and enters the search terms again. Moving a local database is out of scope, because `/srv/edge` is reachable only through `portal`.
5. Rollback: `portal app deploy` rolls back by itself when the health check fails. `portal app remove sieve` takes it off the edge and keeps the data.

## Changed during apply

### 2026-11-19: Claude Code is the latest release, not a pinned one

The owner chose the latest Claude Code over a pinned version. The Containerfile installs `@anthropic-ai/claude-code@latest` in a step after the app files, so each deploy of a new commit installs the release of that day instead of reusing a cached layer. `DISABLE_AUTOUPDATER=1` stays, because the container cannot write to the global install. The risk "A Claude Code release changes flags or output" is now handled by the deploy health check and by "Save and test" after a deploy, not by a pin. Task 3.1 changed to match.
