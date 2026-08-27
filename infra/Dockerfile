# ═══════════════════════════════════════════════════════════════════
# Imagem única com dois alvos: --target web  e  --target worker
# (compartilham as camadas de dependências — build 2x mais rápido)
# Base bookworm-slim (glibc): argon2 e pg com binários garantidos.
# ═══════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app

# Só manifests primeiro: camada de dependências cacheia entre deploys
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/whatsapp/package.json packages/whatsapp/
RUN pnpm install --frozen-lockfile

COPY . .

# ── Web (Next.js) ────────────────────────────────────────────────────
FROM deps AS webbuild
# Build não toca no banco (páginas são dinâmicas); .env não é necessário aqui
RUN pnpm --filter @clinicaos/web build

FROM webbuild AS web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@clinicaos/web", "start"]

# ── Worker (Node + tsx, mesma semântica do dev) ─────────────────────
FROM deps AS worker
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@clinicaos/worker", "exec", "tsx", "src/index.ts"]
