# Arquitetura e Modelo de Dados — Sistema de Gestão para Clínicas de Estética (SaaS multi-tenant, inspirado no Vittax)

---

## 1. Repositório e topologia de execução

### 1.1 Monorepo (pnpm workspaces + Turborepo)

```
clinicaos/
├── apps/
│   ├── web/                  # Next.js 15 (App Router) — painel, portal do cliente, páginas públicas
│   │   ├── src/app/(painel)/          # rotas autenticadas do painel
│   │   ├── src/app/(portal)/portal/   # portal do paciente (auth por magic link)
│   │   ├── src/app/(publico)/
│   │   │   ├── assinar/[token]/       # assinatura de termos
│   │   │   ├── orcamento/[token]/     # orçamento público
│   │   │   └── agendar/[slug]/        # agendamento online da clínica
│   │   └── src/app/api/
│   │       ├── webhooks/evolution/[instanceKey]/route.ts
│   │       └── files/[...path]/route.ts   # servir arquivos autenticado
│   └── worker/               # processo Node.js standalone: BullMQ workers + schedulers
│       ├── src/queues/       # processadores por fila
│       ├── src/schedulers/   # jobs repetíveis (cron)
│       └── src/index.ts
├── packages/
│   ├── db/                   # Drizzle ORM: schema, migrations, cliente com escopo de tenant
│   ├── core/                 # domínio puro: máquina de estados de agendamento, motor de
│   │                         #   automações, cálculo de score, render de templates {{var}},
│   │                         #   regras de comissão, permissões RBAC
│   ├── whatsapp/             # cliente HTTP da Evolution API + normalização de webhooks
│   ├── ai/                   # cliente Anthropic, prompts, tools do agente, guardrails
│   └── config/               # tsconfig, eslint, zod-env (validação de variáveis de ambiente)
├── docker-compose.yml
├── Caddyfile                 # TLS automático + reverse proxy
└── .env
```

**Por que monorepo:** `web` e `worker` compartilham o schema do banco, a máquina de estados e o motor de automações — duplicar isso em dois repositórios é fonte garantida de divergência. O worker é um app separado (não roda dentro do Next.js) porque precisa de processo persistente para BullMQ, throttling de envio e schedulers — coisas que o modelo serverless-ish do Next.js não garante.

### 1.2 Docker Compose (uma VPS)

