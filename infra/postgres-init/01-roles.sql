-- Executado UMA vez na criação do container Postgres (dev).
-- Em produção, criar roles manualmente com senhas fortes.

CREATE ROLE clinicaos_migrator LOGIN PASSWORD 'migrator_dev_password';
CREATE ROLE clinicaos_app LOGIN PASSWORD 'app_dev_password' NOBYPASSRLS;

CREATE DATABASE clinicaos OWNER clinicaos_migrator;
GRANT CONNECT ON DATABASE clinicaos TO clinicaos_app;
