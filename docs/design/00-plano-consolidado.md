# Sistema de Gestão para Clínicas — "ClinicaOS" (baseado no Vittax)

## 1. Contexto

Paulo vai desenvolver, para um cliente (clínica de estética em São Paulo), um SaaS inspirado no
Vittax (https://vittabusiness.vercel.app/lp-vittax): gestão clínica completa + automações
inteligentes de WhatsApp. Requisitos levantados de 3 fontes: descrição detalhada do Paulo,
análise da landing page do Vittax e análise frame a frame do vídeo demo
(`WhatsApp Video 2026-08-19 at 23.39.40.mp4`).

Dois requisitos transversais **duros**:
1. **Humanização total**: o cliente final nunca deve perceber que conversa com um sistema.
2. **UX autoexplicativa** para usuárias não-técnicas (dona/recepção de clínica), visual profissional.

O design passou por 3 arquitetos paralelos (dados/arquitetura, automações/IA, UX/roadmap) + 1
revisor cético; este plano é a **consolidação final**, com todos os conflitos resolvidos (§12).

## 2. Decisões confirmadas pelo Paulo (2026-08-20)

| # | Decisão |
|---|---------|
| 1 | **Multi-tenant desde já** — `clinic_id` em tudo; revendável como SaaS |
| 2 | **WhatsApp via Evolution API** (não oficial, número real via QR, mensagens livres) |
| 3 | **Assinatura eletrônica nativa** (link + assinatura na tela + IP/hash/trilha, MP 2.200-2/2001) |
| 4 | **Uma VPS com Docker Compose** (Next.js, Postgres, Redis, Evolution, worker) |
| 5 | IA conversacional com **API Claude** (recomendação embutida; aprovação via este plano) |

## 3. Módulos do produto (inventário completo)

Dashboard diário · Agenda (estados: agendado→confirmado→compareceu/faltou/cancelado/reagendado) ·
Clientes (ficha: dados, anamnese por modelos, evolução, fotos antes/durante/depois, histórico com
indicador de retorno, pacotes com sessões, timeline) · Inbox WhatsApp com takeover ·
Aprovações (human-in-the-loop) · Automações (6 grupos, ver §6) · Inteligência (score 0-100 com
breakdown recência/frequência/valor/engajamento + ação sugerida) · Termos de consentimento
(templates com {{variáveis}}, envio WhatsApp, assinatura nativa) · Orçamentos (link público →
conversão em venda) · Funil de vendas (kanban) · Estoque (mínimo, movimentações, consumo por
procedimento) · Financeiro (a receber/pagar, taxas cartão 1x-15x, antecipação, categorias) ·
Comissões (regras, apuração, marcar pago) · Relatórios · Equipe/RBAC · Onboarding wizard ·
Página pública de agendamento · Área do cliente mínima (link mágico, fase 3).

## 4. Arquitetura

**Monorepo pnpm + Turborepo** (`clinicaos/`):
- `apps/web` — Next.js 15 App Router, TS estrito: painel autenticado, páginas públicas
  (`/assinar/[token]`, `/orcamento/[token]`, `/agendar/[slug]`), webhook Evolution, rota de
  arquivos autenticada.
- `apps/worker` — Node standalone: consumidores BullMQ + schedulers (processo persistente).
- `packages/db` (Drizzle + migrations SQL), `packages/core` (domínio puro: FSM de agendamento,
  motor de automações, score, render de templates, comissões, RBAC), `packages/whatsapp`
  (cliente Evolution + normalização de webhooks), `packages/ai` (cliente Anthropic, prompts,
  tools, guardrails), `packages/config`.

**Docker Compose (VPS única, recomendação inicial: 4 vCPU / 8 GB, ex.: Hetzner/Contabo KVM):**
`caddy` (TLS automático) · `web` · `worker` · `postgres:16` (RLS forçado) · `redis:7` ·
`evolution-api v2` (pin de versão + upgrade canário) · `gotenberg` (HTML→PDF) ·
`faster-whisper` (transcrição de áudio, fase 2) · `backup` (pg_dump + WAL/PITR + restic → B2/Wasabi,
inclui volume `evolution_instances` e `app_storage`) · `uptime-kuma` (monitoração).

**Fluxo de mensagens:** webhook Evolution → handler leve (valida token do path, grava evento
bruto em `whatsapp_events`, enfileira, responde <100ms) → worker normaliza (cria conversa/cliente/
lead) → pipeline IA ou roteamento humano → todo envio passa por `q:outbound` (1 worker por
instância: ordem, throttle, horário comercial, opt-out, aprovação).

**Regra de ouro do scheduler (conflito 2.1 resolvido): a verdade é o Postgres.**
`automation_runs.next_run_at` é a fila real; tick BullMQ a cada minuto varre
`next_run_at <= now()`. Dedupe de webhook (`whatsapp_events.wa_message_id` UNIQUE), ids de
mensagens enviadas e estado de cadência vivem no Postgres. Redis é descartável: se for perdido,
o worker re-enfileira no boot tudo que está `queued`. Todo consumidor **revalida elegibilidade**
no momento da execução (agendamento existe? status vale? cliente não bloqueado?) — job inválido
morre em silêncio; cancelamento tolerante a corridas.

**Filas BullMQ:** `q:inbound` · `q:inbound-debounce` (agrega rajada de mensagens, 10s) · `q:ai`
(concorrência 4) · `q:outbound` (1/instância) · `q:cadence` · `q:daily` · `q:analysis` (Haiku) ·
`q:dlq` (alerta superadmin via e-mail + in-app).

**Exactly-once no envio (lacuna 3.2 resolvida):** linha em `messages` com `status='sending'`
gravada ANTES do POST à Evolution; sucesso grava `wa_message_id`; crash no meio → na
recuperação, linhas `sending` são reconciliadas via webhook `SEND_MESSAGE`/consulta antes de
qualquer reenvio; **proativa em dúvida nunca reenvia**. Mensagem duplicada é o fingerprint de
robô mais barato que existe.

**E-mail transacional (lacuna 1.3):** Resend (free tier) para convites, reset de senha e
alertas ("WhatsApp desconectou" não pode ir pelo próprio WhatsApp). Tabela `email_log`.

**Observabilidade (lacuna 3.9):** Sentry (web+worker), logs estruturados pino, bull-board no
admin, Uptime Kuma, alertas de fila crescendo/DLQ para o superadmin.

## 5. Modelo de dados (canônico — nomes do Design 1, consolidado)

Convenções: PK uuid, `clinic_id` em toda tabela de tenant + índices compostos começando por
`clinic_id`, dinheiro `numeric(12,2)`, datas `timestamptz` (UTC; conversão por `clinics.timezone`),
enums como text+CHECK. Extensões: `pg_trgm`, `btree_gist`, `pgcrypto`.

**Multi-tenant: banco único + `clinic_id` + `withTenant(clinicId, fn)`** (transação com
`SET LOCAL app.clinic_id`) **+ RLS FORÇADO em toda tabela de tenant** (política
`clinic_id = current_setting('app.clinic_id')::uuid`; app conecta sem BYPASSRLS). RLS é
obrigatório na Fase 1 — dados de saúde, vazamento entre clínicas concorrentes é inaceitável.

Domínios e tabelas (colunas-chave detalhadas no design consolidado):

- **Tenancy/equipe**: `clinics` (timezone, business_hours jsonb, booking_slug,
  anticipates_receivables, google_review_url, settings), `users` (global), `clinic_members`
  (role: owner/manager/professional/reception — 4 papéis no schema, 3 expostos na UI do MVP),
  `professionals` (recurso de agenda, nem toda profissional tem login), `rooms`, `auth_sessions`
  (sessões opacas em Postgres, cookie httpOnly; revogação imediata).
- **Clientes**: `customers` (phone_e164 UNIQUE por clínica, status lead/active/at_risk/inactive
  derivado, automations_blocked, opted_out_at, lgpd_consent_*, whatsapp_valid, soft delete),
  `customer_phones` (números secundários), `tags`/`customer_tags`,
  `customer_history_entries` (**lacuna 1.4**: atendimentos pré-sistema lançados via "Inserir
  Histórico" — alimentam score/reativação SEM disparar efeitos de comissão/estoque/automação),
  ferramenta **mesclar clientes** (re-aponta FKs, soft-delete da duplicata).
- **Anamnese**: `anamnesis_templates` + `anamnesis_template_versions` (schema jsonb versionado
  imutável) + `anamnesis_responses` (respostas **cifradas em nível de aplicação** — AES-GCM,
  chave fora do banco; lacuna 3.3a). Respostas "de risco" viram alerta vermelho no header da ficha.
- **Clínico**: `clinical_notes` (evolução; texto cifrado), `customer_photos` (kind
  before/during/after, EXIF removido via sharp, servidas só por rota autenticada),
  `customer_events` (timeline unificada, populada pela camada de serviço).
- **Serviços**: `procedures` (duração, preço, custo, **return_days** → reativação,
  **touchup_days** → retoque, pre_care/post_care, post_sale_cadence_days[],
  commission_default_pct), `procedure_supplies` (consumo de estoque por sessão), `packages` +
  `package_items` + `customer_packages` (sessions_total/used, expires_at, extensão de validade
  com auditoria) + `package_session_uses` (auditável/estornável).
- **Agenda**: `appointments` (status CHECK: scheduled/confirmed/showed/no_show/cancelled/
  rescheduled; **confirmação é o status `confirmed`**, sem campo paralelo; **reagendar cria
  novo appointment** ligado por `rescheduled_to_id`; `allow_overlap` para encaixe intencional;
  EXCLUDE gist anti-overlap **por profissional E por sala** com `WHERE NOT allow_overlap`;
  origin: manual/online_booking/automation/ai_agent), `appointment_status_history`,
  `schedule_blocks` (**lacuna 1.6b**: almoço/férias/feriado — respeitados por slots, booking
  público e preenchimento inteligente). FSM em `packages/core` é a **única porta de mutação**
  de status; transições disparam efeitos na mesma transação (histórico, timeline, gatilhos).
  Conflito de slot: violação do constraint → erro amigável "esse horário acabou de ser
  preenchido" com alternativas (IA, booking e F1 tratam o mesmo erro).
- **Funil**: `pipelines`/`pipeline_stages`/`deals` (todo lead é `customer` com status lead;
  lead automático de conversa nova de número desconhecido).
- **Vendas**: `quotes` (+public_token, status até expired; aceite após validade → bloqueia e
  pede regeração) → `sales`/`sale_items`/`sale_payments` → efeitos em transação única: produto
  debita estoque, pacote cria customer_package, parcelas geram `receivables` com taxa por
  parcela, itens geram comissão. Numeração sequencial por clínica via `clinic_counters`
  (UPDATE...RETURNING).
- **Estoque**: `stock_items` (min_quantity → alerta diário), `stock_movements` (fonte da
  verdade, com sinal e unit_cost; tipos purchase/sale/procedure_use/adjustment/loss).
  **Lacuna 1.1 resolvida**: compra pode gerar `payable` (opção no lançamento); consumo por
  procedimento alimenta relatório de custo de materiais (CMV) a partir dos movements.
- **Financeiro**: `finance_categories`, `card_fee_configs` (1x-15x, fee normal e antecipada),
  `receivables` (gross/fee/net, parcela, due_date, status), `payables` (recorrência
  materializada por job). Cards e gráficos são agregações; sem tabela extra no MVP.
- **Comissões (edge 4.1 resolvido)**: `commission_rules` (profissional×procedimento, % ou fixo,
  especificidade vence), `commission_entries` geradas **no `showed`** (regime "atendimentos
  realizados no período", como o Vittax), `commission_payments` ("marcar como pago" → gera
  despesa). **Pacote: comissão por sessão executada** com base = price_paid/sessions_total;
  venda do pacote em si NÃO comissiona (evita comissão dupla). Base default `gross`.
- **Documentos**: `document_templates` (body_html com {{variáveis}} whitelisted, import Word
  via mammoth fase 3), `documents` (render congelado + content_sha256 + sign_token único),
  `document_signatures` (nome, CPF conferido contra cadastro, desenho canvas OU nome digitado
  em fonte manuscrita, IP, user-agent, hash, OTP **opcional** por clínica — abrir o link
  recebido no próprio WhatsApp já evidencia posse do número; edge 4.9 resolvido),
  `document_audit_log` (created→sent→link_opened→signed→pdf_generated), página `/verificar/{id}`.
- **WhatsApp**: `whatsapp_instances` (1 número por clínica no MVP), `conversations` (mode:
  ai/human/waiting_human; UNIQUE instance+jid), `messages` (direction, author:
  customer/ai/human/automation, status até delivered/read, automation_run_id), `approvals`
  (payload, edited_body, expires_at, status), `whatsapp_events` (payload bruto, retenção 30d).
- **Automações**: `automation_definitions` (catálogo GLOBAL seed, slugs por fase),
  `automation_settings` (por clínica: enabled, config jsonb, template, requires_approval),
  `followup_sequences`/`followup_steps` (até 7 passos, offset_days), `automation_runs`
  (instância de execução: current_step, **next_run_at** ★varrido pelo tick, status, stop_reason),
  `automation_log`, `feedbacks` (**lacuna 1.5**: score, texto, sentimento, appointment_id).
- **Inteligência**: `customer_scores` (snapshot materializado: score 0-100, 4 sub-scores 0-25,
  classification, suggested_action gerada por Claude, visits/total/última/intervalo,
  favorite_procedures; recálculo noturno + incremental por evento).
- **Campanhas (lacuna 1.2, fase 3)**: `campaigns` (segmento jsonb, template, status
  draft/running/paused/done) + `campaign_recipients` (progresso, entrega) — envio gradual
  respeitando caps.
- **Plataforma**: `notifications`, `audit_log` (LGPD: acesso/alteração de dado sensível e
  exports), `ai_usage` (tokens por clínica/dia + **cap mensal com kill-switch**, risco 3.6),
  `email_log`, `customer_portal_tokens` (uso único, hash).

## 6. Motor de automações (specs consolidadas)

Guardas universais em todo disparo proativo: instância conectada · dentro do horário comercial
da clínica · cliente não bloqueado/opt-out · **governador de frequência por cliente** (edge 4.3:
máx. 1 proativa/dia/cliente com prioridade time-critical > confirmação > pós > renovação >
preenchimento > reativação > aniversário; mensagens ligadas a agendamento existente sempre
passam) · cap diário da instância (§8) · revalidação de elegibilidade no momento do envio.

**A. Confirmação de agenda** — Lembrete 24h (pergunta confirmação; goal `confirmar`);
Confirmação 2h (skip se já confirmado); Lembrete 45min (logístico, envia mesmo confirmado,
`expires_at = starts_at`, **nunca passa por aprovação** — template fixo pré-aprovado; entra na
fase 2); Mensagem de reagendamento (novo appointment herda cadência dos marcos futuros);
Confirmação de retoque (ao `showed` com touchup_days: **oferece** horário — appointment só nasce
quando o cliente aceita; sem estado extra na FSM); Pré-cuidados por procedimento (Xh antes).

**B. Respostas reativas** (sempre direct-send, nunca aprovação): pós-confirmação, pós-remarcação,
pós-cancelamento (com oferta imediata de reagendar; sem resposta → follow-up D+2).

**C. Recuperação de faltas**: mensagem da falta 30–60min após marcar `no_show` (imediato demais
parece vigilância; slug `no_show_message`); follow-up D+3 (máx. 2); cancelamento pela recepção →
mesma oferta de reagendamento. Na fase 1 (sem IA conversacional): template + resposta roteada
para humano; a IA assume a partir da fase 2 (conflito 2.12 resolvido pela reordenação da fase 2).

**D. Pós-atendimento**: mensagem pós (+2h, cuidados do procedimento); coleta de feedback (+24h;
classificação pela IA: positivo → agradece + link Google Meu Negócio; neutro/negativo → NÃO envia
link, registra em `feedbacks` e **escala para humano**); cadência pós-venda por procedimento
(offsets configuráveis; para se refez o procedimento ou tem agendamento futuro dele).

**E. Reativação e base**: Reativação inteligente por procedimento (job diário 09:15 local +
jitter; elegível: último `showed` + return_days vencido, sem agendamento futuro, sem cadência
ativa, cooldown 60d pós-cadência; sequência de até **7 mensagens** com offsets default
D+0/3/13/25/40/60/90, tom progressivo até a despedida elegante; **resposta do cliente PAUSA a
cadência** e roteia à IA — se a conversa termina sem agendamento, **retoma** no passo seguinte
recontado da última interação, comportamento configurável; conflito 2.5 resolvido); reativação
genérica (sem procedimento com prazo, 30d, sequência curta); aniversário (job diário, 1/ano).

**F. Crescimento e receita**: Preenchimento inteligente da agenda (varre buracos ≥ duração mínima
nas próximas 72h respeitando `schedule_blocks`; candidatos = retorno em atraso ranqueados por
score, compatíveis com o profissional; oferta escalonada — 2º candidato só se o 1º não responder
em 4h; colisão de slot tratada pelo erro do constraint com alternativa; cooldown individual 14d);
Renovação de pacotes (2 gatilhos com mensagens distintas: sessões restantes ≤ N OU vence em 7d).

**Aprovações (3 modos por clínica + toggle por automação):** Supervisionado (default nos
primeiros 7 dias: tudo passa pela fila) → Semi-automático (templates fixos direto; reativação,
preenchimento, renovação e respostas de IA com confiança baixa ou com R$ passam pela fila).
Modo Autônomo fica fora do MVP. Time-critical nunca entra na fila. Expiração de item pula o
passo sem empilhar atraso. **Graduação de confiança**: "você aprovou 30 sem editar — quer
automatizar?" (caminho natural de adoção).

## 7. IA conversacional humanizada (Claude)

**Agente com ferramentas** (tool use, loop no worker, máx. 6 iterações) — nunca inventa horário,
preço ou agendamento: fatos vêm de tools; ações passam por tools com validação server-side
(`clinic_id` vem do job, jamais do modelo).

- **Pipeline**: inbound → debounce 10s por conversa (agrega mensagens picadas) → roteamento
  (mode human? opt-out?) → contexto → Claude → structured output
  `{balloons[1..3], internal_note, confidence}` → humanização mecânica → `q:outbound`.
- **Contexto** (ordenado p/ prompt caching): system estável por clínica (persona, catálogo com
  preços, políticas, regras duras) com `cache_control` → bloco volátil (data/hora) → ficha
  resumida do cliente + agendamentos futuros + **objetivo explícito da automação ativa** →
  histórico (~30 msgs ou resumo). **Anamnese NUNCA entra no prompt** (LGPD; assunto de saúde =
  escalação).
- **Tools**: consultar_horarios, agendar, reagendar, cancelar, confirmar_presenca,
  consultar_pacote, enviar_link_agendamento, registrar_interesse (cria deal),
  registrar_opt_out, escalar_para_humano.
- **Humanização mecânica**: visto (markAsRead) 2–8s após receber; delay de resposta 3–10s em
  horário comercial (fora: minutos, configurável); `delay` nativo do sendText proporcional ao
  texto (2–12s de "digitando…"); pausa 1,5–4s entre balões; máx. 1 emoji/balão; proibido
  markdown/listas/assinatura; variar aberturas; cliente mandou mensagem enquanto balões
  aguardam → cancela não-enviados e reprocessa (nunca "fala por cima").
- **Persona por clínica** (wizard 5min): nome da atendente, 3 presets de tom, nível de emoji,
  tratamento, FAQs, frases proibidas.
- **Escalação para humano** (tool + classificador Haiku assíncrono de rede de segurança):
  pedido explícito · irritação · **qualquer assunto clínico/médico (regra dura)** · negociação
  além da alçada · pergunta direta "é robô?" (**escala sem afirmar nem negar** — válvula que
  evita mentira explícita; ver §15) · 2 falhas de tool. Efeito: `waiting_human`, topo do inbox,
  push/notificação, SLA visual (vermelho após 15min urgente / 2h normal).
- **Takeover**: assumir por botão OU digitar no inbox OU responder pelo celular da clínica
  (mensagem `fromMe` não originada pelo sistema — checagem contra ids enviados persistidos no
  Postgres). Devolução por botão (com contexto opcional) ou auto-release 6h.
- **Prompt injection (risco 3.7)**: nenhum valor/desconto/condição sai da IA sem vir de tool;
  mensagem de saída contendo R$ não originado de tool → força fila de aprovação.
- **Áudio (risco 3.8)**: fase 1 → roteia silenciosamente para humano (nunca "manda por texto");
  fase 2 → transcrição local faster-whisper.
- **Modelos e custo**: conversa = Sonnet 5 (upgrade p/ Opus 5 se o piloto pedir mais
  naturalidade); classificação/score/resumos = Haiku 4.5 (Batches −50% p/ lote noturno).
  Ordem de grandeza: US$ 8–25/clínica/mês. `ai_usage` + cap/kill-switch por clínica desde o dia 1.

## 8. Anti-banimento (Evolution API)

Aquecimento por idade do número na plataforma (20/dia → 50 → 100 → 150 default, teto 250;
reativação em massa bloqueada nas 2 primeiras semanas); jitter 45–180s entre proativas; token
bucket por instância (3/min, 40/h proativas; bucket separado p/ reativas); envios proativos só
em horário comercial com espalhamento na janela (nunca em hora redonda); watchdog de entrega
(ack <70%/h → pausa proativas + alerta); settings da instância anti-fingerprint (groupsIgnore,
rejectCall com mensagem, alwaysOnline off); variantes de template (3–5 por automação, rotação
por cliente); links sempre de domínio próprio; **proibido cold list** (só clientes cadastrados/
que já interagiram); opt-out por keyword + IA (SAIR/PARAR/etc → confirma 1x e silencia;
auditável); `q:outbound` recheca tudo como última linha de defesa; verificação `onWhatsApp` na
importação e antes da 1ª proativa (edge 4.10); monitoração de desconexão (health-check 3min,
reconexão com backoff, >10min alerta dona, >24h suspende cadências com estado preservado).

## 9. Assinatura eletrônica nativa (fluxo)

Gerar (congela HTML + SHA-256) → enviar link via WhatsApp → cliente abre (`link_opened`) →
verificação leve (nome + CPF conferido; OTP WhatsApp opcional por clínica; nascimento só se
houver no cadastro) → scroll até o fim habilita → checkbox + assinatura (canvas OU nome digitado
em fonte manuscrita) → grava IP/UA/timestamp/hash/trilha → Gotenberg gera PDF com **página de
evidências** (signatário, IP, data/hora, hashes, QR p/ `/verificar/{id}`) → PDF enviado no
WhatsApp + arquivado na ficha. Acompanhamento Enviado→Visualizado→Assinado com reenvio de
lembrete >48h.

## 10. UX (consolidado)

**Sidebar agrupada por tarefa** (não por módulo): MEU DIA (Início, Agenda, WhatsApp, Aprovações —
badges só onde há ação pendente) · CLIENTES (Clientes, Funil, Inteligência) · VENDAS (Orçamentos,
Termos, Serviços [abas Procedimentos|Pacotes], Estoque) · GESTÃO (Automações, Financeiro [abas
incl. Comissões], Relatórios) · rodapé (Equipe, Configurações, Ajuda). Topbar: busca (fase 2),
pílula de status do WhatsApp (verde/vermelho clicável), notificações, seletor de clínica (se >1).
Mobile: bottom-nav Início·Agenda·WhatsApp·Aprovações·Mais.

**Princípios**: linguagem de dona de clínica, zero jargão ("Número conectado", nunca
"instância"); todo estado vazio orienta a próxima ação; automações vêm **pré-configuradas com
templates pt-BR prontos, desligadas** — o trabalho é ler, ajustar o tom e ligar; preview ao vivo
com dados reais; variáveis por **chips clicáveis** (nunca digitar {{}}); botão "Enviar teste para
meu WhatsApp"; toasts que ensinam ("Agendado! O lembrete automático sai amanhã às 14h");
timing em linguagem natural; sequências como linha do tempo visual; confirmações destrutivas com
consequência explícita; cores semânticas fixas (verde=confirmado/pago, âmbar=aguardando,
vermelho=falta/alerta, roxo/✨=feito pela IA — visível SÓ para a equipe).

**Telas-chave**: Dashboard com faixa de pendências acionáveis + cards HOJE clicáveis + agenda do
dia com botões inline [Confirmar][Compareceu][Faltou] + bloco "o que as automações fizeram hoje"
(vende o valor diariamente) + fim do dia: "3 atendimentos sem desfecho" (crítico: comissão,
financeiro e pós dependem do Compareceu). Agenda: dia-por-profissional (colunas), semana, lista
(mobile); criação em 15s (cliente novo inline só nome+WhatsApp); indicadores no card (✓ lembrete,
✓✓ confirmou, 📄 termo, 📦 sessão 5/10, ⚠ alergia); grid próprio em CSS Grid (controle total dos
cards; sem lib paga). Ficha do cliente: drawer com URL própria, header fixo com **alerta clínico
visível em todas as abas**, chips de ação rápida, 7 abas; anamnese enviável para a cliente
preencher por link. Inbox 3 colunas com banner de controle (IA/humano) + mini-ficha lateral.
Aprovações com edição inline, lote, countdown p/ sensíveis a tempo. Inteligência com breakdown
transparente (4 barras 0-25 com frase explicativa) + [Preparar mensagem] → sempre via Aprovações.
Onboarding wizard 7 passos (clínica → QR WhatsApp com ilustração → procedimentos com sugestões
de 1 clique → equipe → importar planilha → 3 automações essenciais + tom de voz → pronto), tudo
pulável, checklist persiste no dashboard.

**Design system**: shadcn/ui + Tailwind 4 + Radix; Recharts; TanStack Table/Query; react-hook-form
+ zod (schemas compartilhados com server actions); dnd-kit (kanban); date-fns pt-BR; Inter;
primária verde-petróleo/teal (saúde, foge do azul de ERP); tema claro; server actions com wrapper
`authAction` (sessão→tenant→RBAC→zod); RSC por padrão + polling 10-15s nas telas vivas.

## 11. LGPD e segurança

- Dados de saúde = dados sensíveis (art. 5º, II; art. 11): anamnese e evolução **cifradas em
  nível de aplicação** (AES-GCM, chave em env fora do banco); fotos nunca servidas estáticas
  (rota autenticada + permissão), EXIF/GPS removido; RLS forçado; `audit_log` de acesso/export.
- Base legal: mensagens operacionais de agendamento = execução de contrato/legítimo interesse;
  reativação/marketing sobre base importada = **1ª proativa com opt-out gracioso embutido** +
  consentimento coletado no termo/anamnese; opt-out auditável com timestamp; export e eliminação
  (anonimização + expurgo de mídia; nota sobre janela de backup na política de privacidade).
- IA: anamnese fora dos prompts; DPA da Anthropic (API não treina com dados por default);
  transferência internacional documentada na política de privacidade da clínica.
- Backup: pg_dump diário + **WAL/PITR desde a fase 1** (termos assinados têm valor probatório —
  RPO de 24h é inaceitável) + restic cifrado off-site (B2/Wasabi) incluindo `app_storage` E
  `evolution_instances`; **drill mensal de restore automatizado**; retenção de mídia de conversa
  90d (config).
- Auth: sessões opacas revogáveis, argon2id, cookies httpOnly/Secure; tokens públicos de uso
  único com hash; rate-limit em rotas públicas.

## 12. Registro de decisões de consolidação (conflitos resolvidos)

| # | Conflito | Decisão |
|---|----------|---------|
| 1 | Scheduler: Postgres vs BullMQ delayed jobs | **Postgres é a verdade** (`next_run_at`); BullMQ só motor; Redis descartável |
| 2 | FSM: confirmed como status vs campo paralelo; reagendar in-place vs novo registro | **Status `confirmed`**; **reagendar cria novo appointment** (`rescheduled_to_id`); retoque = oferta, appointment nasce no aceite |
| 3 | Schema de automações duplicado | Catálogo global + `automation_settings` por clínica + `automation_runs` com next_run_at (nomes do Design 1) |
| 4 | 45min × aprovação | Time-critical **nunca** entra na fila; 45min sai do MVP, entra na fase 2 |
| 5 | Resposta em reativação: parar vs pausar | **Pausa e retoma** se não converter (configurável) |
| 6 | RLS opcional vs obrigatória | **Obrigatória, fase 1** |
| 7 | Portal do cliente | Página única "Meus atendimentos" por link mágico (fase 3); sem sessão de 30d |
| 8 | Lib de agenda | **Grid próprio CSS Grid**; sem drag&drop no MVP (popover) |
| 9 | RBAC 3 vs 4 papéis | 4 no schema, 3 na UI do MVP |
| 10 | Números anti-ban divergentes | Consolidados no §8 (jitter 45-180s, cap default 150, debounce 10s, no-show +30-60min) |
| 11 | Webhook: quem cria cliente/conversa | Handler só valida+grava evento+enfileira; **worker** normaliza e cria |
| 12 | IA nas automações da fase 2 | IA conversacional construída ANTES das automações que dependem dela (reordenação §13) |

## 13. Roadmap faseado

Estimativas honestas para 1 dev (a crítica apontou subestimação de 1,5-2x na proposta original;
já corrigidas). Cortes do MVP: drag&drop, multi-número, modo autônomo, lembrete 45min, coreografia
completa de humanização (fase 1 usa só delay nativo + jitter + horário comercial — mensagens são
templates revisados), import com mapeamento assistido (planilha-modelo rígida), builder de
anamnese (só templates seed), PWA push, busca global, multi-pipeline.

### Fase 1 — MVP Operacional (~10–14 semanas)
Critério: a clínica opera o dia inteiro no sistema; toda automação em "revisar antes de enviar".
1. **Fundação**: monorepo, compose completo, schema+migrations+RLS+withTenant, auth+RBAC,
   seeds, layout shell, **TimeProvider** (relógio simulado injetado — nunca Date.now() direto),
   Sentry/pino, backup+PITR, cifra de campos sensíveis, e-mail (Resend).
2. **Catálogo + equipe** (procedures com return/touchup/cuidados, packages, rooms, blocks).
3. **Clientes**: lista+filtros, ficha (Dados/Anamnese seed/Histórico + Inserir Histórico),
   import por planilha-modelo + **merge/dedupe**, verificação onWhatsApp.
4. **Agenda**: grid dia-por-profissional/semana/lista, criação 15s, FSM completa com botões
   1-clique, encaixe com allow_overlap, schedule_blocks.
5. **Evolution**: conexão QR (UX 3 passos), webhook→eventos→worker, envio com exactly-once,
   status/reconexão/health-check.
6. **Worker + cadência de confirmação (24h/2h) + respostas B + Aprovações** (fila com edição/
   lote/expiração) + governador de frequência + anti-ban base.
7. **Inbox básico + takeover** (explícito, por digitação e implícito via fromMe).
8. **Classificador Claude** (confirmar/cancelar/remarcar/pergunta/outro → muda status ou
   marca "precisa de você"; ambiguidade com 2+ agendamentos → humano). Ainda sem conversa livre.
9. **Dashboard** + **onboarding wizard**.

### Fase 2 — Receita e Relacionamento (~8–10 semanas)
1. Financeiro essencial (a receber automático no Compareceu, despesas, recebimento, visão geral).
2. Pacotes na operação (atribuição, débito de sessão, no_show não consome por default — config).
3. Páginas públicas + **Termos com assinatura nativa** + PDFs (Gotenberg) + acompanhamento.
4. Orçamentos (link público, aceite, conversão em venda).
5. **IA conversacional completa** (persona, tools, humanização mecânica completa, escalação,
   áudio via faster-whisper, ai_usage+cap) — antes das automações que dependem dela.
6. Automações de relacionamento: faltas+follow-up, pós-atendimento, cadência pós-venda,
   feedback→Google, aniversário, pré-cuidados, retoque, lembrete 45min (política resolvida).
7. Página pública de agendamento/reagendamento (slots reais, pré-agendado p/ aprovação).
8. Inteligência v1 (score+breakdown+ação sugerida→Aprovações) + relatórios básicos.

### Fase 3 — Crescimento e Gestão Completa (~6–8 semanas)
1. Reativação inteligente (sequências 7 passos) + reativação genérica.
2. Preenchimento inteligente de agenda (72h) e renovação de pacotes.
3. Campanhas segmentadas com throttling (modelo próprio + envio gradual).
4. Funil kanban + lead automático do WhatsApp.
5. Estoque completo (mínimo, movimentações, consumo por procedimento, compra→payable, CMV).
6. Comissões (regras, apuração "realizado", marcar pago→despesa) + financeiro avançado
   (taxas 1x-15x, antecipação, fluxo de caixa).
7. Extras: import Word de termos, área do cliente (link mágico), estornos/cancelamento de venda
   (edge 4.2: fluxo de estorno com reversão de sessões/comissão), export LGPD self-service,
   drag&drop na agenda, PWA/push, multi-número, painel superadmin do SaaS + suspensão de tenant.

## 14. Verificação (estratégia de testes)

- **TimeProvider + endpoint dev de relógio**: avançar 24h dispara cadências em segundos —
  desenvolvimento e teste de automações sem esperar dias reais.
- **Mock da Evolution** no compose de teste: grava envios, emite webhooks sob comando — fecha o
  loop agendou→lembrete→aprovação→"enviou"→cliente respondeu→classificou→confirmado→dashboard.
- **Staging com Evolution real**: whitelist de números de teste + prefixo [TESTE].
- **IA**: record/replay p/ pipeline determinístico; dataset dourado ~100 respostas pt-BR
  coloquiais ("blz", "n vou pd ir 😢", "quem fala?") com gate de acurácia ≥95% a cada mudança de
  prompt; testes adversariais (persona, desconto, assunto médico, "é robô?") → handoff, nunca
  quebra.
- **Idempotência**: matar worker no meio do lote → zero duplicatas; fila represada → expira em
  vez de atrasar.
- **Isolamento multi-tenant no CI**: sessão da clínica A tenta cada recurso da clínica B por ID
  → 404 em 100% das rotas + testes de política RLS.
- **E2E Playwright por fase** (fase 2 inclui assinatura em viewport mobile e corrida de slot).
- **Seeds de cenário** (`pnpm seed:demo`): clínica-demo que exercita cada automação — dev, CI e
  demo de vendas.
- **Piloto real**: toda automação nova estreia em modo sombra (100% Aprovações) por 2 semanas;
  libera envio automático com taxa de edição <10% e zero incidentes de tom.

## 15. Riscos que exigem ciência do Paulo (e do cliente)

1. **Ban do WhatsApp**: Evolution API viola os ToS da Meta; o design trata ban como evento
   operacional (aquecimento, caps, watchdog, fluxo de troca), mas o risco existe e é
   **correlacionado** (mudança de protocolo derruba todas as clínicas ao mesmo tempo — pin de
   versão + canário mitigam). Recomendação: sugerir número dedicado para automações, preservando
   o número histórico da clínica; registrar o aceite desse risco no contrato com a clínica.
2. **Não-revelação de IA**: o sistema nunca afirma nem nega ser humano; pergunta direta escala
   para humano (evita mentira explícita). Ainda assim há risco jurídico em evolução no Brasil
   (CDC/boa-fé; PL 2338 caminha para exigir transparência de IA). Registrar aceite formal do
   cliente da clínica; a válvula de escape + takeover humano são a mitigação.
3. **LGPD**: operar dados de saúde exige as medidas do §11 implementadas de fato (não adiar
   cifra/auditoria/backup) e política de privacidade da clínica mencionando IA e transferência
   internacional.

## 16. Primeiros passos da execução (quando aprovado)

1. Copiar os 4 documentos de design detalhados para `docs/design/` no novo repositório
   (fontes: `scratchpad/designs/1..4-agent*.md` desta sessão).
2. Scaffold do monorepo + docker-compose + CI.
3. Migrations da fundação (tenancy, auth, RLS) + `withTenant` + testes de isolamento.
4. Seguir a ordem da Fase 1 (§13).
