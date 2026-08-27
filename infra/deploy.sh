#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Deploy/atualização do ClinicaOS na VPS. Rodar da RAIZ do repositório:
#   bash infra/deploy.sh          → sobe/atualiza tudo + migra o banco
#   bash infra/deploy.sh seed     → idem + cria a primeira conta (SEED_*)
# Pré-requisitos: docker + compose plugin; infra/.env preenchido.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "ERRO: infra/.env não existe (base: .env.production.example)"; exit 1; }

echo "── Build das imagens (web + worker) ──"
docker compose build

echo "── Subindo serviços de base ──"
docker compose up -d postgres redis
docker compose up -d --wait postgres

echo "── Migrações do banco (role migrator) ──"
docker compose run --rm --no-deps worker \
  pnpm --filter @clinicaos/db exec tsx src/migrate.ts

if [ "${1:-}" = "seed" ]; then
  echo "── Seed da primeira conta (SEED_* do .env) ──"
  docker compose run --rm --no-deps worker \
    pnpm --filter @clinicaos/db exec tsx src/seed-demo.ts
fi

echo "── Subindo tudo ──"
docker compose up -d

echo "── Estado ──"
docker compose ps
echo
echo "✔ Deploy concluído. Painel: https://$(grep '^APP_DOMAIN=' .env | cut -d= -f2)"
