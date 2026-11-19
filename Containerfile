# Image for the olympus-edge platform. The platform builds it with `--build-arg APP_BASE=/sieve/`,
# runs it as uid 1000 with /data mounted, and sets EDGE_ALLOWED_USER and CLAUDE_CODE_OAUTH_TOKEN.
# For a local container, the Dockerfile and docker-compose.yml stay as they are.

FROM docker.io/library/node:24-bookworm-slim AS build
ARG APP_BASE=/
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.15.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN APP_BASE=$APP_BASE pnpm build

FROM docker.io/library/node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.15.0
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME/bin:$PATH
WORKDIR /app
COPY --from=build /app /app
# The Claude Code command line for the Claude Code provider, the CV digest, cover letters and the analysis.
# It installs the latest release. The step comes after the app files, so each deploy of a new commit
# installs the release of that day instead of reusing a cached layer. The container cannot update it itself.
RUN pnpm add -g --allow-build=@anthropic-ai/claude-code @anthropic-ai/claude-code@latest \
  && claude --version
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
  DATA_DIR=/data \
  HOST=0.0.0.0 \
  PORT=3000 \
  HOME=/home/node \
  DISABLE_AUTOUPDATER=1
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
