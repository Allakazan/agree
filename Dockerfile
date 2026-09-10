# syntax=docker/dockerfile:1

# Imagem de produção do agree-server para Cloud Run.
#
# Base Debian (bookworm-slim) e não Alpine de propósito: `argon2` é módulo
# nativo e só publica prebuilds para glibc — no musl o install cairia para
# compilar do zero a cada build.

# ── deps: dependências completas (inclui dev, necessárias para o `nest build`) ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Toolchain só para o caso de `argon2` não achar prebuild para esta ABI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ── build: compila TypeScript → dist/ ─────────────────────────────────────────
FROM deps AS build
WORKDIR /app
# `drizzle.config.ts` está na raiz e entra no programa do tsc, o que empurra o
# rootDir para a raiz: a saída é `dist/src/main.js`, não `dist/main.js`.
COPY tsconfig.json tsconfig.build.json nest-cli.json drizzle.config.ts ./
COPY src ./src
RUN yarn build

# ── prod-deps: mesma árvore, podada para runtime ──────────────────────────────
FROM deps AS prod-deps
WORKDIR /app
RUN yarn install --frozen-lockfile --production && yarn cache clean

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Cloud Run injeta PORT; o default aqui serve para `docker run` local.
ENV PORT=8080
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
