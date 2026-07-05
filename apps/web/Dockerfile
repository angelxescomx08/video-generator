FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter web... || pnpm install --filter web...

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["pnpm", "dev"]
