# Design Técnico — Motor de Automações, WhatsApp (Evolution API) e IA Conversacional Humanizada

Sistema multi-tenant (isolamento por `clinic_id` em todas as tabelas e filas), rodando em 1 VPS via Docker Compose com os serviços: `web` (Next.js — UI + API routes + receptor de webhooks), `worker` (Node.js — consumidores BullMQ + schedulers), `postgres`, `redis`, `evolution-api`. O worker é um processo separado do Next.js: automações nunca dependem do ciclo de request HTTP.

---

## 1. Integração Evolution API

### 1.1 Gestão de instâncias por clínica

Cada número de WhatsApp = 1 instância Evolution, nomeada deterministicamente: `cl_{clinic_id}_{seq}` (ex.: `cl_42_1`). Uma clínica pode ter N números (campo `is_primary`).

**Tabela `whatsapp_instances`:**
```
id, clinic_id, instance_name (único), phone_number, api_token,
status ENUM(created|qr_pending|connected|disconnected|banned),
is_primary bool, warmup_started_at, daily_send_cap int,
last_connected_at, last_disconnect_at, disconnect_count_24h
```

**Fluxo de conexão (tela "Conectar WhatsApp" — 3 passos, sem jargão):**
1. `POST /instance/create` → `{instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS"}` + `POST /webhook/set/{instance}` com eventos: `QRCODE_UPDATED`, `CONNECTION_UPDATE`, `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `SEND_MESSAGE`.
2. Webhook `QRCODE_UPDATED` → push do QR (base64) para o front via SSE/polling; QR expira ~40s, re-render automático a cada atualização.
3. `CONNECTION_UPDATE: open` → status `connected`, salva `phone_number` retornado, exibe "✅ Conectado".

**Settings da instância na criação** (anti-ruído): `groupsIgnore: true`, `readStatus: false`, `rejectCall: true` + `msgCall` configurável ("Oi! Não atendemos ligação por aqui, me manda mensagem 😊"), `alwaysOnline: false` (online 24/7 é fingerprint de bot), `readMessages: false` — o "visto" é disparado pelo nosso pipeline no momento humanizado (ver §4.6).

**Monitoramento e reconexão:**
- Webhook `CONNECTION_UPDATE: close/connecting` → marca `disconnected`, **pausa a fila outbound da clínica** (BullMQ `queue.pause()` lógico via flag Redis `outbound:paused:{clinic_id}`), tenta `GET /instance/connect/{instance}` com backoff (30s, 2min, 10min, 30min).
- Health-check ativo: job repetível a cada 3min chama `GET /instance/connectionState/{instance}` para todas instâncias (webhook pode falhar silenciosamente).
- Desconectado > 10min → notificação in-app + e-mail à dona ("Seu WhatsApp desconectou — toque para reconectar"). Desconectado > 24h → pausa todas as automações da clínica e marca cadências como `suspended` (não perdem o estado; retomam com revalidação de elegibilidade).

### 1.2 Webhooks de entrada

Endpoint único `POST /api/webhooks/evolution` protegido por token no path + validação do header. Resolve `instance_name → clinic_id` (cache Redis). **Dedupe**: `SETNX wh:seen:{message.key.id}` TTL 24h — Evolution pode reentregar.

| Evento | Tratamento |
|---|---|
| `MESSAGES_UPSERT` com `fromMe: false` | Enfileira em `q:inbound` (payload mínimo: clinic_id, remoteJid, message_id, tipo, conteúdo, timestamp). Nunca processa inline no request. |
| `MESSAGES_UPSERT` com `fromMe: true` **e não originado pelo sistema** (id não está em `sent:ids`) | Dona/funcionária respondeu pelo celular → **takeover implícito**: seta `conversation.mode = human` (§4.8). Detalhe operacional crítico: sem isso a IA atropela conversas manuais. |
| `MESSAGES_UPDATE` (status `DELIVERY_ACK`/`READ`) | Atualiza `messages.status`; alimenta score de engajamento e watchdog anti-ban (entregas falhando em série = sinal de problema no número). |
| `CONNECTION_UPDATE` / `QRCODE_UPDATED` | §1.1. |

### 1.3 Envio

Serviço único `WhatsAppSender` (só o worker chama Evolution para envio — nunca o Next.js diretamente; UI de inbox enfileira):

- **Texto**: `POST /message/sendText/{instance}` usando o parâmetro `delay` nativo do Evolution (mostra "digitando…" pelo tempo informado antes de soltar a mensagem) — humanização de graça.
- **Presença extra**: `POST /chat/sendPresence` `{presence: "composing"}` para pausas entre balões.
- **Mídia** (fotos pré/pós, cartão de aniversário): `POST /message/sendMedia` `{mediatype: "image", media: <url assinada>, caption}`.
- **PDF de termo/orçamento**: `sendMedia` `{mediatype: "document", fileName: "Termo-Consentimento-{nome}.pdf", media: <url assinada curta duração>}` + balão de texto separado com o link de assinatura (`https://app.../t/{token}`).
- Todo envio grava em `messages` com `direction: out`, `source: automation|ai|human`, `automation_run_id`, e registra `message.key.id` retornado em `sent:ids` (Redis, TTL 7d) para o filtro de takeover implícito.