| Serviço | Imagem | Papel |
|---|---|---|
| `caddy` | caddy:2 | TLS automático (Let's Encrypt), proxy para web e evolution |
| `web` | build do `apps/web` (Next standalone) | Painel + APIs + páginas públicas |
| `worker` | build do `apps/worker` | Filas, automações, IA, cron |
| `postgres` | postgres:16 | Banco único, RLS ativo |
| `redis` | redis:7 (AOF everysec) | BullMQ + cache + rate limit |
| `evolution` | atendai/evolution-api:v2 | Instâncias WhatsApp (uma por número/clínica) |
| `gotenberg` | gotenberg/gotenberg:8 | Geração de PDF (Chromium isolado) |
| `backup` | alpine + cron | `pg_dump` + restic → storage off-site |

Volumes nomeados: `pg_data`, `redis_data`, `evolution_instances`, `app_storage` (fotos/PDFs), `caddy_data`.

### 1.3 Como web, worker e Evolution conversam

```
WhatsApp ──▶ Evolution API ──webhook POST──▶ web /api/webhooks/evolution/[instanceKey]
                                               │  valida token, grava whatsapp_events,
                                               │  insere messages (inbound), enfileira job
                                               ▼
                                        Redis (BullMQ)
                                               │
             ┌─────────────────────────────────┼──────────────────────────────┐
             ▼                                 ▼                              ▼
   fila messages:inbound             fila messages:send               schedulers (repeatable jobs)
   (worker: pipeline de IA,          (worker: throttle por             • automations:tick  (1/min)
    detecção de intenção,             instância, presença              • automations:daily (09:00 BRT)
    resposta ou handoff)              "digitando", retry)              • score:recalc      (03:00 BRT)
             │                                 │                       • stock:alerts      (08:00 BRT)
             └──────── HTTP REST ──────────────┴──▶ Evolution API ──▶ WhatsApp
```

**Regras estruturais:**

- **O webhook nunca processa nada pesado.** Handler grava o payload bruto em `whatsapp_events`, faz upsert de `conversations`/`messages` e enfileira — responde 200 em <100ms. Evolution reenvia em caso de falha, e o job é idempotente (dedup por `wa_message_id`).
- **Todo envio de mensagem passa pelo worker**, nunca direto do web. Motivos: (a) rate limit central por instância — delay aleatório de 20–90s entre mensagens de campanha/automação para simular comportamento humano e reduzir risco de ban do número; (b) janela de horário comercial da clínica; (c) registro persistente do status; (d) presença "composing" (digitando…) por 2–6s antes do envio, proporcional ao tamanho do texto.
- **A fila de verdade é o Postgres, o BullMQ é só o motor.** Toda mensagem de saída existe como linha em `messages` com `status='queued'` antes de virar job. Se o Redis for perdido, o worker re-enfileira no boot tudo que está `queued` — Redis é tratado como descartável.
- **Cron via BullMQ repeatable jobs** (não crontab do SO): `automations:tick` a cada minuto varre `automation_runs.next_run_at <= now()` (cobre cadências de 24h/2h/45min de confirmação e follow-ups); `automations:daily` roda reativação por procedimento, preenchimento inteligente de agenda, aniversários e renovação de pacotes; `score:recalc` recalcula o snapshot de inteligência; `whatsapp:reconcile` a cada 5min verifica status das instâncias (`connectionState`) e alerta desconexões.

---

## 2. Esquema PostgreSQL completo

Convenções globais:

- PK: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- Toda tabela de tenant tem `clinic_id uuid NOT NULL REFERENCES clinics(id)` e **todo índice composto começa por `clinic_id`**.
- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz` (trigger).
- Dinheiro: `numeric(12,2)`. Percentuais: `numeric(5,2)`. Datas de evento: `timestamptz` (UTC no banco; conversão via `clinics.timezone`).
- Enums como `text` + `CHECK` (evita dor de `ALTER TYPE` em migrações); listo como enum por legibilidade.
- Extensões: `pg_trgm` (busca por nome), `btree_gist` (anti-overlap de agenda), `pgcrypto`.

### 2.1 Tenancy, usuários e equipe

```sql
clinics (
  id uuid PK,
  name text NOT NULL,               legal_name text,        cnpj text,
  phone text,                       email text,
  address_street text, address_number text, address_complement text,
  address_district text, address_city text, address_state char(2), address_zip text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  logo_path text,
  business_hours jsonb NOT NULL DEFAULT '{}',   -- {"mon":[["08:00","18:00"]],...}
  booking_slug text UNIQUE,                     -- página pública /agendar/[slug]
  online_booking_enabled boolean DEFAULT false,
  anticipates_receivables boolean DEFAULT false, -- toggle "antecipa recebíveis?"
  google_review_url text,                        -- link Google Meu Negócio p/ feedback positivo
  settings jsonb NOT NULL DEFAULT '{}',
  plan text DEFAULT 'trial',  status text CHECK (status IN ('active','suspended','cancelled')),
  created_at, updated_at
)

users (                              -- GLOBAL (sem clinic_id): um user pode pertencer a N clínicas
  id uuid PK,
  name text NOT NULL,  email citext UNIQUE NOT NULL,  password_hash text,
  avatar_path text,  phone text,
  is_superadmin boolean DEFAULT false,   -- você, o operador do SaaS
  created_at, updated_at
)

clinic_members (
  id uuid PK, clinic_id FK, user_id FK users,
  role text NOT NULL CHECK (role IN ('owner','manager','professional','reception')),
  professional_id uuid NULL REFERENCES professionals(id),  -- vínculo quando o membro atende
  active boolean DEFAULT true,
  UNIQUE (clinic_id, user_id)
)

professionals (                      -- recurso de agenda; nem toda profissional tem login
  id uuid PK, clinic_id FK,
  name text NOT NULL,  specialty text,  registration_number text,  -- CRM/CRO/CRBM...
  calendar_color text DEFAULT '#7C3AED',
  works_hours jsonb,                 -- exceções ao horário da clínica
  active boolean DEFAULT true
)
-- INDEX (clinic_id, active)

rooms ( id uuid PK, clinic_id FK, name text NOT NULL, active boolean DEFAULT true )

auth_sessions (
  id text PK,                        -- token de sessão hasheado (sha256)
  user_id FK users, active_clinic_id uuid NULL,
  expires_at timestamptz NOT NULL, ip inet, user_agent text, created_at
)
-- INDEX (user_id)
```

### 2.2 Clientes (pacientes/leads)

```sql
customers (
  id uuid PK, clinic_id FK,
  full_name text NOT NULL,  social_name text,
  cpf text,  birth_date date,
  phone_e164 text NOT NULL,          -- chave de match com WhatsApp: +5511999999999
  email citext,  instagram text,  occupation text,
  address_street text, address_number text, address_complement text,
  address_district text, address_city text, address_state char(2), address_zip text,
  source text,                       -- 'instagram','indicacao','google','walk-in',...
  status text NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead','active','at_risk','inactive')),  -- derivado, mantido pelo worker
  automations_blocked boolean NOT NULL DEFAULT false,  -- toggle "Bloqueado para automações"
  photo_consent boolean DEFAULT false,
  lgpd_consent_at timestamptz, lgpd_consent_source text,  -- 'whatsapp','presencial','termo'
  notes text,
  deleted_at timestamptz,            -- soft delete p/ direito de eliminação LGPD
  created_at, updated_at
)
-- UNIQUE (clinic_id, phone_e164) WHERE deleted_at IS NULL
-- INDEX (clinic_id, status)
-- INDEX GIN (full_name gin_trgm_ops)  -- busca "digite 3 letras"
-- INDEX (clinic_id, birth_date)       -- automação de aniversário

tags          ( id uuid PK, clinic_id FK, name text, color text, UNIQUE(clinic_id, name) )
customer_tags ( customer_id FK, tag_id FK, PRIMARY KEY (customer_id, tag_id) )
```

### 2.3 Anamnese versionável por modelo

```sql
anamnesis_templates (
  id uuid PK, clinic_id FK,
  name text NOT NULL,                -- "Anamnese Facial", "Anamnese Corporal"...
  active boolean DEFAULT true, created_by FK users
)

anamnesis_template_versions (        -- publicar = nova versão imutável; respostas antigas
  id uuid PK, clinic_id FK,          --   continuam apontando para a versão com que foram coletadas
  template_id FK anamnesis_templates,
  version int NOT NULL,
  schema jsonb NOT NULL,             -- [{section,fields:[{key,label,type:'boolean'|'text'|
                                     --   'select'|'multiselect',options,required}]}]
                                     -- cobre alergias, medicamentos, doenças crônicas, condições
                                     -- (gestante, lactante, marca-passo, tabagismo, etilismo,
                                     --  exposição solar, uso de ácidos), cirurgias, pele
  published_at timestamptz,
  UNIQUE (template_id, version)
)

anamnesis_responses (
  id uuid PK, clinic_id FK, customer_id FK,
  template_version_id FK anamnesis_template_versions,
  answers jsonb NOT NULL,            -- {key: valor} casando com o schema da versão
  filled_by_user_id FK users NULL,   -- NULL = preenchida pelo próprio cliente no portal
  signed_document_id uuid NULL REFERENCES documents(id),
  filled_at timestamptz NOT NULL DEFAULT now()
)
-- INDEX (clinic_id, customer_id, filled_at DESC)
```

*Seed:* modelos padrão por tipo de clínica (estética facial, corporal, harmonização) copiados para a clínica no onboarding — "modelos gerenciáveis por tipo de clínica" do vídeo.

### 2.4 Evoluções, fotos e timeline

```sql
clinical_notes (                     -- Evolução clínica
  id uuid PK, clinic_id FK, customer_id FK,
  professional_id FK professionals, appointment_id uuid NULL,
  note text NOT NULL, occurred_at date NOT NULL,
  created_by FK users, created_at
)
-- INDEX (clinic_id, customer_id, occurred_at DESC)

customer_photos (
  id uuid PK, clinic_id FK, customer_id FK,
  kind text NOT NULL CHECK (kind IN ('before','during','after')),
  procedure_id uuid NULL, appointment_id uuid NULL,
  file_path text NOT NULL, thumb_path text NOT NULL,
  description text, taken_at date NOT NULL DEFAULT current_date,
  uploaded_by FK users, created_at
)
-- INDEX (clinic_id, customer_id, taken_at DESC)

customer_events (                    -- Timeline unificada da ficha (aba Timeline)
  id uuid PK, clinic_id FK, customer_id FK,
  event_type text NOT NULL,          -- 'appointment.created','appointment.showed','sale.paid',
                                     -- 'photo.added','note.added','message.sent','message.received',
                                     -- 'document.signed','package.assigned','automation.sent',...
  ref_table text, ref_id uuid,       -- ponteiro polimórfico para a entidade origem
  payload jsonb,                     -- snapshot legível ("Botox — R$ 1.200 — Dra. Ana")
  actor_user_id uuid NULL,           -- NULL = sistema/automação
  occurred_at timestamptz NOT NULL DEFAULT now()
)
-- INDEX (clinic_id, customer_id, occurred_at DESC)
-- Populada pela camada de serviço (packages/core), não por trigger de banco.
```

### 2.5 Procedimentos, pacotes e sessões

```sql
procedures (
  id uuid PK, clinic_id FK,
  name text NOT NULL, category text,
  duration_minutes int NOT NULL DEFAULT 60,
  price numeric(12,2) NOT NULL, cost numeric(12,2),
  return_days int,                   -- prazo de retorno (ex.: botox 120/180) → reativação
  touchup_days int,                  -- dias até retoque; ao marcar Compareceu, dispara
                                     --   "Confirmação do Retoque" e cria agendamento filho
  pre_care text,                     -- pré-cuidados (enviados X horas antes)
  pre_care_hours_before int DEFAULT 24,
  post_care text,                    -- pós-cuidados (enviados ao marcar Compareceu)
  post_sale_cadence_days int[],      -- cadência de pós-venda: ex '{1,7,30}'
  commission_default_pct numeric(5,2),
  active boolean DEFAULT true
)
-- INDEX (clinic_id, active)

procedure_supplies (                 -- consumo de estoque por execução do procedimento
  id uuid PK, clinic_id FK,
  procedure_id FK procedures, stock_item_id FK stock_items,
  quantity numeric(10,3) NOT NULL,   -- ex.: 1.0 ml de ácido hialurônico, 2 agulhas 30G
  UNIQUE (procedure_id, stock_item_id)
)

packages (                           -- modelos de pacote à venda
  id uuid PK, clinic_id FK,
  name text NOT NULL, price numeric(12,2) NOT NULL,
  validity_days int,                 -- prazo de validade após a compra
  active boolean DEFAULT true
)

package_items (                      -- pacote pode combinar procedimentos
  id uuid PK, clinic_id FK,
  package_id FK packages, procedure_id FK procedures,
  sessions int NOT NULL              -- ex.: 12 sessões de drenagem
)

customer_packages (                  -- instância comprada ("5 de 12 sessões usadas")
  id uuid PK, clinic_id FK, customer_id FK,
  package_id FK packages, sale_id uuid NULL,
  sessions_total int NOT NULL, sessions_used int NOT NULL DEFAULT 0,  -- cache
  price_paid numeric(12,2), purchased_at date NOT NULL, expires_at date,
  status text CHECK (status IN ('active','completed','expired','cancelled')) DEFAULT 'active'
)
-- INDEX (clinic_id, status), INDEX (clinic_id, customer_id)
-- Renovação: automação dispara com N sessões restantes OU 7 dias p/ expires_at

package_session_uses (               -- auditável e estornável (falta não consome? config)
  id uuid PK, clinic_id FK,
  customer_package_id FK customer_packages, appointment_id FK appointments,
  used_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz
)
```

### 2.6 Agenda e agendamentos (máquina de estados)

```sql
appointments (
  id uuid PK, clinic_id FK,
  customer_id FK customers, professional_id FK professionals,
  room_id uuid NULL, procedure_id uuid NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','showed','no_show','cancelled','rescheduled')),
  price numeric(12,2),               -- congelado no momento do agendamento
  customer_package_id uuid NULL,     -- se consome sessão de pacote
  is_touchup boolean DEFAULT false,
  parent_appointment_id uuid NULL,   -- retoque → atendimento original
  rescheduled_to_id uuid NULL,       -- cadeia de reagendamento
  origin text CHECK (origin IN ('manual','online_booking','automation','ai_agent','reschedule'))
    DEFAULT 'manual',
  cancel_reason text, notes text,
  status_changed_at timestamptz, created_by uuid NULL, created_at, updated_at,

  CONSTRAINT no_overlap EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('scheduled','confirmed','showed'))
)
-- INDEX (clinic_id, starts_at)                      -- vista da agenda
-- INDEX (clinic_id, professional_id, starts_at)
-- INDEX (clinic_id, customer_id, starts_at DESC)    -- histórico da ficha
-- INDEX parcial (clinic_id, starts_at) WHERE status IN ('scheduled','confirmed')
--   -- varredura das cadências 24h/2h/45min e do preenchimento inteligente (72h)

