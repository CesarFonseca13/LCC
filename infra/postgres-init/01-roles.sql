-- Executado UMA vez na criação do container Postgres (dev).
-- Em produção, criar roles manualmente com senhas fortes.

CREATE ROLE clinicaos_migrator LOGIN PASSWORD 'migrator_dev_password';
CREATE ROLE clinicaos_app LOGIN PASSWORD 'app_dev_password' NOBYPASSRLS;
-- Worker: schedulers varrem cross-tenant (BYPASSRLS); processo servidor confiável,
-- que re-escopa por clinic_id explicitamente em cada query.
CREATE ROLE clinicaos_worker LOGIN PASSWORD 'worker_dev_password' BYPASSRLS;
GRANT clinicaos_app TO clinicaos_worker;

CREATE DATABASE clinicaos OWNER clinicaos_migrator;
GRANT CONNECT ON DATABASE clinicaos TO clinicaos_app;
GRANT CONNECT ON DATABASE clinicaos TO clinicaos_worker;

-- Banco próprio da Evolution API (o container gerencia o schema dele)
CREATE DATABASE evolution OWNER postgres;