---

## 2. Pipeline de mensagens (BullMQ)

### 2.1 Filas

| Fila | Conteúdo | Concorrência |
|---|---|---|
| `q:inbound` | Mensagens recebidas (pós-webhook) | 10 |
| `q:inbound-debounce` | Job com delay que agrega rajada de mensagens do cliente antes de chamar a IA (§4.2) | 10 |
| `q:ai` | Turnos de conversa da IA (chamada Claude + tool loop) | 4 (limita custo/latência) |
| `q:outbound` | Envio efetivo ao Evolution — **único ponto que fala com o WhatsApp**; aplica rate-limit, jitter, horário comercial, opt-out, aprovação | 1 por instância (serialização garante ordem) |
| `q:cadence` | Passos de cadência agendados (delayed jobs): lembretes 24h/2h/45min, follow-ups D+N, feedback Xh | 10 |
| `q:daily` | Jobs cron por clínica: reativação, preenchimento de agenda, renovação de pacote, aniversário, recálculo de score | 2 |
| `q:analysis` | Sentimento, classificação de intenção pós-conversa, score (chamadas Haiku baratas) | 5 |
| `q:dlq` | Dead-letter — jobs com 3 falhas; alerta admin da plataforma | — |

### 2.2 Agendamento e idempotência

**Regra de ouro: o job agendado é uma *intenção*; a *verdade* está no banco no momento da execução.** Todo consumidor revalida elegibilidade antes de agir (agendamento ainda existe? status ainda `scheduled`? cliente não bloqueado/opt-out? horário do agendamento não mudou?). Job inválido → descarta silenciosamente com log. Isso torna o cancelamento tolerante a corridas: mesmo que um job "escape" do cancelamento, ele morre na revalidação.

- **jobId determinístico** = dedupe nativo do BullMQ: `rem24:{appointment_id}`, `conf2h:{appointment_id}`, `rem45:{appointment_id}`, `feedback:{appointment_id}`, `noshow-fu:{appointment_id}:{step}`, `reactiv:{client_id}:{step}`, `bday:{client_id}:{year}`, `pkg-renew:{package_id}:{trigger}`. Reenfileirar com mesmo jobId é no-op.
- **Cadências multi-passo (reativação, pós-venda)**: agenda-se **apenas o próximo passo**. Ao executar o passo N (e passar na elegibilidade), o próprio consumidor agenda N+1. Estado em `cadence_states (id, clinic_id, client_id, type, config_snapshot, current_step, next_run_at, status ENUM(active|paused|completed|cancelled), goal ENUM(confirmar|reagendar|reativar|renovar), cancel_reason)`. Cancelar = marcar `cancelled` + `queue.remove(jobId)` do próximo passo (best-effort; a revalidação cobre o resto).
- **Reagendamento de consulta**: `appointments` guarda `version int`. Os jobIds de lembrete embutem a versão (`rem24:{appointment_id}:v{n}`); ao remarcar, incrementa versão, remove jobs antigos e agenda os novos — jobs órfãos da versão anterior falham na revalidação (`appointment.version !== job.version`).

### 2.3 Regras de interrupção (matriz objetivo × evento)

| Evento | O que cancela | O que NÃO cancela |
|---|---|---|
| Cliente **confirmou** presença | Pedido de confirmação de 2h (objetivo atingido) | **Lembrete 45min continua** (é logístico, não pergunta nada) |
| Cliente **cancelou** consulta | Toda a cadência de confirmação daquele appointment; dispara automação C3 | Cadências de reativação futuras |
| Cliente **remarcou** | Cadência antiga (via version bump); nova cadência nasce para o novo horário | — |
| Cliente **agendou** (qualquer origem: IA, link, manual) | Cadência de reativação, preenchimento de agenda e follow-up de falta **daquele cliente** (goal atingido) | Lembretes do novo agendamento (nascem agora) |
| Cliente **respondeu** durante cadência de reativação | **Pausa** a cadência (`paused`, não `cancelled`) e roteia a conversa à IA; se conversa termina sem agendamento, cadência retoma no passo seguinte com offset recontado a partir da última interação | — |
| Cliente **comprou/renovou pacote** | Cadência de renovação daquele pacote | — |
| **Opt-out / bloqueio** | TODAS as cadências ativas do cliente, imediatamente | Respostas reativas mínimas da IA (apenas se opt-out foi só de campanhas — §6.4) |
| Marcado **Compareceu** | Lembretes residuais | Dispara D1, D2, D3, A5 |

### 2.4 Horário comercial e distribuição