appointment_status_history (
  id uuid PK, clinic_id FK, appointment_id FK,
  from_status text, to_status text NOT NULL,
  source text CHECK (source IN ('user','customer_whatsapp','ai_agent','automation','system')),
  changed_by_user_id uuid NULL, reason text, created_at
)
-- INDEX (appointment_id)
```

**Máquina de estados (implementada em `packages/core/appointment-fsm.ts`, única porta de mutação de `status`):**

```
scheduled ──▶ confirmed ──▶ showed
    │             │             └─▶ [efeitos: pós-atendimento, retoque, consumo de
    │             │                  estoque, sessão de pacote, comissão, evolução]
    │             ├─▶ no_show ──▶ [efeito: automação de recuperação de falta]
    │             └─▶ cancelled / rescheduled
    ├─▶ no_show / cancelled / rescheduled
    └─▶ showed (confirmação implícita)
rescheduled ──▶ (cria novo appointment com rescheduled_to_id; automação segue fluxo
                 de confirmação do novo)
```

Cada transição grava `appointment_status_history`, publica `customer_events` e dispara os gatilhos de automação correspondentes — tudo na mesma transação; jobs de envio são enfileirados após o commit.

### 2.7 Funil de vendas (CRM)

Decisão: **todo lead é um `customer` com `status='lead'`** — evita a dualidade lead/cliente e a dor de migrar dados na conversão. O funil trabalha com `deals`.

```sql
pipelines       ( id uuid PK, clinic_id FK, name text, is_default boolean DEFAULT false )
pipeline_stages (
  id uuid PK, clinic_id FK, pipeline_id FK,
  name text NOT NULL, position int NOT NULL, color text,
  is_won boolean DEFAULT false, is_lost boolean DEFAULT false
)

deals (
  id uuid PK, clinic_id FK,
  pipeline_id FK, stage_id FK pipeline_stages,
  customer_id FK customers,
  title text NOT NULL, value numeric(12,2),
  procedure_interest_id uuid NULL,   -- procedimento de interesse
  owner_user_id uuid NULL,
  position int NOT NULL DEFAULT 0,   -- ordenação no kanban
  expected_close date,
  won_at timestamptz, lost_at timestamptz, lost_reason text,
  last_contact_at timestamptz,       -- alimenta reativação de leads mornos/frios
  created_at, updated_at
)
-- INDEX (clinic_id, pipeline_id, stage_id, position)
-- INDEX (clinic_id, customer_id)
```

### 2.8 Orçamentos → vendas

```sql
quotes (
  id uuid PK, clinic_id FK, customer_id FK, deal_id uuid NULL,
  number int NOT NULL,               -- sequência por clínica: UNIQUE (clinic_id, number)
  status text CHECK (status IN ('draft','sent','viewed','accepted','rejected','expired'))
    DEFAULT 'draft',
  valid_until date,
  subtotal numeric(12,2), discount_amount numeric(12,2) DEFAULT 0, total numeric(12,2),
  public_token text UNIQUE,          -- link público /orcamento/[token]
  sent_at, viewed_at, accepted_at timestamptz,
  notes text, created_by FK users, created_at, updated_at
)
-- INDEX (clinic_id, status, created_at DESC)

quote_items (
  id uuid PK, clinic_id FK, quote_id FK,
  kind text CHECK (kind IN ('procedure','package','product')),
  procedure_id uuid NULL, package_id uuid NULL, stock_item_id uuid NULL,
  description text NOT NULL, quantity numeric(10,2) DEFAULT 1,
  unit_price numeric(12,2), total numeric(12,2)
)

sales (
  id uuid PK, clinic_id FK, customer_id FK,
  quote_id uuid NULL,                -- conversão orçamento → venda
  number int NOT NULL,               -- UNIQUE (clinic_id, number)
  status text CHECK (status IN ('open','partially_paid','paid','cancelled')) DEFAULT 'open',
  subtotal numeric(12,2), discount numeric(12,2) DEFAULT 0, total numeric(12,2) NOT NULL,
  sold_at date NOT NULL DEFAULT current_date,
  sold_by_user_id FK users, created_at, updated_at
)
-- INDEX (clinic_id, sold_at DESC), INDEX (clinic_id, customer_id)

