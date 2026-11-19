# Tasks

## 1. Path prefix in the client

- [ ] 1.1 Add `apiPath(path)` in `src/client/src/api/client.ts` that joins `import.meta.env.BASE_URL` with an absolute API path. Use it in `request`, in `new EventSource` in `events.ts`, and in `coverLetterPdfUrl` and `backupUrl` in `endpoints.ts`. Verify with unit tests for the scenarios "Built for a prefix", "Download link under a prefix" and "No prefix", mapped in `e2e/coverage/edge-hosting.json`.
- [ ] 1.2 Set `base: process.env.APP_BASE ?? '/'` in `vite.config.ts`, give the router `basepath` from `BASE_URL`, and replace the `href="/jobs"` anchor in `router.tsx` with a router link. Verify that `APP_BASE=/sieve/ pnpm build` writes `/sieve/assets/...` URLs into `dist/client/index.html`, and that `pnpm test` passes.
- [ ] 1.3 Add a Vite plugin that puts the portal manifest link, the apple-touch-icon link and the Apple web-app meta tags into the head when `APP_BASE` is not `/`. Verify that the tags appear in a `/sieve/` build and are absent from a default build.

## 2. Server routes and gateway check

- [ ] 2.1 Add `GET /healthz` and serve `icon.png` without a login. Add a 512x512 `src/client/public/icon.png` in the DESIGN.md colors. Verify with tests in `app.test.ts` for "Platform probes health" and "Device fetches the icon", mapped in the coverage file.
- [ ] 2.2 Add `src/server/http/edge.ts` with a middleware that compares `X-User` with `EDGE_ALLOWED_USER`. Register it in `createApp` before every route except `/healthz` and `/icon.png`. Read the variable in `config.ts`, and default `host` to `0.0.0.0` when it is set. Verify with tests for "Allowed user", "Other user", "Header missing" and "Not configured", mapped in the coverage file.
- [ ] 2.3 Run `pnpm check` and `pnpm test`. Verify that both pass.

## 3. Container image

- [ ] 3.1 Add a root `Containerfile` with `ARG APP_BASE`, a pinned Claude Code release installed with pnpm, `DISABLE_AUTOUPDATER=1`, user `node` (uid 1000), `HOME=/home/node`, `DATA_DIR=/data`, wget, and `HEALTHCHECK` on `/healthz`. Verify with `podman build --build-arg APP_BASE=/sieve/` and a run with `--userns=keep-id:uid=1000,gid=1000 --user 1000:1000`, a temp `/data` and `EDGE_ALLOWED_USER=Marc`: `/healthz` answers 200 within 30 seconds, `/icon.png` answers a PNG, `/api/status` answers 403 without `X-User` and 200 with `X-User: Marc`, the index refers to `/sieve/assets/`, and `claude --version` runs in the container. Remove the container and the image afterwards.
- [ ] 3.2 Add a README section "Host on olympus-edge" covering the variables `APP_BASE`, `EDGE_ALLOWED_USER` and `CLAUDE_CODE_OAUTH_TOKEN`, `claude setup-token`, and the `portal` commands. Add `EDGE_ALLOWED_USER` to the configuration table. Verify that the commands in the section match `portal app --help`.

## 4. Deploy

- [ ] 4.1 After the user approves the diff, merge to `main` and push. Run `portal app add sieve --name "Sieve" --src ~/development/sieve --description "Job aggregator"` and set `EDGE_ALLOWED_USER`. The user sets `CLAUDE_CODE_OAUTH_TOKEN` themselves. Then run `portal app deploy sieve`, `portal app status sieve` and `portal app logs sieve -n 50`. Verify that the deploy reports healthy, and that "Save and test" for the Claude Code provider passes at `https://olympus.tailf4d52f.ts.net/sieve/`.

## Workflow follow-up

- At the sync gate, the owner answers the sync question. Then archive the change and run `pnpm check`.