- Config por clínica: `business_hours` (por dia da semana), timezone (default `America/Sao_Paulo`), `quiet_days` (feriados).
- Jobs de `q:daily` rodam via cron repetível às **09:15** locais da clínica (não às 9h em ponto — padrão de horário redondo é fingerprint de automação) e **espalham** os envios resultantes ao longo da janela: cada mensagem proativa recebe `delay = rand(0, janela_útil)` respeitando o rate-limit (§6.2).
- Consumidor de `q:outbound` checa: mensagem **proativa** fora do horário comercial → reagenda para próxima abertura + jitter. Mensagem **reativa** (resposta da IA a inbound) → envia mesmo fora do horário, com delay maior (§4.6). Mensagens **time-critical** (lembrete 45min, resposta de confirmação) → sempre enviam, com `expires_at`: lembrete de 45min com mais de 30min de atraso na fila é descartado (não faz sentido chegar depois da consulta).

---

## 3. Especificação das automações

Cada automação é uma linha em `automation_definitions (clinic_id, type, enabled, config jsonb, template_variants jsonb, requires_approval bool)` — editável na UI (toggle + editor com placeholders `{{nome}} {{clinica}} {{data}} {{hora}} {{profissional}} {{procedimento}} {{link}}`). Cada disparo gera `automation_runs (id, clinic_id, client_id, type, appointment_id?, status ENUM(pending_approval|queued|sent|delivered|read|replied|goal_reached|cancelled|expired|failed), goal, sent_at)` — base do dashboard de "tarefas das automações".

### Grupo A — Confirmação de Agenda

**A1. Lembrete 24h antes** — *Gatilho*: criação/remarcação de appointment (agenda job `appointment.starts_at - 24h`; se criado com <24h de antecedência, envia imediatamente com min 1h de gap). *Elegibilidade*: status `scheduled`, cliente com telefone válido, não bloqueado. *Envia*: template com data/hora/profissional + pergunta de confirmação ("Posso confirmar sua presença?"). *Interrompe*: cancelamento/remarcação (version bump). *Goal*: `confirmar`.

**A2. Confirmação 2h antes** — *Gatilho*: `starts_at - 2h`. *Elegibilidade extra*: `appointment.confirmation_status != confirmed` (se já confirmou no A1, **skip** — registra `goal_reached`). *Envia*: cobrança gentil de confirmação, fraseado diferente do A1 (nunca repetir texto — §6.5).

**A3. Lembrete 45min antes** — *Gatilho*: `starts_at - 45min`. *Elegibilidade*: status `scheduled` ou `confirmed` (**envia mesmo confirmado** — é lembrete logístico: "te espero daqui a pouco 😊 {endereço/sala}"). Só não envia se cancelado. `expires_at = starts_at`.

**A4. Mensagem de Reagendamento** — *Gatilho*: appointment remarcado (por qualquer via). *Envia*: confirmação do novo horário. *Efeito*: reinicia cadência A1–A3 para o novo horário (só os marcos ainda futuros).

**A5. Confirmação do Retoque** — *Gatilho*: appointment marcado `Compareceu` E `procedure.retouch_days != null`. *Ação*: cria appointment de retoque em `attended_at + retouch_days` (no primeiro slot livre do mesmo profissional, status `retouch_suggested`), envia mensagem oferecendo o horário; resposta do cliente é tratada pela IA (confirma → `scheduled`, quer outro horário → tool de reagendamento).

**A6. Pré-cuidados por procedimento** — *Gatilho*: `starts_at - config.hours_before` (default 48h; por procedimento). *Elegibilidade*: procedimento tem `pre_care_text`. *Envia*: instruções (ex.: "evite álcool 24h antes"). Independente da cadência de confirmação.

### Grupo B — Respostas a ações do cliente (reativas, sempre direct-send)

Disparadas quando a **IA executa a tool correspondente** ou quando o cliente usa o link público de agendamento:
- **B1 pós-confirmação**: "Perfeito, {{nome}}! Te espero {{dia}} às {{hora}} 💛" — e marca `confirmation_status = confirmed`, cancela A2 pendente.
- **B2 pós-remarcação**: confirma novo horário + dispara A4.
- **B3 pós-cancelamento**: lamenta sem culpabilizar + **oferta imediata de reagendamento** ("quer já deixar marcado outro dia?") — se cliente não reagendar na conversa, agenda C2-like follow-up em D+2 (`goal: reagendar`).

### Grupo C — Recuperação de Faltas

**C1. Mensagem da falta** — *Gatilho*: appointment marcado `no_show` (manual pela recepção ou job que marca automaticamente `starts_at + 2h` sem check-in, se clínica habilitar). Envia após **30–60min do gatilho** (imediato demais parece vigilância): "Oi {{nome}}, senti sua falta hoje! Aconteceu alguma coisa? Quer remarcar?" *Goal*: `reagendar`. IA assume a conversa a partir da resposta.

**C2. Follow-up de reagendamento** — *Gatilho*: `config.days_after` (default D+3) após C1 sem reagendamento. *Elegibilidade*: nenhum appointment futuro. Máx. 2 follow-ups; depois o cliente cai no fluxo de reativação normal.