sale_items (
  id uuid PK, clinic_id FK, sale_id FK,
  kind text CHECK (kind IN ('procedure','package','product')),
  procedure_id uuid NULL, package_id uuid NULL, stock_item_id uuid NULL,
  description text, quantity numeric(10,2) DEFAULT 1,
  unit_price numeric(12,2), total numeric(12,2),
  professional_id uuid NULL          -- base para comissão por item
)

sale_payments (                      -- condições de pagamento da venda → gera receivables
  id uuid PK, clinic_id FK, sale_id FK,
  method text CHECK (method IN ('cash','pix','debit','credit','transfer','boleto')),
  installments int DEFAULT 1,        -- 1..15 para crédito
  amount numeric(12,2) NOT NULL, created_at
)
```

**Efeitos da venda (transação única na camada de serviço):** item `product` → `stock_movements` de saída; item `package` → cria `customer_packages`; `sale_payments` → gera N `receivables` (uma por parcela) já com `fee_amount` calculado por `card_fee_configs`; itens com `professional_id` → geram `commission_entries`.

### 2.9 Estoque

```sql
stock_items (
  id uuid PK, clinic_id FK,
  name text NOT NULL, sku text, unit text DEFAULT 'un',   -- 'un','ml','g','caixa'
  quantity numeric(12,3) NOT NULL DEFAULT 0,   -- cache mantido transacionalmente
  min_quantity numeric(12,3) NOT NULL DEFAULT 0,  -- estoque mínimo → alerta diário
  cost_price numeric(12,2), sale_price numeric(12,2),
  supplier text, active boolean DEFAULT true
)
-- INDEX (clinic_id, active), UNIQUE (clinic_id, sku) WHERE sku IS NOT NULL

stock_movements (                    -- fonte da verdade; quantity do item = soma
  id uuid PK, clinic_id FK, stock_item_id FK,
  type text CHECK (type IN ('purchase','sale','procedure_use','adjustment','loss')),
  quantity numeric(12,3) NOT NULL,   -- com sinal: entrada +, saída −
  unit_cost numeric(12,2),
  ref_table text, ref_id uuid,       -- sale_id / appointment_id que originou
  reason text, performed_by uuid NULL, created_at
)
-- INDEX (clinic_id, stock_item_id, created_at DESC)
```

Consumo automático: `showed` em appointment com `procedure_id` → gera um `stock_movements(type='procedure_use')` por linha de `procedure_supplies`. Venda de produto → `type='sale'`. Job diário compara `quantity <= min_quantity` e gera `notifications`.

### 2.10 Financeiro

```sql
finance_categories (
  id uuid PK, clinic_id FK,
  name text NOT NULL, kind text CHECK (kind IN ('income','expense')),
  parent_id uuid NULL, color text
)

card_fee_configs (                   -- taxas de cartão 1x–15x, com e sem antecipação
  id uuid PK, clinic_id FK,
  installments int NOT NULL CHECK (installments BETWEEN 1 AND 15),
  fee_pct numeric(5,2) NOT NULL,             -- taxa normal
  fee_pct_anticipated numeric(5,2),          -- taxa quando antecipa recebíveis
  UNIQUE (clinic_id, installments)
)
-- clinics.anticipates_receivables decide qual coluna aplicar

receivables (                        -- contas a receber
  id uuid PK, clinic_id FK,
  customer_id uuid NULL, sale_id uuid NULL, category_id uuid NULL,
  description text NOT NULL,
  gross_amount numeric(12,2) NOT NULL,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,     -- taxa de cartão da parcela
  net_amount numeric(12,2) NOT NULL,               -- gross − fee
  method text,  installment_number int DEFAULT 1,  installment_total int DEFAULT 1,
  anticipated boolean DEFAULT false,
  due_date date NOT NULL, received_at date,
  status text CHECK (status IN ('pending','received','overdue','cancelled')) DEFAULT 'pending',
  created_at, updated_at
)
-- INDEX (clinic_id, status, due_date)   -- aba "Contas a Receber" + botão Confirmar
-- INDEX (clinic_id, sale_id)

payables (                           -- contas a pagar / despesas
  id uuid PK, clinic_id FK,
  description text NOT NULL, supplier text, category_id uuid NULL,
  amount numeric(12,2) NOT NULL,
  due_date date NOT NULL, paid_at date,
  status text CHECK (status IN ('pending','paid','overdue','cancelled')) DEFAULT 'pending',
  recurrence text NULL CHECK (recurrence IN ('monthly','weekly','yearly')),
  recurrence_parent_id uuid NULL,    -- job mensal materializa próximas ocorrências
  created_at, updated_at
)
-- INDEX (clinic_id, status, due_date)
```

Cards do dashboard financeiro (Recebido / A Receber / Despesas / Saldo, % vs período anterior), fluxo de caixa e o donut "Por Categoria" são agregações sobre `receivables` + `payables` — sem tabela extra; se o volume crescer, materializa-se uma `finance_daily_summary` por job noturno.

### 2.11 Comissões

```sql
commission_rules (
  id uuid PK, clinic_id FK,
  professional_id uuid NULL,         -- NULL = todas as profissionais
  procedure_id uuid NULL,            -- NULL = todos os procedimentos
  pct numeric(5,2), fixed_amount numeric(12,2),   -- um dos dois
  basis text CHECK (basis IN ('gross','net')) DEFAULT 'gross',  -- sobre bruto ou líquido de taxa
  active boolean DEFAULT true, created_at
)
-- Resolução por especificidade: (prof+proc) > (proc) > (prof) > geral > procedures.commission_default_pct

commission_entries (                 -- gerada ao marcar 'showed' (atendimento realizado)
  id uuid PK, clinic_id FK,
  professional_id FK, appointment_id uuid NULL, sale_item_id uuid NULL,
  rule_id uuid NULL,
  base_amount numeric(12,2) NOT NULL, amount numeric(12,2) NOT NULL,
  reference_date date NOT NULL,      -- data do atendimento → agrupamento por período
  status text CHECK (status IN ('accrued','paid','cancelled')) DEFAULT 'accrued',
  payment_id uuid NULL REFERENCES commission_payments(id), created_at
)
-- INDEX (clinic_id, professional_id, reference_date)
-- INDEX (clinic_id, status)

commission_payments (                -- "Marcar como pago" fecha o período
  id uuid PK, clinic_id FK, professional_id FK,
  period_start date, period_end date,
  total_amount numeric(12,2) NOT NULL,
  paid_at date NOT NULL, paid_by FK users,
  payable_id uuid NULL               -- opcionalmente lança despesa no financeiro
)
```

### 2.12 Termos de consentimento e assinatura eletrônica nativa

```sql
document_templates (
  id uuid PK, clinic_id FK,
  name text NOT NULL,
  kind text CHECK (kind IN ('consent','contract','other')) DEFAULT 'consent',
  body_html text NOT NULL,           -- HTML com {{nome}} {{cpf}} {{telefone}} {{email}}
                                     -- {{endereco}} {{valor}} {{procedimento}} {{clinica}} {{data}}
  variables text[] NOT NULL,         -- extraídas no save (validação de preenchimento)
  source text CHECK (source IN ('editor','word_import')) DEFAULT 'editor',
  active boolean DEFAULT true, created_by FK users, created_at, updated_at
)

