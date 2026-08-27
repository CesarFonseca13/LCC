#!/bin/sh
# Executado UMA vez na criação do volume do Postgres (produção).
# Senhas vêm do ambiente do container (definidas no docker-compose/.env).
set -eu

: "${DB_MIGRATOR_PASSWORD:?defina DB_MIGRATOR_PASSWORD no .env}"
: "${DB_APP_PASSWORD:?defina DB_APP_PASSWORD no .env}"
: "${DB_WORKER_PASSWORD:?defina DB_WORKER_PASSWORD no .env}"

psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE clinicaos_migrator LOGIN PASSWORD '${DB_MIGRATOR_PASSWORD}';
CREATE ROLE clinicaos_app LOGIN PASSWORD '${DB_APP_PASSWORD}' NOBYPASSRLS;
-- Worker varre cross-tenant (BYPASSRLS) e re-escopa clinic_id em cada query
CREATE ROLE clinicaos_worker LOGIN PASSWORD '${DB_WORKER_PASSWORD}' BYPASSRLS;
GRANT clinicaos_app TO clinicaos_worker;

CREATE DATABASE clinicaos OWNER clinicaos_migrator;
GRANT CONNECT ON DATABASE clinicaos TO clinicaos_app;
GRANT CONNECT ON DATABASE clinicaos TO clinicaos_worker;

-- Banco próprio da Evolution API (o container dela gerencia o schema)
CREATE DATABASE evolution OWNER postgres;
SQL