**C3. Mensagem de cancelamento** — *Gatilho*: appointment `cancelled` pelo cliente (fora da conversa — ex.: recepção cancelou por telefone). Mesmo objetivo do B3.

### Grupo D — Pós-Atendimento

**D1. Mensagem pós-atendimento** — *Gatilho*: `Compareceu`, envio em +2h (config). Template por procedimento com cuidados pós ("nas próximas 24h evite sol…"). 

**D2. Coleta de feedback** — *Gatilho*: `Compareceu + config.hours` (default 24h). Pergunta aberta ("de 0 a 10, como foi sua experiência?" ou pergunta natural configurável). **Roteamento pela IA**: classifica a resposta — *positiva* (≥9 ou sentimento positivo) → agradece + envia link do Google Meu Negócio da clínica ("ajudaria muito se você deixasse essa avaliação aqui: {{gmb_link}}"); *neutra/negativa* → **NÃO envia link**, agradece, registra em `feedback (score, texto, sentimento)` e **escala para humano** com alerta "feedback negativo" (recuperação de cliente é tarefa humana).

**D3. Cadência pós-venda por procedimento** — *Gatilho*: `Compareceu`; config por procedimento: lista de offsets em dias com template cada (ex.: botox → D+7 "como está o resultado?", D+90 "hora de avaliar retoque"). *Elegibilidade em cada passo*: cliente não refez o procedimento nesse meio-tempo, sem appointment futuro do mesmo procedimento. *Interrompe*: novo agendamento do procedimento.

### Grupo E — Reativação e Base

**E1. Reativação inteligente por procedimento** — *Job diário por clínica.* Seleção: clientes cujo último procedimento tem `return_days` configurado e `last_visit + return_days < hoje`, **sem appointment futuro**, sem cadência de reativação ativa/pausada, sem opt-out/bloqueio, sem conversa ativa nos últimos 7 dias, e `cooldown`: última cadência de reativação concluída há > 60 dias. *Sequência*: até **7 mensagens** com offsets configuráveis (default D+0, +3, +13, +25, +40, +60, +90 relativos ao início da cadência), templates editáveis com `{{nome}} {{clinica}} {{procedimento}}`, tom progressivo: (1) cuidado genuíno → (2) benefício de manter o resultado → (3) facilidade de agendar + link → (4) prova social → (5) oferta leve (se clínica configurar) → (6) "última chamada" suave → (7) despedida elegante ("vou parar de te escrever por aqui, mas a porta está sempre aberta 💛"). *Interrompe*: resposta (pausa → IA), agendamento (cancela, `goal_reached`), opt-out. *Cap global*: máx. N novas cadências iniciadas/dia por clínica (default 20) — controla volume e risco de ban.

**E2. Reativação genérica** — mesmo motor, para cliente **sem procedimento com prazo** e `last_visit > 30 dias` (config). Sequência mais curta (default 3 passos).

**E3. Aniversário** — *Job diário 09:15*: clientes com `birth_date` hoje, não bloqueados. JobId `bday:{client_id}:{year}` (1 por ano). Template + opcional mídia (arte da clínica) + opcional benefício ("ganhe X% em qualquer procedimento este mês"). Nunca conta contra o cap de reativação, mas conta no rate horário.

### Grupo F — Crescimento e Receita

**F1. Preenchimento inteligente da agenda** — *Job diário.* (1) Varre agenda das **próximas 72h** e identifica buracos ≥ duração mínima de procedimento por profissional. (2) Monta pool de candidatos: clientes com retorno em atraso (E1-elegíveis) **ranqueados por score de inteligência** (quente primeiro), que já fizeram procedimento compatível com o profissional do buraco. (3) Envia para até `config.max_per_gap` (default 3) candidatos por buraco, escalonado (2º só se 1º não responder em 4h — evita overbooking): "abriu um horário {{dia}} às {{hora}} com a {{profissional}}, e lembrei de você — quer aproveitar?" + link. *Colisão*: se dois aceitam, IA do segundo oferece alternativa via tool de horários. *Elegibilidade individual*: mesmas exclusões do E1 + não ter recebido F1 nos últimos 14 dias.

**F2. Renovação de pacotes** — *Job diário.* Dois gatilhos independentes, mensagens distintas: (a) `sessions_remaining <= config.threshold` (default 2): "suas sessões estão acabando — que tal já garantir o próximo pacote?"; (b) `expires_at - hoje <= 7 dias` com sessões sobrando: "seu pacote vence dia {{data}} e você ainda tem {{n}} sessões — vamos agendar para não perder?". JobId por gatilho impede duplicata; renovação/agendamento cancela pendentes.

---

## 4. IA conversacional humanizada (Claude API)

### 4.1 Princípio arquitetural

A IA é **um agente com ferramentas** (tool use da Messages API, loop manual no worker), não um gerador de texto solto. Ela nunca inventa horário, preço ou agendamento: tudo que é fato vem de tool ou do contexto injetado; tudo que é ação passa por tool com validação server-side.

### 4.2 Pipeline de um turno