documents (                          -- instância gerada p/ um cliente
  id uuid PK, clinic_id FK, customer_id FK,
  template_id uuid NULL,             -- NULL para "Contratos Importados"
  appointment_id uuid NULL, sale_id uuid NULL, procedure_id uuid NULL,
  title text NOT NULL,
  body_html_rendered text,           -- HTML final com variáveis resolvidas (congelado)
  variables_snapshot jsonb,          -- valores usados no preenchimento (auditoria)
  content_sha256 text,               -- hash do HTML no momento do envio
  pdf_path text,                     -- gerado após assinatura
  status text CHECK (status IN ('draft','sent','viewed','signed','declined','expired'))
    DEFAULT 'draft',
  sign_token text UNIQUE,            -- 32 bytes aleatórios → /assinar/[token]
  token_expires_at timestamptz,
  sent_at, viewed_at, signed_at timestamptz,
  imported_file_path text,           -- contratos importados (PDF externo)
  created_by FK users, created_at
)
-- INDEX (clinic_id, status, created_at DESC), INDEX (clinic_id, customer_id)

document_signatures (
  id uuid PK, clinic_id FK, document_id FK UNIQUE,
  signer_name text NOT NULL, signer_cpf text,
  signature_image_path text,         -- desenho no canvas (opcional, valor probatório extra)
  otp_verified boolean DEFAULT false, otp_phone text,  -- código enviado ao WhatsApp do cliente
  signed_at timestamptz NOT NULL,
  ip inet NOT NULL, user_agent text NOT NULL,
  content_sha256 text NOT NULL,      -- hash do conteúdo assinado (deve bater com documents)
  pdf_sha256 text,                   -- hash do PDF final
  evidence jsonb                     -- geolocalização aproximada, resolução, timezone do device
)

document_audit_log (                 -- trilha de auditoria completa
  id uuid PK, clinic_id FK, document_id FK,
  event text CHECK (event IN ('created','sent','link_opened','otp_sent','otp_verified',
                              'signed','declined','pdf_generated','resent','expired')),
  ip inet, user_agent text, metadata jsonb, created_at
)
-- INDEX (document_id, created_at)
```

**Fluxo de assinatura:** gerar → congelar `body_html_rendered` + `content_sha256` → enviar link via WhatsApp (`/assinar/{sign_token}`) → cliente abre (`link_opened`) → sistema envia OTP de 6 dígitos ao mesmo número (`otp_sent`) → valida (`otp_verified`, prova de posse do telefone) → cliente marca "li e concordo" + assina no canvas → grava `document_signatures` com IP, user-agent, timestamp e hash → job `pdf:generate` monta PDF com página final de evidências (dados do signatário, IP, data/hora, hashes, QR para `/verificar/{id}`) → envia PDF pelo WhatsApp e arquiva. Página pública `/verificar/{id}` confirma integridade pelo hash.

### 2.13 WhatsApp: instâncias, conversas, mensagens, aprovações

```sql
whatsapp_instances (
  id uuid PK, clinic_id FK,
  evolution_instance_name text UNIQUE NOT NULL,  -- ex: 'clinica-{clinic_id-short}-01'
  label text, phone_e164 text,
  is_primary boolean DEFAULT false,
  status text CHECK (status IN ('disconnected','connecting','connected','banned'))
    DEFAULT 'disconnected',
  webhook_token text NOT NULL,       -- valida chamadas do Evolution → web
  last_seen_at timestamptz, created_at
)

conversations (
  id uuid PK, clinic_id FK, instance_id FK whatsapp_instances,
  remote_jid text NOT NULL,          -- '5511999999999@s.whatsapp.net'
  customer_id uuid NULL,             -- match por telefone; NULL = número desconhecido
  mode text CHECK (mode IN ('ai','human','paused')) DEFAULT 'ai',  -- takeover humano
  assigned_user_id uuid NULL,
  status text CHECK (status IN ('open','closed')) DEFAULT 'open',
  unread_count int DEFAULT 0, last_message_at timestamptz,
  ai_context_summary text,           -- resumo rolante p/ janela de contexto do agente
  UNIQUE (instance_id, remote_jid)
)
-- INDEX (clinic_id, last_message_at DESC)   -- inbox

messages (
  id uuid PK, clinic_id FK, conversation_id FK,
  direction text CHECK (direction IN ('inbound','outbound')),
  author text CHECK (author IN ('customer','ai','human','automation')),
  author_user_id uuid NULL,
  wa_message_id text,                -- id da Evolution; UNIQUE (conversation_id, wa_message_id)
  type text CHECK (type IN ('text','image','audio','video','document','location')) DEFAULT 'text',
  body text, media_path text,
  status text CHECK (status IN ('received','queued','pending_approval','sending','sent',
                                'delivered','read','failed','rejected')) NOT NULL,
  automation_id text NULL,           -- qual automação gerou
  automation_run_id uuid NULL,
  scheduled_for timestamptz,         -- envio agendado (janela comercial)
  error text, sent_at timestamptz, created_at
)
-- INDEX (clinic_id, conversation_id, created_at DESC)
-- INDEX parcial (clinic_id, scheduled_for) WHERE status = 'queued'   -- fila de envio
-- INDEX parcial (clinic_id) WHERE status = 'pending_approval'

approvals (                          -- fila de Aprovações (human-in-the-loop)
  id uuid PK, clinic_id FK,
  message_id FK messages UNIQUE, customer_id FK, automation_id text,
  generated_body text NOT NULL,      -- o que a IA/automação propôs
  edited_body text,                  -- se a atendente editou antes de aprovar
  status text CHECK (status IN ('pending','approved','edited_approved','rejected','expired'))
    DEFAULT 'pending',
  reviewed_by uuid NULL, reviewed_at timestamptz,
  expires_at timestamptz,            -- ex.: lembrete de 45min não faz sentido aprovado tarde
  created_at
)
-- INDEX parcial (clinic_id, created_at) WHERE status='pending'  -- badge do menu + card do dashboard

whatsapp_events (                    -- payload bruto p/ debug e replay; retenção 30 dias
  id bigserial PK, instance_id FK,
  event_type text, payload jsonb NOT NULL,
  processed boolean DEFAULT false, created_at
)
```

Quais automações exigem aprovação é configurável por automação (`automation_settings.config.requires_approval`). Mensagem aprovada → `status='queued'` → job de envio. O modo `human` da conversa **pausa a IA** imediatamente (takeover); a IA também solicita handoff quando detecta irritação/caso clínico complexo (grava `notifications` + muda `mode='paused'`).

### 2.14 Automações

```sql
automation_definitions (             -- catálogo GLOBAL (seed, sem clinic_id)
  id text PK,                        -- slug: 'reminder_24h','confirm_2h','reminder_45min',
                                     -- 'reschedule_message','touchup_confirmation','pre_care',
                                     -- 'reply_on_confirm','reply_on_cancel','reply_on_reschedule',
                                     -- 'no_show_immediate','no_show_followup','cancel_message',
                                     -- 'post_visit','post_sale_cadence','feedback_request',
                                     -- 'reactivation_by_procedure','generic_reactivation',
                                     -- 'birthday','smart_agenda_fill',
                                     -- 'package_renewal_sessions','package_renewal_expiry'
  phase text CHECK (phase IN ('confirmation','auto_reply','no_show_recovery',
                              'post_visit','reactivation','growth')),
  name text, description text, default_config jsonb, default_template text
)

