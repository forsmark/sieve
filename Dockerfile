FROM docker.io/library/node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Build tools are needed only when better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=3000
VOLUME /data
EXPOSE 3000

CMD ["pnpm", "exec", "tsx", "src/server/index.ts"]