1. `q:inbound` normaliza a mensagem (áudio → transcrição é fase 2; v1 responde "me manda por texto?" configurável), acha/cria `conversation` e `client` (match por telefone; desconhecido = lead novo, cria ficha mínima e marca `source: whatsapp_inbound`).
2. **Debounce**: agenda job em `q:inbound-debounce` com delay 12s e jobId `turn:{conversation_id}`; cada nova mensagem do cliente re-agenda (remove + readd). Humanos mandam 3 mensagens picadas — a IA responde ao conjunto, como uma pessoa faria.
3. Roteamento: `conversation.mode == human`? → só notifica atendente, IA não responde. Cliente opted-out/bloqueado? → tratamento mínimo (§6.4). Senão → `q:ai`.
4. Worker de `q:ai` monta contexto (§4.3), chama Claude com tools (§4.4), roda o loop até `end_turn`, extrai o plano de resposta (§4.5), aplica humanização (§4.6) e enfileira balões em `q:outbound`.
5. Pós-turno: job em `q:analysis` (Haiku) classifica intenção/sentimento do turno → alimenta score e gatilhos de escalação assíncrona.

### 4.3 Contexto enviado ao modelo

Ordem pensada para **prompt caching** (estável → volátil; breakpoint `cache_control` no fim do bloco estável):

1. **System — bloco estável por clínica (cacheado, ~3–6K tokens)**: persona (§4.7); dados da clínica (nome, endereço, como chegar, horários); catálogo resumido de procedimentos com preços "a partir de", duração e restrições; políticas (cancelamento, sinal, formas de pagamento); regras duras do agente (nunca revelar ser sistema, nunca diagnosticar, nunca negociar preço fora da tabela, quando escalar); instruções de humanização e formato de saída.
2. **System — bloco volátil**: data/hora atual, dia da semana, "estamos dentro/fora do horário de atendimento".
3. **Primeiro user turn — contexto do cliente** (injetado como bloco de contexto): ficha resumida (nome/apelido, tags, últimos 3 procedimentos com datas, pacote ativo com saldo, total de visitas, classificação quente/morno/frio, observações da equipe marcadas como "visível para IA"); **agendamentos futuros**; **estado de automação ativa** com objetivo explícito (ex.: "esta conversa começou porque enviamos lembrete da consulta de amanhã 14h; objetivo: obter confirmação"); resumo da conversa anterior se houver (gerado por Haiku ao fechar conversas longas). **LGPD: a anamnese (dados de saúde) NUNCA entra no prompt** — a IA não precisa saber alergias para agendar; se o assunto surgir, é motivo de escalação (§4.9).
4. **Histórico da conversa**: últimas ~30 mensagens (ou resumo + últimas 10).

### 4.4 Ferramentas do agente

Todas com `input_schema` estrito, executadas pelo worker com **revalidação de permissão e de tenant** (tool nunca confia no modelo: `clinic_id` vem do job, não do input do modelo):

| Tool | Faz | Regras server-side |
|---|---|---|
| `consultar_horarios(procedimento, profissional?, periodo_preferido?, a_partir_de?)` | Retorna até 6 slots livres reais | Respeita agenda, salas, duração do procedimento, antecedência mínima |
| `agendar(client_id, procedimento, slot_id)` | Cria appointment `scheduled` | Lock otimista no slot (corrida com F1); dispara cadência A1–A3 e B1 |
| `reagendar(appointment_id, slot_id)` | Remarca | Version bump; dispara A4 |
| `cancelar_agendamento(appointment_id, motivo)` | Cancela | Dispara B3 |
| `confirmar_presenca(appointment_id)` | `confirmation_status = confirmed` | Cancela A2 pendente; dispara B1 |
| `enviar_link_agendamento()` | Retorna link público tokenizado da clínica | Só se toggle global "enviar links de agendamento" ativo |
| `registrar_interesse(nota)` | Anota lead/interesse no funil (cria card no kanban) | — |
| `registrar_opt_out(escopo)` | Marca opt-out (§6.4) | Cancela cadências |
| `escalar_para_humano(motivo, urgencia)` | §4.9 | Sempre disponível; encerra o turno da IA |
| `consultar_pacote(client_id)` | Saldo de sessões/validade | — |

O loop de tools roda com máx. 6 iterações; erro de tool retorna `is_error: true` e o modelo se recupera ("deixa eu confirmar isso e já te falo") — 2 erros seguidos → escala.

### 4.5 Formato de saída

Structured output (`output_config.format`, json_schema):
```json
{ "balloons": ["string"],            // 1 a 3 balões, cada um ≤ ~250 chars
  "internal_note": "string|null",    // nota para o inbox (não enviada)
  "confidence": "alta|media|baixa" } // baixa → vai para fila de aprovação se clínica em modo semi
```
Instruções no system: balões curtos como pessoa digitando; máx. 1 emoji por balão e nem sempre; nunca listas numeradas ou markdown; nunca assinar; variar aberturas (proibido começar toda resposta com "Oi {{nome}}!").

### 4.6 Técnicas de humanização (camada mecânica, fora do modelo)