automation_settings (                -- estado por clínica (tela Automações: toggle + Editar)
  id uuid PK, clinic_id FK,
  automation_id text FK automation_definitions,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}',    -- offsets, horários, requires_approval,
                                         -- feedback_hours_after, followup_days_after_noshow,
                                         -- send_booking_links (toggle global vive em clinics.settings)
  message_template text,                 -- template com {{nome}} {{clinica}} {{data}} {{hora}}...
  updated_by uuid, updated_at,
  UNIQUE (clinic_id, automation_id)
)

followup_sequences (                 -- sequências de reativação (até 7 passos)
  id uuid PK, clinic_id FK,
  automation_id text NOT NULL,       -- 'reactivation_by_procedure' | 'generic_reactivation'
  procedure_id uuid NULL,            -- NULL = reativação genérica (default 30 dias)
  name text, active boolean DEFAULT true
)

followup_steps (
  id uuid PK, clinic_id FK, sequence_id FK followup_sequences,
  step_number int NOT NULL CHECK (step_number BETWEEN 1 AND 7),
  offset_days int NOT NULL,          -- ex.: 1, 3, 13, 25, 40 (relativos ao início da sequência)
  message_template text NOT NULL,
  UNIQUE (sequence_id, step_number)
)

automation_runs (                    -- estado de execução por cliente/agendamento
  id uuid PK, clinic_id FK,
  automation_id text NOT NULL, customer_id FK,
  appointment_id uuid NULL, sequence_id uuid NULL, customer_package_id uuid NULL,
  current_step int DEFAULT 0,
  status text CHECK (status IN ('active','completed','converted','stopped','error'))
    DEFAULT 'active',
  next_run_at timestamptz,           -- ★ o tick por minuto varre isto
  stop_reason text,                  -- 'customer_replied','appointment_booked','blocked','opted_out'
  started_at, finished_at timestamptz
)
-- INDEX parcial (next_run_at) WHERE status='active'   -- global, cross-tenant, p/ o scheduler
-- INDEX (clinic_id, customer_id, automation_id)

automation_log (
  id bigserial PK, clinic_id FK,
  automation_id text, run_id uuid NULL, customer_id uuid NULL, appointment_id uuid NULL,
  action text, result text CHECK (result IN ('queued','pending_approval','sent','skipped',
                                             'approved','rejected','error')),
  message_id uuid NULL, detail text, created_at
)
```

**Regras do motor (`packages/core/automation-engine`):**
- Guardas universais antes de qualquer disparo: `customers.automations_blocked = false`, cliente sem agendamento futuro (para reativação/preenchimento), dentro do horário comercial, instância conectada.
- Reativação inteligente: job diário encontra clientes cujo `último showed + procedures.return_days` venceu, sem run ativa → cria `automation_run` com a sequência do procedimento; cada passo agenda o próximo via `next_run_at`. Resposta do cliente ou novo agendamento marca `converted` e para a sequência.
- Preenchimento inteligente: job diário lista buracos de agenda nas próximas 72h (função que subtrai appointments do `business_hours`) e cruza com clientes com retorno em atraso, ordenados por score; envia horários + link de agendamento.
- Cadências 24h/2h/45min: quando o appointment é criado/confirmado, o motor materializa runs com `next_run_at = starts_at - interval` — o tick só compara timestamps, sem cálculo em tempo de varredura.

### 2.15 Inteligência (score)

**Decisão: snapshot materializado, não cálculo on-the-fly.** Justificativa: o ranking exige `ORDER BY score DESC` paginado sobre toda a base — calcular por linha exigiria agregações sobre appointments, sales e messages a cada request; e o componente de engajamento usa análise de teor de conversa via Claude, que é assíncrona e custa dinheiro (roda 1x/dia, não por página). Recalcula-se: (a) job noturno completo; (b) incremental por evento relevante (showed, venda paga, mensagem recebida) via fila `score:recalc` com debounce por cliente.

```sql
customer_scores (
  customer_id uuid PK REFERENCES customers(id),
  clinic_id FK,
  score int NOT NULL CHECK (score BETWEEN 0 AND 100),
  recency_score int,     -- 0–25: dias desde última visita vs return_days do procedimento
  frequency_score int,   -- 0–25: nº de visitas em 12 meses vs mediana da clínica
  value_score int,       -- 0–25: total investido vs percentis da clínica
  engagement_score int,  -- 0–25: classificação Claude do teor das conversas recentes
  classification text CHECK (classification IN ('best_profile','attention','high_risk','not_returned')),
  suggested_action text, -- texto gerado por Claude ("Cliente VIP e recorrente. Ofereça...")
  visits_count int, total_spent numeric(12,2),
  last_visit_at date, avg_interval_days numeric(6,1),
  favorite_procedures jsonb,         -- [{procedure_id,name,count}]
  computed_at timestamptz NOT NULL
)
-- INDEX (clinic_id, score DESC)     -- ranking
-- INDEX (clinic_id, classification)
```

### 2.16 Portal do cliente, notificações, auditoria

```sql
customer_portal_tokens (
  id uuid PK, clinic_id FK, customer_id FK,
  token_hash text NOT NULL,          -- sha256 do token; nunca em claro
  purpose text CHECK (purpose IN ('portal_login','signature','quote_view','booking')),
  expires_at timestamptz NOT NULL, used_at timestamptz, created_at
)
-- INDEX (token_hash)

notifications (
  id uuid PK, clinic_id FK,
  user_id uuid NULL,                 -- NULL = todos os usuários da clínica
  type text,                         -- 'approval_pending','stock_low','instance_disconnected',
                                     -- 'ai_handoff_requested','payment_overdue'...
  title text, body text, ref_table text, ref_id uuid,
  read_at timestamptz, created_at
)
-- INDEX (clinic_id, user_id, read_at) 

audit_log (                          -- LGPD: quem acessou/alterou o quê
  id bigserial PK, clinic_id FK,
  user_id uuid NULL, action text,    -- 'create','update','delete','view_sensitive','export'
  table_name text, record_id uuid, changes jsonb,  -- diff before/after
  ip inet, created_at
)
-- INDEX (clinic_id, created_at DESC), INDEX (table_name, record_id)
-- Escrito pela camada de serviço em mutações de dados sensíveis (customers, anamnesis_*,
-- clinical_notes, customer_photos, documents) e em exports.
```

---

## 3. Estratégia multi-tenant (decisão e justificativa)

**Recomendação: banco único + `clinic_id` em toda tabela + escopo obrigatório na camada de acesso + RLS do Postgres como segunda linha de defesa.**

1. **Camada de acesso (defesa primária, ergonômica):** o `packages/db` exporta apenas `withTenant(clinicId, fn)` — abre transação, executa `SET LOCAL app.clinic_id = '<uuid>'` e entrega um cliente Drizzle. Nenhum código de feature importa o cliente cru; lint rule proíbe import direto de `db.raw`.

2. **RLS (defesa em profundidade, obrigatória aqui):** anamnese, evolução e fotos são **dados sensíveis de saúde (LGPD art. 5º, II)** — um único `WHERE clinic_id` esquecido num join vira incidente de vazamento entre clínicas concorrentes. Com RLS, o vazamento é estruturalmente impossível mesmo com bug de aplicação:

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (clinic_id = current_setting('app.clinic_id')::uuid);
-- idem para todas as tabelas de tenant (gerado por script de migração)
```

