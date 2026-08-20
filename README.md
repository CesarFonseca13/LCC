# ClinicaOS

SaaS multi-tenant de gestão para clínicas de estética/saúde com automações inteligentes de
WhatsApp (Evolution API) e atendimento humanizado por IA (Claude).

## Estrutura

```
apps/
  web/       Next.js 15 (App Router) — painel, páginas públicas, webhooks
  worker/    Node standalone — filas BullMQ, schedulers, motor de automações, IA
packages/
  db/        Drizzle ORM: schema, migrations SQL, withTenant (RLS)
  core/      Domínio puro: FSM de agendamento, automações, score, RBAC, TimeProvider
  whatsapp/  Cliente Evolution API + normalização de webhooks
  ai/        Cliente Anthropic: prompts, tools do agente, guardrails
  config/    Configs compartilhadas (tsconfig, validação de env)
docs/design/ Documentos de design e plano consolidado
infra/       docker-compose, Caddyfile, scripts de backup
```

## Desenvolvimento

Pré-requisitos: Node 20+, pnpm 9, Docker.

```bash
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d   # postgres + redis + evolution
cp .env.example .env                                    # preencha as chaves
pnpm db:migrate
pnpm dev
```

## Regras estruturais (não negociáveis)

1. **A verdade é o Postgres** — BullMQ/Redis é só motor; todo job revalida elegibilidade
   na execução; Redis pode ser perdido sem perda de dados.
2. **Toda query de tenant passa por `withTenant(clinicId, fn)`** — RLS forçado é a segunda
   linha de defesa, nunca a primeira.
3. **Status de agendamento só muda pela FSM** (`packages/core`) — transições disparam
   efeitos na mesma transação.
4. **Nunca `Date.now()` direto** em código de domínio/automação — use o `TimeProvider`
   injetado (testabilidade das cadências).
5. **Todo envio de WhatsApp passa pela fila outbound** — throttle, horário comercial,
   opt-out, aprovação e idempotência são inegociáveis (anti-ban e anti-duplicata).

Plano completo e decisões: [docs/design/00-plano-consolidado.md](docs/design/00-plano-consolidado.md)