- **Visto humanizado**: marca a conversa como lida (`chat/markMessageAsRead`) 2–8s após receber, antes de "digitar".
- **Delay de leitura + digitação**: espera `rand(3–10s)` (maior fora do horário comercial: 1–15min, simulando pessoa ocupada; configurável "responder fora do horário: sim/não/só urgências"), então `sendPresence composing` e envia com `delay = clamp(len(balão) × 60ms, 2s, 12s)` — usa o `delay` nativo do sendText.
- **Entre balões**: pausa `rand(1.5–4s)` com presença `composing` reativada.
- **Variação de fraseado**: templates de automação têm 3–5 variantes por passo (geradas por IA na configuração, editáveis pela dona) + placeholders; a escolha é rotativa por cliente (nunca a mesma variante duas vezes seguidas para o mesmo cliente). Respostas da IA já variam naturalmente.
- **Sem respostas instantâneas de madrugada**: inbound às 3h → responde a partir das `open - rand(0–40min)`... exceto se config "plantão 24h" ativa.
- **Interrupção pelo cliente**: se o cliente manda mensagem enquanto os balões da IA estão na fila (`q:outbound`), os balões não enviados são cancelados e um novo turno é disparado — evita o efeito "robô que continua falando por cima".

### 4.7 Persona configurável por clínica

Wizard de onboarding (5 min, linguagem leiga): nome da atendente virtual (ex.: "Ana"), tom (3 presets: "acolhedora e informal", "elegante e sóbria", "jovem e animada" — cada um vira um parágrafo de estilo no system), nível de emoji (nenhum/pouco/moderado), tratamento (você/senhora), saudações típicas da região, 10 FAQs com respostas da dona, frases proibidas, e "o que fazer se perguntarem se você é um robô" (default: **escalar para humano sem afirmar nem negar** — evita mentira explícita e o risco de exposição; a resposta de transição é "vou pedir para alguém da equipe te responder isso melhor, um instante 😊").

### 4.8 Inbox com takeover humano

- Inbox no app: lista de conversas com badges (`IA ativa`, `humano`, `aguardando humano`, `aprovação pendente`), transcript com autoria de cada mensagem (IA/automação/atendente X).
- **Takeover explícito**: botão "Assumir conversa" ou simplesmente digitar no inbox → `conversation.mode = human`, IA pausa imediatamente (inclusive turnos em voo: worker checa `mode` antes de enfileirar balões).
- **Takeover implícito**: mensagem `fromMe` enviada pelo celular (§1.2).
- **Devolução**: botão "Devolver para IA" (com campo opcional "contexto para a IA", injetado no próximo turno) ou auto-release após 6h (config) sem mensagem humana — com notificação "IA reassumiu a conversa com {{nome}}".

### 4.9 Escalação para humano

Gatilhos (tool `escalar_para_humano` instruída no system + classificador Haiku assíncrono como rede de segurança):
1. Pedido explícito ("quero falar com alguém", "me liga").
2. Irritação/frustração (sentimento negativo forte, caps, palavrões, "vou no Procon").
3. **Qualquer assunto clínico/médico**: dor, inchaço anormal, reação, alergia, medicamento, gravidez, "deu errado" — regra dura, sem exceção; a IA responde apenas acolhimento genérico sem opinião clínica ("vou passar agora para a equipe, eles te respondem já já") e escala com `urgencia: alta`.
4. Negociação de preço além da tabela/da alçada configurada (default: alçada zero).
5. Pergunta direta "é um robô?" (§4.7).
6. 2 falhas consecutivas de ferramenta ou `confidence: baixa` recorrente.

Efeito: `mode = waiting_human`, item destacado no topo do inbox + notificação push + (config) mensagem no WhatsApp pessoal da dona via instância da clínica ("⚠️ {{nome}} precisa de atendimento humano: {{motivo}}"). SLA visual: item fica vermelho após 15min (urgência alta) / 2h (normal) sem resposta. IA não responde mais nessa conversa até devolução.

---

## 5. Fila de Aprovações (human-in-the-loop)

**Modelo de 3 níveis por clínica**, configurável na tela de Automações com linguagem simples:

| Modo | Comportamento |
|---|---|
| **Supervisionado** (default nos primeiros 7 dias / até 50 mensagens aprovadas) | Toda mensagem *proativa* de automação e toda resposta da IA vai para a fila de aprovações antes do envio |
| **Semi-automático** | Proativas de template fixo (lembretes A1–A3, aniversário, pré-cuidados) enviam direto; vão para aprovação: passos de reativação (E1/E2), preenchimento de agenda (F1), renovação (F2), respostas da IA com `confidence: baixa`, e qualquer mensagem contendo valores em R$ |
| **Autônomo** | Tudo direto; aprovação só para: primeira mensagem de campanha em massa (aprova a amostra, o lote segue), mensagens com preço/desconto (opcional), conteúdo sinalizado pelo classificador |