A aplicação conecta com role `app_user` **sem** `BYPASSRLS`; migrações rodam com role `app_migrator`. Custo de performance é desprezível (comparação de uuid por linha já filtrada por índice que começa em `clinic_id`).

3. **Por que não schema-per-tenant ou database-per-tenant:** numa VPS única com dezenas/centenas de clínicas pequenas, N schemas multiplicam o custo de migração, quebram o scheduler global (`automation_runs.next_run_at` precisa de varredura cross-tenant eficiente), complicam backup/restore e não trazem isolamento adicional relevante frente a RLS forçado. Se um dia surgir um cliente enterprise exigindo isolamento físico, extrai-se aquela clínica para outra instância — o modelo `clinic_id` não impede isso.

4. **Tabelas globais (sem RLS):** `users`, `auth_sessions`, `automation_definitions`. O worker usa role com `app.bypass = 'on'` apenas nos schedulers de varredura global, e imediatamente reentra em `withTenant` ao processar cada item.

---

## 4. Autenticação e autorização

### 4.1 Equipe da clínica

- **Auth própria com sessões opacas em Postgres** (`auth_sessions`): cookie httpOnly + Secure + SameSite=Lax, token aleatório de 32 bytes armazenado como sha256. Sem JWT stateless — revogação imediata importa (funcionária demitida) e o público-alvo não usa SSO. Login por e-mail + senha (argon2id), com "esqueci a senha" via link mágico por e-mail **ou WhatsApp** (público não-técnico frequentemente não tem e-mail ativo).
- Seletor de clínica na topbar (como no Vittax): `auth_sessions.active_clinic_id`; trocar de clínica revalida o membership.
- **RBAC estático** em `packages/core/permissions.ts` — mapa `role → Set<permission>` com permissões string (`agenda.read`, `agenda.write`, `customers.read`, `customers.clinical.read`, `finance.read`, `finance.write`, `commissions.read.own`, `commissions.manage`, `approvals.review`, `automations.manage`, `stock.manage`, `reports.read`, `team.manage`, `settings.manage`). Sem tabela de permissões custom no MVP — papéis fixos são autoexplicativos para o público-alvo.

| Capacidade | owner (dona) | manager (gestora) | professional | reception |
|---|---|---|---|---|
| Dashboard, agenda (todas) | ✅ | ✅ | só a própria | ✅ |
| Clientes: dados cadastrais | ✅ | ✅ | ✅ | ✅ |
| Clientes: anamnese/evolução/fotos | ✅ | ✅ | ✅ | ❌ (só visualiza existência) |
| Funil, orçamentos | ✅ | ✅ | ❌ | ✅ |
| Aprovações (fila) | ✅ | ✅ | ❌ | ✅ |
| Inbox WhatsApp + takeover | ✅ | ✅ | ❌ | ✅ |
| Financeiro completo | ✅ | ✅ | ❌ | ❌ |
| Comissões | ✅ todas | ✅ todas | só as próprias | ❌ |
| Estoque | ✅ | ✅ | consumo | ❌ |
| Automações (config), termos (modelos) | ✅ | ✅ | ❌ | ❌ |
| Equipe, taxas de cartão, config | ✅ | ❌ | ❌ | ❌ |
| Relatórios | ✅ | ✅ | ❌ | ❌ |

Enforcement em três pontos: wrapper `authAction()` de toda server action (sessão → membership → permissão → zod), filtro do menu lateral, e `middleware.ts` para grupos de rota.

### 4.2 Cliente final (portal / assinatura / orçamento)

**Magic link via WhatsApp, sem senha.** O link enviado (`/portal/entrar/{token}` ou `/assinar/{token}`) carrega token de uso único (hash em `customer_portal_tokens`, TTL 15 min para login). Para assinatura de termo, o acesso ao documento é pelo `sign_token` de vida mais longa (7 dias), mas o **ato de assinar** exige OTP de 6 dígitos enviado ao WhatsApp do cadastro — prova de posse do número que fortalece a trilha probatória. Sessão do portal: cookie separado (`portal_session`), escopo restrito às rotas `/portal`, 30 dias. O portal expõe: próximos agendamentos (com botões confirmar/reagendar), histórico, pacotes com barra de progresso, documentos assinados, pré/pós-cuidados.

---

## 5. Armazenamento de arquivos e backup

**Decisão: volume local no Docker + abstração `StorageDriver` (interface com `put/get/delete/stream`), com `LocalDriver` hoje e `S3Driver` pronto para quando sair da VPS única.** MinIO na mesma VPS só adicionaria RAM e um serviço a operar sem ganho real de durabilidade — durabilidade vem do backup off-site, não do protocolo de acesso.

- Layout: `/data/storage/{clinic_id}/photos/{customer_id}/{uuid}.webp` (+ `_thumb.webp`), `/data/storage/{clinic_id}/documents/{uuid}.pdf`, `/data/storage/{clinic_id}/media/{conversation_id}/...`, `/data/storage/{clinic_id}/branding/logo.webp`.
- **Nunca servido estático.** Fotos clínicas são dado sensível: rota `/api/files/[...path]` valida sessão + tenant + permissão (`customers.clinical.read` para fotos) antes de fazer stream, com `Cache-Control: private`. Upload de fotos passa por `sharp` no worker: remove EXIF (GPS!), converte para webp, gera thumb de 400px.
- **Backup (container dedicado, cron):** diário 02:00 — `pg_dump -Fc` + `restic backup /data/storage /backups/pg` para bucket S3-compatível **externo** (Backblaze B2/Wasabi, ~US$6/TB), criptografado pelo restic (chave fora da VPS). Retenção `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`. WAL archiving opcional em fase 2 para PITR. **Restore testado mensalmente por script** (sobe postgres efêmero, restaura, roda sanity queries) — backup não testado não é backup. Redis fora do backup: só filas/cache, reconstruível do Postgres.

---

## 6. Geração de PDFs dos termos

- **Renderização de variáveis própria** (`packages/core/template-render.ts`): substituição de `{{variavel}}` com escape HTML, whitelist de variáveis conhecidas (`nome, cpf, telefone, email, endereco, valor, procedimento, clinica, data, profissional`) e erro explícito para variável não resolvida — nada de `eval`/Handlebars completo (superfície de injeção desnecessária).
- **HTML → PDF com Gotenberg** (container próprio, API HTTP `POST /forms/chromium/convert/html`). Por que não Puppeteer embutido no worker: Chromium isolado em container próprio não compete por memória com o worker numa VPS única, a imagem já vem pronta, e a chamada é um POST simples na rede interna do compose.
- Pipeline no job `pdf:generate`: HTML congelado do documento + folha de estilo de impressão + cabeçalho com logo da clínica + **página final de evidências** (nome/CPF do signatário, imagem da assinatura, data/hora com timezone, IP, user-agent, `content_sha256`, resultado do OTP, QR code para `/verificar/{id}`) → Gotenberg → grava `pdf_path`, calcula `pdf_sha256`, loga `pdf_generated` no audit log → enfileira envio do PDF ao cliente via WhatsApp.
- **Importação de Word:** `mammoth` (docx → HTML limpo) preservando os placeholders `{{...}}` do texto; o resultado cai no editor de template para revisão antes de ativar.

---

## 7. Stack dentro do Next.js

| Camada | Escolha | Racional |
|---|---|---|
| Framework | Next.js 15, App Router, TS estrito | RSC para leitura direta do banco; um app só para painel + portal + páginas públicas |
| Mutações | **Server Actions** com wrapper `authAction` (sessão + tenant + RBAC + zod) | menos boilerplate que API routes; tipagem ponta a ponta |
| Route Handlers | apenas para: webhook Evolution, arquivos, páginas públicas (assinatura/orçamento/booking), health | tudo que não tem sessão de painel |
| Dados no cliente | RSC por padrão; **TanStack Query** nas telas vivas (agenda, kanban, inbox, aprovações) com polling de 10–15s | tempo-real simples e suficiente; SSE/WebSocket fica para fase 2 |
| ORM | **Drizzle** | SQL-first (necessário p/ RLS `SET LOCAL`, exclusion constraints, partial indexes), migrações versionadas em SQL |
| UI | **shadcn/ui + Tailwind v4 + Radix** | visual profissional, 100% customizável, textos todos em pt-BR; componentes acessíveis prontos (Dialog p/ ficha do cliente com abas, Command p/ busca global) |
| Formulários | react-hook-form + zod (schemas compartilhados com as server actions) | validação única nos dois lados |
| Gráficos | **Recharts** (via shadcn/charts) | cobre barras (Receitas vs Despesas), donut (Distribuição de Status, Por Categoria), linhas (faturamento) |
| Agenda | **react-big-calendar** (MIT) com suporte nativo a *resources* → colunas por profissional/sala, localizer date-fns pt-BR, addon de drag-and-drop p/ reagendar | FullCalendar resource-view é licença paga; react-big-calendar entrega a vista dia/semana por profissional sem custo |
| Kanban do funil | **dnd-kit** + colunas próprias | leve, acessível, controle total da ordenação (`deals.position`) |
| Tabelas | TanStack Table | filtros/ordenação/paginação das listas (clientes, contas, estoque) |
| Datas | date-fns + @date-fns/tz, locale ptBR | tudo `timestamptz` no banco; conversão pelo `clinics.timezone` num helper único |
| Estado global | Zustand pontual (clínica ativa, badge de aprovações) | resto vem do servidor |

**UX autoexplicativa (requisito duro):** rótulos em linguagem da clínica, nunca jargão ("Compareceu", "Faltou", "A confirmar"); chips de ação rápida na ficha (Confirmação, Fotos, Reagendamento, Compareceu — como no vídeo); empty states que ensinam ("Você ainda não tem modelos de termo. Importe um Word ou use um modelo pronto →"); onboarding em checklist (conectar WhatsApp por QR → cadastrar procedimentos → importar clientes via planilha → ativar primeira automação); confirmações destrutivas sempre com consequência explícita.

---

## 8. IA conversacional (Anthropic) — desenho do agente

- **Onde roda:** exclusivamente no worker (`packages/ai`), consumindo a fila `messages:inbound`. Com **debounce de ~8s por conversa** — humanos mandam 3 mensagens picadas; o agente responde ao bloco, não a cada linha (essencial para parecer humano).
- **Modelo:** `claude-opus-5` para a conversa com o cliente final (a humanização é requisito nº 1 do produto — o cliente *nunca* pode perceber que é um sistema; este é o lugar errado para economizar). `claude-haiku-4-5` para tarefas auxiliares de classificação em lote: score de engajamento (0–25) e análise de sentimento/intenção de handoff, rodadas no job noturno via **Batches API** (50% do custo).
- **Prompt caching:** system prompt em duas partes com `cache_control` — persona + regras (estável, primeiro) e contexto da clínica (procedimentos, preços, horários — serializado deterministicamente); dados voláteis (dados do cliente, resumo `ai_context_summary`, hora atual) entram como mensagem, nunca no prefixo cacheado.
- **Tool use (tool runner do SDK)** com ferramentas de escopo mínimo: `buscar_horarios_disponiveis`, `criar_pre_agendamento`, `confirmar_agendamento`, `reagendar`, `consultar_pacote_do_cliente`, `registrar_interesse` (cria/move deal no funil), `solicitar_atendente_humano` (handoff), `enviar_link_assinatura`. Ferramentas de escrita respeitam o mesmo `withTenant` + máquina de estados do resto do sistema — a IA não tem caminho privilegiado.
- **Guardrails de persona:** responde como "a equipe da {clinica}" em primeira pessoa; nunca admite ser IA nem menciona "sistema"; não dá orientação clínica (redireciona para a profissional); não negocia preço fora da tabela; mensagens curtas, com a pontuação/registro informal do WhatsApp brasileiro; quando incerta ou diante de cliente irritado → `solicitar_atendente_humano` (notificação + `mode='paused'`). Saída do agente para automações sensíveis entra na fila de **aprovações** conforme configuração da clínica.

---

## 9. Ordem de construção sugerida (dependências técnicas)

1. **Fundações:** monorepo, compose, `packages/db` com RLS + `withTenant`, auth + RBAC, CRUD clínica/equipe.
2. **Núcleo operacional:** clientes (ficha completa: anamnese versionada, evolução, fotos, timeline), procedimentos, agenda com máquina de estados.
3. **WhatsApp:** instâncias/QR, webhook → inbox, fila de envio com throttle, takeover.
4. **Automações fase confirmação** (24h/2h/45min + respostas automáticas) + fila de aprovações — é o coração do valor percebido.
5. **Comercial/financeiro:** funil, orçamentos → vendas → estoque → contas → taxas de cartão → comissões.
6. **Termos + assinatura nativa + PDFs.**
7. **Demais automações** (faltas, pós, reativação com sequências, preenchimento, renovação, aniversário) + **IA conversacional**.
8. **Inteligência (score) + relatórios + portal do cliente + agendamento online.**

Este desenho cobre todos os itens do inventário de requisitos (dashboard, funil, aprovações, automações por fase, inteligência com breakdown de score, relatórios, agenda, clientes com ficha em abas, termos com variáveis e importação de Word, orçamentos, estoque com mínimo, procedimentos com retorno/retoque/pré-pós-cuidados, pacotes com sessões, financeiro com taxas 1x–15x e antecipação, comissões com regras e "marcar como pago", equipe, e instâncias WhatsApp), dentro das sete decisões já tomadas.