**Exceção estrutural**: mensagens **time-critical** (lembrete 45min, respostas B1–B3 dentro de conversa) **nunca** entram na fila — ou saem do template fixo aprovado previamente, ou não saem. Aprovação com atraso mataria a utilidade.

Além do modo global, cada automação tem o toggle individual `requer aprovação`.

**Mecânica**: `approval_items (id, clinic_id, automation_run_id?, conversation_id?, payload_balloons, context_preview, created_at, expires_at, status)`. UI: card com foto/nome do cliente, motivo do envio ("Reativação — passo 3 de 7"), preview dos balões, botões **Aprovar / Editar e aprovar / Descartar**, e "Aprovar todos deste tipo". Aprovado → `q:outbound` (edição fica registrada e alimenta ajuste de template). Expiração: proativas de cadência expiram em 24h (o passo é pulado e a cadência segue o calendário — não empilha atraso); badge de contagem no menu (como no Vittax) + card no dashboard ("5 aprovações pendentes").

---

## 6. Anti-banimento

### 6.1 Aquecimento de número
`warmup_started_at` na instância define o `daily_send_cap` **de mensagens proativas** (reativas a inbound não contam para o cap, contam para o rate horário):

| Idade do número na plataforma | Cap diário proativo | Reativação em massa |
|---|---|---|
| Dias 1–7 | 20 | bloqueada |
| Dias 8–14 | 50 | bloqueada |
| Dias 15–30 | 100 | máx. 10 novas cadências/dia |
| > 30 dias | 250 (config, teto 400) | cap configurado (default 20/dia) |

Número já antigo da clínica (usado manualmente há anos) pode ter warmup encurtado pela dona com aviso de risco. Durante warmup, priorização na fila: time-critical > reativas > confirmações > resto; excedente rola para o dia seguinte.

### 6.2 Rate limiting e jitter
- Token bucket em Redis por instância: **máx. 3 envios/min e 40/h** (proativas; reativas têm bucket próprio 10/min — conversa real é rápida).
- Jitter obrigatório entre proativas consecutivas: `rand(45–180s)`.
- Fila `q:outbound` com concorrência 1 por instância garante ordem e cadência.
- Watchdog: taxa de `DELIVERY_ACK` < 70% na última hora, ou 5 envios seguidos sem ack → **pausa automática de envios proativos** + alerta ("possível problema no seu número").

### 6.3 Higiene de conteúdo e comportamento
- Variantes de template (§4.6) — nunca enviar texto idêntico em massa.
- Links sempre do domínio próprio da clínica na plataforma (`agenda.suaclinica.com.br/...` ou subdomínio do SaaS), nunca encurtadores.
- Proporção saudável: motor monitora ratio proativas/reativas por instância; > 85% proativas por 7 dias → recomendação na UI de reduzir volume.
- Nunca enviar para número que jamais interagiu E não é cliente cadastrado (sem cold list importada — recusa de produto, protege o SaaS inteiro).

### 6.4 Opt-out e bloqueio
- **Detecção**: keywords (SAIR, PARAR, "não quero mais receber", "me tira da lista") + intenção detectada pela IA/classificador. Tool `registrar_opt_out`.
- **Efeito**: `clients.opted_out_at` setado, todas as cadências canceladas, 1 única mensagem de confirmação ("Claro! Não vou mais te mandar mensagens. Se precisar, é só chamar 💛") e silêncio total proativo. Inbound posterior do cliente reativa apenas atendimento reativo (não as cadências — reativação exige ação manual da dona com confirmação "o cliente pediu para voltar?").
- **Flag "Bloqueado para automações"** (toggle na ficha, como no Vittax): bloqueia proativas; IA continua respondendo inbound normalmente. Diferença semântica: opt-out é vontade do cliente (auditável, LGPD), bloqueio é decisão operacional da clínica.
- Consumidor `q:outbound` é a **última linha de defesa**: recheca opt-out/bloqueio/desconexão/cap em todo envio.

### 6.5 Monitoramento de desconexão
§1.1 — acrescido de: 3 desconexões em 24h → alerta reforçado + sugestão na UI ("mantenha o celular carregado e conectado"); evento de logout/ban detectado (`CONNECTION_UPDATE` com status de logout) → status `banned`, congela tudo, orienta a dona no fluxo de recuperação/troca de número (instância nova herda clientes e cadências pausadas).

---

## 7. Score de engajamento WhatsApp (componente 0–25 do score de inteligência)

Calculado por job semanal (`q:daily`) + recálculo incremental em eventos-chave. Composição:

| Sub-métrica | Pontos | Cálculo |
|---|---|---|
| **Taxa de resposta** | 0–10 | % de mensagens proativas com resposta em ≤72h, janela de 12 meses com decaimento (peso ×2 nos últimos 90 dias). ≥60%→10, 40–59%→7, 20–39%→4, 1–19%→2, 0%→0 |
| **Velocidade de resposta** | 0–4 | Mediana do tempo de resposta: <1h→4, <6h→3, <24h→2, <72h→1 |
| **Teor/sentimento das conversas (LLM)** | 0–8 | Classificação mensal via Haiku (Batches API): analisa as conversas dos últimos 90 dias e emite structured output `{engajamento: alto|medio|baixo, sentimento: positivo|neutro|negativo, sinais_compra: bool, sinais_atrito: bool}`. alto/positivo→8 … baixo/negativo→0; `sinais_compra` garante piso 5 |
| **Sinais comportamentais** | 0–3 | +1 confirma consultas via WhatsApp com regularidade; +1 iniciou conversa espontânea nos últimos 90 dias; +1 respondeu a reativação/preenchimento com agendamento |
| **Trava** | — | Opt-out ou 3+ proativas ignoradas seguidas nos últimos 60 dias → score capado em 5; opt-out → 0 |

Guardado em `engagement_scores (client_id, score, breakdown jsonb, computed_at)` — o breakdown alimenta o card "Breakdown do Score" da tela Inteligência e a "Ação Sugerida" (gerada junto, no mesmo batch: 1 frase acionável por cliente do tipo "responde rápido mas não agenda há 90 dias — oferta direta de horário tende a converter").

---

## 8. Custo estimado de IA por clínica/mês

Premissas de clínica típica: ~600 clientes ativos, ~1.500 mensagens de automação/mês, ~700 turnos de conversa com IA/mês (respostas a lembretes, reativação, leads), ~900 classificações auxiliares, score mensal de 600 clientes.

| Tarefa | Modelo sugerido | Preço (in/out por MTok) | Consumo típico | Custo/mês |
|---|---|---|---|---|
| **Agente conversacional** (turnos com tools) | `claude-opus-5` (recomendado — melhor naturalidade e uso de ferramentas; adaptive thinking, `effort: low/medium`) | $5 / $25 | 700 turnos × (~1,2K in não-cacheado + ~4K in cache-read a 0,1× + ~350 out, incl. tool loop ≈ 2 chamadas/turno) | **~US$ 12–18** |
| — alternativa econômica | `claude-sonnet-5` | $3 / $15 (intro $2/$10 até 31/08/26) | idem | ~US$ 6–10 |
| **Classificação** (intenção, sentimento, opt-out, roteamento de feedback) | `claude-haiku-4-5` | $1 / $5 | 900 chamadas × ~800 in + 100 out | **~US$ 1–2** |
| **Score de engajamento + ação sugerida** | `claude-haiku-4-5` via **Batches API (−50%)** | $0,50 / $2,50 efetivo | 600 clientes × ~2,5K in + 200 out | **~US$ 1** |
| **Geração de variantes de template** (setup + eventual) | `claude-haiku-4-5` | — | marginal | <US$ 0,50 |
| **Resumo de conversas longas** | `claude-haiku-4-5` | — | ~200/mês | <US$ 0,50 |

**Ordem de grandeza: US$ 15–25/clínica/mês (~R$ 80–140) no perfil Opus, ou US$ 8–14 (~R$ 45–80) no perfil Sonnet** — em ambos os casos <5% de um plano SaaS de R$ 300–500/mês. Alavancas que sustentam isso: **prompt caching** do bloco de persona+catálogo (leitura a 0,1× — o system de ~5K tokens custa quase nada a partir do 2º turno; mínimo cacheável de 512 tokens no Opus 5 é folgado), Batches para tudo que não é tempo real, Haiku para tudo que não é a conversa em si, e `effort: low` no agente para turnos triviais (confirmação seca) com `medium` quando há negociação de agenda. Recomendo instrumentar `usage` por clínica desde o dia 1 (tabela `ai_usage`) — vira tanto controle de custo quanto insumo para precificar planos por volume.

---

## 9. Modelo de dados mínimo referenciado neste design

`whatsapp_instances`, `conversations (clinic_id, client_id, mode ENUM(ai|human|waiting_human), last_inbound_at, last_outbound_at)`, `messages (direction, source, status, evolution_key_id)`, `automation_definitions`, `automation_runs`, `cadence_states`, `approval_items`, `engagement_scores`, `ai_usage`, `clients (+ opted_out_at, automation_blocked bool)`, `appointments (+ version, confirmation_status)`, `procedures (+ return_days, retouch_days, pre_care_text, post_care_text, post_sale_cadence jsonb)`, `packages (+ sessions_total/used, expires_at)`. Todas com `clinic_id` + índice composto e RLS/escopo de query obrigatório na camada de acesso.

## 10. Observações de risco (para registro, sem alterar decisões)

(a) Evolution API é engenharia reversa do WhatsApp — o design acima trata ban como evento operacional esperado (warmup, caps, watchdog, fluxo de troca de número), não como exceção. (b) LGPD: anamnese fora dos prompts, opt-out auditável com timestamp, logs de conversa com retenção configurável e base legal documentada por clínica; dados de saúde ficam restritos ao módulo de ficha, cifrados em repouso. (c) A instrução de nunca se revelar como sistema foi implementada com a válvula "pergunta direta → escala para humano", que preserva a experiência sem colocar uma negação explícita na boca do agente.