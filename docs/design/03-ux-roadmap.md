# Design UX + Roadmap — Sistema de Gestão para Clínicas de Estética (SaaS multi-tenant, inspirado no Vittax)

---

## 1. MAPA DE NAVEGAÇÃO

### 1.1 Princípios aplicados sobre a sidebar do Vittax

O Vittax tem 17 itens soltos na lateral — para uma recepcionista sem perfil técnico isso vira "onde fica aquilo?". Melhorias aplicadas:

- **Agrupamento por tarefa mental**, não por módulo técnico. Seções nomeadas pelo que a pessoa quer fazer.
- **Inbox do WhatsApp promovido a item de 1º nível** (no Vittax é um botão na barra superior). É onde a equipe vive; merece lugar fixo com badge de não-lidas.
- **Procedimentos + Pacotes fundidos em "Serviços"** (abas internas). São o mesmo conceito na cabeça da dona: "o que eu vendo".
- **Comissões vira aba dentro de Financeiro** (o Vittax duplica: aba E item de menu). Um único lugar, com atalho profundo `/financeiro/comissoes` para quem favoritar.
- **Badges numéricos** apenas onde há ação pendente: Aprovações, WhatsApp, Agenda (confirmações do dia).

### 1.2 Sidebar (desktop)

```
[Logo da clínica]  [Seletor de clínica ▾]     ← multi-tenant: só aparece se o usuário tem >1 clínica

MEU DIA
  ● Início                      (Dashboard)
  ● Agenda                      badge: "3 a confirmar"
  ● WhatsApp                    badge: não-lidas / "2 precisam de você"
  ● Aprovações                  badge: fila pendente

CLIENTES
  ● Clientes
  ● Funil de Vendas             (fase 3)
  ● Inteligência                (fase 2)

VENDAS
  ● Orçamentos                  (fase 2)
  ● Termos                      (fase 2)
  ● Serviços                    abas: Procedimentos | Pacotes
  ● Estoque                     (fase 3) badge: itens abaixo do mínimo

GESTÃO
  ● Automações
  ● Financeiro                  abas: Visão geral | A receber | Despesas | Pagamentos | Comissões
  ● Relatórios

(rodapé)
  ● Equipe
  ● Configurações
  ● Ajuda                       (WhatsApp do suporte + central de artigos)
```

**Barra superior:** busca global (cliente por nome/telefone — atalho `/`), pílula de status do WhatsApp (● verde "Conectado" / ● vermelho "Desconectado — reconectar" clicável), sino de notificações, avatar do usuário.

### 1.3 Mobile (dona no celular — PWA)

Bottom nav com 5 itens: **Início · Agenda · WhatsApp · Aprovações · Mais** (Mais abre o restante em lista). A dona usa o celular para: ver o dia, aprovar mensagens, responder conversa, olhar faturamento. Essas quatro coisas estão a 1 toque.

---

## 2. SPEC DAS TELAS PRINCIPAIS

Formato de cada spec: **Mostra / Ações primárias / Estado vazio / Como fica autoexplicativa**.

### 2.1 Início (Dashboard — resumo diário)

**Mostra:**
- Saudação contextual: *"Bom dia, Fernanda! quarta-feira, 20 de agosto"*.
- **Faixa de pendências acionáveis** (só aparece se houver): *"⚠ 5 mensagens aguardando sua aprovação → Revisar agora"*, *"WhatsApp desconectado desde 9h → Reconectar"*.
- **Cards HOJE** (todos clicáveis, filtram a Agenda): Agendamentos (12) · Confirmados (8) · Aguardando confirmação (3) · Faltas (1).
- **Agenda de hoje** em lista compacta: hora, cliente, procedimento, profissional, chip de status colorido e botões inline `[Confirmar] [Compareceu] [Faltou]` conforme o estado — a recepção resolve o dia sem sair do Dashboard.
- **"O que as automações fizeram hoje"**: *"14 lembretes enviados · 6 clientes confirmaram sozinhos · 1 falta em recuperação"* — este bloco vende o valor do produto diariamente e cria confiança na IA.
- **Mês atual**: faturamento, atendimentos, novos clientes, com seta e % vs mês anterior.

**Ações primárias:** `+ Agendamento` (botão global no header, presente em todas as telas), Revisar aprovações.

**Estado vazio (clínica recém-implantada):** o Dashboard vira o **checklist de implantação** com progresso: *"Falta pouco! ✅ WhatsApp conectado · ⬜ Cadastre seus procedimentos (2 min) · ⬜ Importe seus clientes · ⬜ Ative a confirmação automática"*. Cada item leva direto à ação. O checklist só some quando completo.

**Autoexplicativa:** nenhum número sem rótulo em linguagem de dona de clínica ("A confirmar", nunca "Pending"). Cards com tooltip "?" de uma frase.

### 2.2 Agenda

**Visões:** **Dia por profissional** (colunas lado a lado — visão padrão da recepção), **Semana** (um profissional por vez), **Lista** (padrão no celular). Filtros persistentes por profissional / sala / procedimento. Navegação: `← Hoje →` + mini-calendário.

**Criação rápida (requisito duro — 15 segundos):** clique/toque em slot vazio → popover:
1. Cliente: busca por nome/telefone; se não existe, `+ Nova cliente` inline pedindo **só nome + WhatsApp** (o resto se completa depois — cadastro nunca trava agendamento).
2. Procedimento: seleção que **auto-preenche duração e valor** (bloco do slot já se redimensiona).
3. Profissional (pré-selecionado pela coluna clicada), sala opcional, observação opcional.
4. `[Agendar]`. Toast: *"Agendado! O lembrete automático será enviado amanhã às 14h."* — ensina a automação pelo uso.

**Máquina de estados (botões de 1 clique no card/popover):**

```
AGENDADO ──confirmação(cliente ou 1-clique)──▶ CONFIRMADO ──▶ COMPARECEU
   │                                              │              └─ dispara: pós-atendimento, retoque
   │                                              ├──▶ FALTOU ── dispara: recuperação de falta
   ├──▶ CANCELADO ── dispara: msg de cancelamento │
   └──▶ REAGENDADO ─▶ novo AGENDADO (vinculado)  ─┘
```

- Card **Agendado** mostra `[Confirmar]` `[💬]` (abre a conversa no Inbox).
- No dia do atendimento, após o horário, mostra `[Compareceu]` `[Faltou]` em destaque; no fim do dia, faixa: *"3 atendimentos de hoje sem desfecho — marque Compareceu ou Faltou para as automações funcionarem"* (isso é crítico: pós-atendimento, comissão e financeiro dependem do Compareceu).
- Marcar **Faltou** → toast: *"Vou tentar reagendar a Maria automaticamente. A mensagem está em Aprovações."*
- **Drag & drop** para reagendar → dialog: *"Avisar a Maria do novo horário?"* `[Enviar mensagem]` `[Não avisar]`.

**Indicadores no card:** ✓ lembrete enviado (com horário no hover) · ✓✓ cliente confirmou via WhatsApp · 📄 termo assinado · 📦 "sessão 5/10" · ⚠ alerta de anamnese (alergia).

**Estado vazio:** *"Sua agenda está pronta. Toque em qualquer horário para criar o primeiro agendamento."* + botão "Importar agenda atual".

### 2.3 Clientes (lista) e Ficha do Cliente

**Lista:** cards-resumo Total / Ativas / Em risco / Leads; filtros de 1 clique (Todas, Ativas, Em risco, Leads, Com pacote ativo, Bloqueadas para automações); colunas: cliente, WhatsApp, último procedimento, visitas, ticket médio, retorno previsto (badge verde "dentro do prazo" / vermelho "atrasado 12 dias"), status. Busca instantânea. `+ Nova cliente` e `Importar planilha` sempre visíveis.

**Ficha (drawer largo sobre a lista, com URL própria — funciona também aberta pela Agenda e pelo Inbox):**

**Header fixo:** iniciais/foto, nome + badges (VIP · Em risco · Lead), **alerta clínico vermelho vindo da anamnese visível em TODAS as abas** (*"⚠ Alergia: lidocaína"*), telefone com botão 💬, toggle **"Bloqueada para automações"** com explicação (*"Nenhuma mensagem automática será enviada. Conversas manuais continuam funcionando."*). Chips de ação rápida: `[Agendar]` `[Mensagem]` `[Orçamento]` `[Enviar termo]` `[Registrar foto]`.

**Abas:**
1. **Dados** — cadastro completo, nome social, fonte (indicação/Instagram/…), endereço, status do consentimento LGPD (data do aceite, versão do termo).
2. **Anamnese** — formulário gerado a partir de **modelos gerenciáveis por tipo de clínica** (Configurações → Modelos de anamnese): alergias, medicamentos, doenças crônicas, condições (gestante, lactante, marca-passo, tabagismo, etilismo, exposição solar, uso de ácidos), histórico cirúrgico, problemas de pele. Perguntas objetivas sim/não + campo de detalhe. Respostas "de risco" viram o alerta do header. *Melhoria:* botão **"Enviar anamnese para a cliente preencher"** — gera link público mobile-first; a resposta entra na ficha marcada "preenchida pela cliente em 20/08".
3. **Evolução** — linha do tempo (data · profissional · descrição · procedimento vinculado); editor rápido "Registrar evolução de hoje" pré-preenchido com o atendimento do dia.
4. **Fotos** — grade agrupada por procedimento/data; tipo Antes/Durante/Depois; **comparador lado a lado** (antes ⇄ depois); upload pela câmera do celular; registro de consentimento de imagem no primeiro upload.
5. **Histórico** — Indicador de Retorno em destaque (badge "dentro do prazo" / "atrasada"), última consulta, procedimento, prazo de retorno, data prevista, nº de agendamentos, total investido; botão **"Inserir histórico"** para lançar atendimentos antigos pré-sistema (alimenta o score da Inteligência desde o dia 1).
6. **Pacotes** — *"5 de 12 sessões usadas — 7 restantes"* com barra de progresso, validade, `[Registrar sessão]` `[Atribuir pacote]`, alerta de vencimento próximo.
7. **Timeline** — tudo mesclado e filtrável: agendamentos e mudanças de status, mensagens (resumo, com link para o Inbox), termos enviados/assinados, orçamentos, pagamentos, fotos. É a resposta para "o que aconteceu com essa cliente?".

**Estados vazios por aba:** Anamnese → *"Ainda sem anamnese. Preencha agora (leva 2 min) ou envie o link para a cliente responder pelo celular."* Fotos → *"Registre fotos de antes e depois — elas valorizam seus resultados e protegem a clínica."*

### 2.4 Automações

**Estrutura:** agrupadas por fase do funil, exatamente como o inventário (Confirmação de Agenda · Respostas Automáticas · Recuperação de Faltas · Pós-Atendimento · Reativação e Base · Crescimento e Receita).

**Topo da tela (configuração global):**
- **Números conectados** (nunca "instâncias"): cartão por número com status ● Conectado / ● Desconectado, badge "Principal", `+ Adicionar número` (QR).
- Toggle global "Incluir link de agendamento nas mensagens".
- **Horário de envio** (*"só enviar entre 8h e 19h"*), **limite diário de mensagens** (throttle anti-ban, default 150/dia com explicação), botão **"Pausar todas as automações"** (modo férias).

**Cada automação é um card:** nome + **frase de uma linha no lugar de jargão** (*"Lembrete 24h antes — envia uma mensagem carinhosa um dia antes do horário"*), toggle liga/desliga, estatística do mês (*"87 enviadas · 61 responderam"*), botão `Editar`.

**Painel Editar:**
- **Mensagem** com variáveis inseridas por **chips clicáveis** (`{{nome}} {{clinica}} {{procedimento}} {{horario}} {{profissional}} {{link_agendamento}}`) — a usuária nunca digita chaves.
- **Preview ao vivo com dados de exemplo reais da clínica** (*"Oi Maria! Passando pra lembrar do seu horário de Limpeza de Pele amanhã às 14h com a Dra. Paula 💚 Posso confirmar?"*), atualiza a cada tecla.
- **Timing em linguagem natural**: *"Enviar [24] horas antes"*, *"Reforço [X] dias depois"*. Sequências (reativação) mostradas como linha do tempo visual: Dia 1 → Dia 3 → Dia 13 → Dia 25 → Dia 40, cada ponto editável, `+ adicionar mensagem` até 7.
- **Modo de envio por automação**: `( ) Enviar automaticamente  (•) Revisar antes de enviar` — default "revisar" para toda automação recém-ligada.
- **`[Enviar teste para meu WhatsApp]`** — o jeito mais eficaz de uma usuária não-técnica confiar no sistema.
- Configs específicas onde aplicável: Confirmação do Retoque (por procedimento), cadência pós-venda por procedimento (em dias), Coleta de Feedback (Xh depois; positivo → link do Google Meu Negócio), Reativação por procedimento (usa o prazo de retorno do cadastro do procedimento; genérica de 30 dias para cliente sem procedimento; **ignora quem já tem agendamento futuro** — regra exibida como nota fixa no painel), Renovação de Pacote (dispara com N sessões restantes OU 7 dias para vencer, mensagens distintas por gatilho), Preenchimento Inteligente (olha 72h à frente, cruza buracos × clientes com retorno vencido, roda diariamente em horário comercial).

**Estado vazio:** não existe — as automações vêm **pré-configuradas com templates prontos em pt-BR**, desligadas. O trabalho da usuária é ler, ajustar o tom e ligar.

### 2.5 Inbox WhatsApp

**Layout 3 colunas (desktop):**
1. **Conversas**: filtros Todas · 🤖 IA respondendo · 👤 Com atendente · 🔴 Precisam de você; busca; cada item mostra nome, prévia, horário, chip do modo.
2. **Conversa**: bolhas estilo WhatsApp; mensagens geradas pela IA têm um ícone ✨ discreto **visível só para a equipe** (o cliente nunca vê distinção); mensagens de automação identificam a origem no hover (*"enviada por: Lembrete 24h"*).
3. **Painel do cliente**: mini-ficha (próximo agendamento, último procedimento, pacote, score da Inteligência, alerta de anamnese), atalhos `[Agendar]` `[Abrir ficha]`.

**Takeover (regra central):**
- Banner no topo da conversa indica quem está no controle: *"✨ A IA está respondendo esta conversa"* + botão **`[Assumir conversa]`**.
- Assumiu → IA pausa **naquela conversa**; banner vira *"Você está no controle. A IA não vai responder."* + `[Devolver para a IA]`. Auto-devolução configurável (ex.: após 1h sem atividade humana, com aviso).
- Digitar qualquer mensagem manualmente também pausa a IA automaticamente (comportamento óbvio > botão).
- **Detecção de handoff**: quando a IA identifica irritação, assunto clínico delicado, pedido explícito de humano ou baixa confiança, marca a conversa 🔴 *"Precisa de você — cliente pediu falar com atendente"*, para de responder e notifica (push/badge).
- Notas internas (visíveis só para a equipe) e respostas prontas (`/`).

**Estado vazio:** *"Suas conversas do WhatsApp aparecerão aqui assim que o número estiver conectado."* + botão de conexão.

### 2.6 Aprovações (human-in-the-loop)

**Mostra:** fila de mensagens geradas pelas automações/IA aguardando revisão, agrupável por automação. Cada card: cliente (link para ficha), automação de origem, **mensagem proposta editável inline**, contexto de 1 linha (*"Agendamento: amanhã 14h · Última visita: 12/06"*), e para mensagens sensíveis a tempo (lembrete 45min) um **countdown**: *"expira em 22 min"* — expirou, sai da fila e fica registrado como "não enviada (expirou)".

**Ações:** `[Aprovar e enviar]` · `[Editar → Aprovar]` · `[Rejeitar]` (com motivo opcional que alimenta ajuste de prompt); **seleção múltipla + `[Aprovar selecionadas]`**; "Aprovar todas desta automação".

**Melhoria de graduação de confiança:** após 30 aprovações consecutivas sem edição numa automação, o sistema sugere: *"Você aprovou 30 lembretes sem mudar nada. Quer que eles passem a ser enviados automaticamente?"* `[Sim, automatizar]` `[Continuar revisando]`. É o caminho natural de adoção para quem tem medo de robô falando com cliente.

**Estado vazio:** *"Tudo em dia! Quando uma automação preparar uma mensagem que exige sua revisão, ela aparece aqui."*

### 2.7 Inteligência (ranking de clientes)

**Mostra:** lista rankeada por **score 0–100**, busca e filtros por classificação: 🟢 Melhor Perfil · 🟡 Atenção · 🟠 Alto risco · 🔴 Não retornou. Linha: cliente, score com anel de progresso, classificação, última visita, total investido.

**Card expandido:**
- **Breakdown do Score** com 4 barras de 0–25: Recência · Frequência · Valor investido · Engajamento no WhatsApp — cada uma com frase explicativa (*"Recência 8/25 — última visita há 94 dias"*). Transparência = confiança.
- Dados: visitas, total investido, última visita, intervalo médio entre visitas.
- Procedimentos favoritos.
- **Ação Sugerida** (gerada por Claude com os dados reais): *"Cliente VIP e recorrente. Ofereça o programa de fidelidade e antecipe o agendamento do retorno."* + botão **`[Preparar mensagem]`** → Claude redige a abordagem no tom da clínica → **cai em Aprovações** (nunca dispara direto daqui).

**Estado vazio:** *"O ranking é calculado com o histórico de visitas, gastos e conversas. Registre atendimentos (ou importe o histórico antigo na ficha) para ver seus melhores clientes aqui."*

### 2.8 Termos de Consentimento

**Abas:** Modelos · Enviados · Contratos importados (fase 3).

**Modelos:** editor de texto rico com **chips de variáveis** (`{{nome}} {{cpf}} {{telefone}} {{email}} {{endereco}} {{valor}} {{procedimento}} {{clinica}} {{data}}`), importação de .docx (fase 3), preview lado a lado preenchido com dados de exemplo. Modelos prontos por especialidade no primeiro acesso (botox, preenchimento, laser…), marcados *"revise com seu responsável técnico antes de usar"*.

**Fluxo Gerar e Enviar:** `[Gerar e enviar]` → escolher cliente + procedimento + valor → preview do termo final preenchido → `[Enviar pelo WhatsApp]` → mensagem humanizada com link seguro.

**Enviados (acompanhamento):** tabela com trilha de status **Enviado → Visualizado → Assinado** (timestamps), `[Reenviar lembrete]` para pendentes >48h (ou automático, configurável), `[Baixar PDF]` do assinado. Assinado → PDF com página de auditoria anexada, arquivado na aba Timeline/Dados da ficha.

**Estado vazio (Modelos):** *"Crie seu primeiro modelo de termo — ou comece por um dos prontos abaixo. Na hora de enviar, o sistema preenche nome, CPF e procedimento sozinho."*

### 2.9 Orçamentos

**Mostra:** lista com status Rascunho · Enviado · Visualizado · Aceito · Recusado · Expirado; valor; validade.

**Criação:** cliente → itens (procedimentos/pacotes do catálogo, preço editável, desconto por item ou total) → condições de pagamento (à vista/parcelado) → validade (default 7 dias) → `[Enviar pelo WhatsApp]` (link para página pública com logo da clínica, itens, total e botão **"Aceitar orçamento"**) ou `[Baixar PDF]`.

**Conversão:** aceito (pelo cliente no link, ou manualmente `[Marcar como aceito]`) → **`[Converter em venda]`**: cria conta a receber no Financeiro, sugere agendar na hora (*"Quer já marcar o horário da Maria?"*), atribui pacote se houver, e (fase 3) reserva baixa de estoque.

**Estado vazio:** *"Crie seu primeiro orçamento para enviar um proposta bonita pelo WhatsApp — e saiba quando a cliente visualizou."*

### 2.10 Financeiro

**Cards:** Recebido · A Receber · Despesas · Saldo, com % vs período anterior; seletor de período.

**Abas:**
- **Visão geral:** Receitas vs Despesas (barras mensais), Por Categoria (donut: procedimentos, pacotes, materiais…). Linguagem: "entrou / vai entrar / saiu".
- **Contas a Receber:** geradas **automaticamente ao marcar Compareceu** (valor do procedimento/parcela do pacote) ou por orçamento aceito; botão `[Confirmar recebimento]` com método (Pix, dinheiro, cartão 1–15x); parcelamentos com cronograma.
- **Despesas:** lançamento rápido, categorias, recorrência ("aluguel, todo dia 5").
- **Pagamentos:** registros por método; para cartão, aplica **taxas por parcela (1x–15x)** configuradas + toggle *"Esta clínica antecipa recebíveis?"* com taxas de antecipação — mostra valor bruto, taxa e **líquido real**.
- **Comissões:** ver 2.12.

**Estado vazio:** *"Seu financeiro se preenche sozinho: quando você marcar 'Compareceu' na agenda, o valor do atendimento entra aqui como 'a receber'."*

### 2.11 Estoque

**Mostra:** faixa de alerta no topo (*"⚠ 3 itens abaixo do mínimo"*), tabela: item, quantidade, **estoque mínimo**, custo unitário, badge vermelho "Repor" quando qtd ≤ mínimo. Botões rápidos `+ / −` na linha (com motivo: compra, uso, perda, ajuste).

**Vínculo com vendas (fase 3):** no cadastro do procedimento, "insumos consumidos por sessão" (ex.: Botox 50U → 1 frasco toxina + 1 agulha 30G); marcar Compareceu debita automaticamente e lança o custo no Financeiro (categoria materiais). Histórico de movimentações por item.

**Estado vazio:** *"Cadastre os insumos que você mais usa (ex.: Ácido Hialurônico 1ml, Agulha 30G) e defina o mínimo — o sistema avisa quando estiver acabando."*

### 2.12 Comissões (aba do Financeiro)

**Regras:** `+ Nova regra`: profissional + procedimento (ou "todos") + % sobre o valor **ou** valor fixo por sessão; regra específica vence a geral.

**Apuração:** por período, calcula sobre atendimentos **Compareceu com recebimento confirmado** (configurável: "sobre realizado" vs "sobre recebido" — default recebido, com explicação de uma linha). Extrato por profissional: lista de atendimentos, valor-base, %, comissão. `[Marcar como pago]` → gera despesa no Financeiro automaticamente. Exporta PDF do extrato para a funcionária.

**Estado vazio:** *"Crie a primeira regra de comissão (ex.: Paula recebe 30% de cada limpeza de pele). O cálculo do mês sai sozinho a partir da agenda."*

### 2.13 Demais telas (specs curtas)

- **Funil de Vendas (fase 3):** Kanban com etapas editáveis (default: Novo lead → Em conversa → Orçamento enviado → Agendou avaliação → Cliente); card = lead com fonte, valor potencial, último contato; arrastar entre colunas; lead criado automaticamente de conversa nova no WhatsApp de número desconhecido; conversão para Cliente ao primeiro agendamento. Vazio: *"Leads que chegarem pelo WhatsApp entram aqui sozinhos."*
- **Relatórios:** faturamento, taxa de conversão, ticket médio, total de clientes; "Procedimentos Mais Vendidos" (barras); "Distribuição de Status" (donut); **lista de reativações** com data prevista de retorno e `[Ver cliente]`; comparativos por período; export CSV/PDF.
- **Serviços → Procedimentos:** nome, duração, preço, categoria, **prazo de retorno (dias)** (motor da reativação — ex.: botox 120/180), retoque (sim/não + dias), pré-cuidados (texto que a automação envia), cadência pós-venda (dias), insumos (fase 3). Vazio: *"Cadastre seu primeiro procedimento para agendar em segundos — a duração e o preço já entram sozinhos na agenda."*
- **Serviços → Pacotes:** nome, procedimento vinculado, nº de sessões, validade (dias), preço; usados na ficha e na Renovação.
- **Equipe:** convites por e-mail/WhatsApp; **papéis prontos, sem matriz de permissões**: Administradora (tudo), Recepção (agenda, clientes, inbox, aprovações; sem financeiro), Profissional (própria agenda, evolução/fotos das suas clientes; sem valores). Cada papel com descrição de uma frase.
- **Configurações:** dados da clínica (logo, endereço, horários, salas), WhatsApp (números, QR, reconexão), **IA & Tom de voz** (persona: nome da "atendente", tom carinhoso/profissional/descontraído, o que a IA pode e não pode fazer — ex.: "nunca informar preço de cirurgia", instruções livres), Modelos de anamnese, LGPD (texto de consentimento, exportar dados da cliente, eliminar cliente com anonimização), Backup (status do backup diário, download de export), Assinatura do plano SaaS.

---

## 3. FLUXO DO CLIENTE FINAL (paciente)

Tudo mobile-first, com a marca da clínica (logo/cores), **nunca** a marca do sistema — reforça a percepção de atendimento humano e pessoal.

### 3.1 Assinatura de termo pelo WhatsApp

1. Recebe mensagem humanizada: *"Oi Maria! Pra gente deixar tudo certinho pro seu procedimento de sexta, preparei seu termo de consentimento. É rapidinho: [link]"*.
2. Abre o link (token único, expira em 7 dias, uso único): página com logo da clínica → **verificação leve de identidade** (LGPD: o termo contém CPF e dados de saúde; quem intercepta o link não pode ver): *"Confirme sua data de nascimento"* (3 tentativas, depois bloqueia e avisa a clínica).
3. Termo renderizado completo, com os dados preenchidos; **scroll até o fim habilita** o rodapé fixo.
4. Checkbox *"Li e concordo com o termo acima"* → assinatura: **desenhar na tela** (canvas) ou **digitar o nome completo** (renderizado em fonte manuscrita) — oferecer as duas; dedo em tela pequena frustra.
5. `[Assinar]` → captura: IP, user-agent, timestamp servidor, geolocalização aproximada (se permitida), **hash SHA-256 do conteúdo exato do termo**, e trilha de eventos (link aberto → identidade verificada → rolou até o fim → assinou).
6. Confirmação: *"Tudo certo, Maria! 💚 Você vai receber uma cópia aqui no WhatsApp."* → sistema envia o **PDF final com página de auditoria** (eventos, hash, IP, data/hora) no WhatsApp e arquiva na ficha.

### 3.2 Agendamento/reagendamento público

- **Link personalizado** (token da cliente, embutido nos lembretes e no preenchimento inteligente): abre já saudando pelo nome; **reagendamento** mostra o horário atual → *"Escolher novo horário"* → grade de slots reais (respeitando duração do procedimento, agenda do profissional e antecedência mínima configurável) → confirma → agenda atualiza, recepção é notificada, cadência de confirmação reinicia.
- **Link genérico da clínica** (bio do Instagram): escolhe procedimento → profissional (ou "tanto faz") → slot → nome + WhatsApp → entra como **"Pré-agendado"** para a recepção aprovar (configurável para confirmação direta). Anti-abuso: rate-limit por telefone.

### 3.3 Área do cliente — o que vale e o que é overkill

**Vale (fase 3, barato porque reusa as páginas públicas):** uma página única **"Meus atendimentos"** acessada por **link mágico enviado no WhatsApp** — sem senha, sem cadastro (senha para paciente de clínica = suporte infinito). Contém: próximo agendamento + botão reagendar, progresso do pacote ("7 sessões restantes"), pré/pós-cuidados do procedimento, termos assinados para download.

**Overkill (não fazer):** login/senha ou app nativo; chat dentro do portal (o canal É o WhatsApp); pagamento online (só quando houver demanda real); **histórico clínico, anamnese e fotos no portal** — além de sensível (LGPD), ninguém pediu; fotos de antes/depois vazando por link é risco reputacional grave.

---

## 4. ONBOARDING DA CLÍNICA (wizard de implantação)

Full-screen na primeira entrada da administradora, com barra de progresso, **"Pular por enquanto"** em toda etapa (o checklist do Dashboard guarda o que faltou).

1. **Sua clínica** — nome, logo, endereço, horários de funcionamento, nº de salas, **especialidade** (estética facial/corporal, harmonização, depilação a laser…) → define modelo de anamnese, sugestões de procedimentos e templates de mensagens.
2. **Conectar WhatsApp** — ilustração passo a passo (*"No celular da clínica: WhatsApp → Aparelhos conectados → Conectar aparelho → aponte para o código abaixo"*), QR da Evolution API com auto-refresh e polling de status → sucesso: *"✅ Conectado ao número (11) 98…"*. Aviso de boas práticas anti-banimento em linguagem simples (começar devagar, limites diários — o sistema já vem com throttle conservador).
3. **Procedimentos** — tabela de adição rápida (nome, duração, preço) + **sugestões de 1 clique** pela especialidade (*"Limpeza de pele — 60 min"*). Prazo de retorno pode ficar para depois.
4. **Equipe** — convidar por e-mail com papel (pode pular).
5. **Importar clientes** — upload de .xlsx/.csv → **mapeamento assistido de colunas** com preview das 5 primeiras linhas (*"Esta coluna é o Telefone?"*) → validação/normalização de telefones BR (+55, dedupe por telefone) → relatório: *"212 importadas, 3 puladas (sem telefone) — baixar lista"*. Template de planilha para download. Campos de histórico (última visita, último procedimento) importáveis para alimentar a reativação e o score.
6. **Automações** — apresenta as 3 essenciais pré-configuradas (Confirmação 24h + 2h, Aniversário, Pós-atendimento); escolha do **tom de voz** (Carinhoso 💚 / Profissional / Descontraído) que reescreve os templates e configura a persona da IA; preview real; tudo ligado em modo **"Revisar antes de enviar"**.
7. **Pronto!** — *"Sua clínica está no ar. Crie seu primeiro agendamento."* + tour opcional de 60s.

---

## 5. DESIGN SYSTEM

**Base técnica:** **shadcn/ui + Tailwind CSS + Radix** — sim, é a escolha certa: componentes copiados para o repo (sem lock-in), acessibilidade Radix, tema 100% customizável para o visual de saúde. Complementos: `react-hook-form` + `zod` (formulários), **TanStack Table** (listas), **Recharts** (gráficos), `date-fns` com locale pt-BR, `dnd-kit` (drag da agenda e do kanban). **Agenda: grid próprio em CSS Grid** (colunas por profissional) — o resource view do FullCalendar é pago e o react-big-calendar limita demais o card rico de estados; o grid próprio dá controle total sobre chips, botões de 1 clique e drag.

**Tom visual:** base clara e limpa (branco / cinza quente `stone`), primária **verde-petróleo/teal** (saúde, calma, confiança — foge do azul genérico de ERP); tipografia **Inter** (ou Plus Jakarta Sans para os títulos); cantos `rounded-lg`, sombras suaves, densidade média. **Cores semânticas fixas em todo o app**: verde = confirmado/pago/compareceu · âmbar = aguardando · vermelho = falta/atraso/alerta clínico · **roxo/✨ = coisa feita pela IA** (consistência ensina o sistema sozinha).

**Linguagem (parte do design system):** glossário obrigatório — "Número conectado" (nunca "instância"), "Mensagens enviadas" (nunca "disparos"), "Revisar antes de enviar" (nunca "human-in-the-loop"). Toda tela tem subtítulo de 1 linha dizendo para que serve. Todo estado vazio orienta a próxima ação. Erros dizem o que fazer (*"O WhatsApp desconectou. Toque aqui para escanear o código de novo."*).

**Responsividade:** desktop-first para recepção (sidebar fixa, tabelas densas, atalhos de teclado na agenda); no celular da dona: bottom nav, agenda em lista do dia, aprovações com swipe (→ aprova, ← rejeita), gráficos empilhados. **PWA instalável** com push (aprovações pendentes, WhatsApp desconectado, "precisa de você" no Inbox).

---

## 6. ROADMAP FASEADO

**Critério do MVP:** a clínica consegue **operar o dia inteiro dentro do sistema** — agenda com estados, ficha de cliente, WhatsApp conectado com confirmação automática revisada por humano e inbox para responder. Financeiro, termos e estoque aguentam mais 2 meses na planilha/papel; a agenda + WhatsApp não aguentam, porque são o valor visível do produto.

Esforço relativo total = 100 pontos. Estimativas para 1 dev sênior em ritmo integral.

### FASE 1 — MVP Operacional (~40 pts · ~7–9 semanas)

Ordem de construção (setas = dependência):

1. **Fundação** (6 pts): monorepo Next.js (App Router), schema Postgres multi-tenant (`clinic_id` em tudo + middleware de escopo obrigatório em cada query; opcional RLS), auth por e-mail/senha + convites, RBAC (3 papéis), Docker Compose (Next, Postgres, Redis, Evolution, worker), shell de layout (sidebar/topbar/bottom-nav), seeds.
2. **Catálogo + Equipe** (3 pts) → pré-requisito da Agenda.
3. **Clientes** (5 pts): lista, ficha com abas Dados/Anamnese/Histórico (Evolução/Fotos ficam p/ fase 2), modelos de anamnese básicos.
4. **Agenda** (8 pts): visões dia-por-profissional/semana/lista, criação rápida, máquina de estados completa com botões de 1 clique, drag & drop. ← depende de 2 e 3.
5. **Integração Evolution API** (5 pts): conexão QR, status/reconexão, envio de texto, webhook de recebimento, normalização de telefones. (Paralelizável com 4.)
6. **Worker + Confirmação por cadência + Aprovações** (6 pts): BullMQ/Redis, agendador da cadência 24h/2h/45min, fila de Aprovações com edição/lote/expiração, idempotência por chave `(agendamento, automação, etapa)`. ← depende de 4 e 5.
7. **Inbox básico + takeover** (4 pts): conversas, envio manual, pausa de automação por conversa. ← depende de 5.
8. **Interpretação de respostas com Claude** (2 pts): classificador (confirmar/cancelar/reagendar/pergunta/outro) sobre a resposta do cliente ao lembrete → muda status sozinho ou marca "precisa de você". Ainda **não** é conversa livre. ← depende de 6 e 7.
9. **Dashboard** (2 pts): agrega tudo. 
10. **Onboarding wizard + import CSV** (3 pts): por último — usa todos os cadastros.
11. Transversal LGPD desde o dia 1 (incluso na fundação): consentimento no cadastro, trilha de auditoria de acesso à ficha, backup diário automatizado (pg_dump + retenção), TLS.

**Entregável:** clínica-piloto operando, com toda automação em modo "revisar antes de enviar".

### FASE 2 — Receita e Relacionamento (~35 pts · ~7–9 semanas)

Ordem: 
1. **Financeiro essencial** (5 pts): a receber automático no Compareceu, despesas, confirmação de recebimento, visão geral. (Base para pacotes/orçamentos/comissões.)
2. **Pacotes** (3 pts): atribuição, sessões, barra de progresso na ficha e na agenda.
3. **Infra de páginas públicas + Termos com assinatura nativa** (6 pts): tokens seguros, verificação leve, canvas de assinatura, hash + auditoria, PDF, acompanhamento Enviado→Visualizado→Assinado.
4. **Orçamentos** (4 pts): reusa páginas públicas; conversão em venda → Financeiro.
5. **Automações de relacionamento** (6 pts): recuperação de faltas + follow-up, pós-atendimento imediato, cadência pós-venda por procedimento, coleta de feedback (positivo → Google Meu Negócio), aniversário, pré-cuidados, confirmação de retoque, mensagens de resposta a remarcar/cancelar/confirmar.
6. **Página pública de agendamento/reagendamento** (4 pts).
7. **IA conversacional completa** (5 pts): persona configurável, contexto da ficha/agenda, conversa livre humanizada, detecção de handoff, guard-rails ("o que a IA não pode fazer"), pausa por takeover.
8. **Inteligência v1** (2 pts): score 0–100 com breakdown, classificação, ação sugerida com botão → Aprovações.
9. **Relatórios básicos** (dentro dos 35 pts): faturamento, conversão, ticket médio, reativações.

### FASE 3 — Crescimento e Gestão Completa (~25 pts · ~6–8 semanas)

Ordem:
1. **Reativação inteligente** (4 pts): sequência de até 7 mensagens com offsets editáveis, por prazo de retorno do procedimento + genérica de 30 dias, ignora agendamento futuro, roda diária em horário comercial.
2. **Preenchimento inteligente de agenda** (3 pts): buracos 72h à frente × clientes com retorno vencido → oferta de horários com link.
3. **Renovação de pacotes** (2 pts): gatilhos por sessões restantes e por vencimento.
4. **Campanhas segmentadas com throttling** (3 pts): segmento (filtros da Inteligência/Clientes) + mensagem + envio gradual anti-ban.
5. **Funil Kanban + lead automático do WhatsApp** (3 pts).
6. **Estoque** (3 pts): mínimo, movimentações, vínculo procedimento→insumos com baixa automática e custo no Financeiro.
7. **Comissões** (2 pts): regras, apuração, marcar como pago.
8. **Financeiro avançado** (2 pts): taxas de cartão 1x–15x, antecipação de recebíveis, fluxo de caixa.
9. **Extras** (3 pts): importação de contratos Word, área do cliente (link mágico), Google Calendar (one-way), export LGPD self-service, relatórios avançados, polimento multi-unidade.

---

## 7. ESTRATÉGIA DE VERIFICAÇÃO E TESTES DE PONTA A PONTA

**7.1 Relógio simulado (fundação, obrigatório na Fase 1).** O worker e todo cálculo de cadência **nunca** chamam `Date.now()` direto — recebem um `TimeProvider` injetado. Em dev/staging, endpoint admin `POST /api/dev/clock` (inexistente em produção, guardado por env) congela e avança o tempo. Como o agendador funciona por comparação `agora ≥ enviar_em`, avançar o relógio 24h dispara deterministicamente toda a cadência em segundos — sem esperar dias reais.

**7.2 Mock da Evolution API.** Container `evolution-mock` no Compose de teste: implementa os endpoints usados (envio de texto, status da instância) gravando tudo, e **emite webhooks sob comando** para simular respostas do cliente. Isso fecha o loop completo em teste: criar agendamento → avançar relógio → mensagem gerada → Aprovações → aprovar → "enviada" ao mock → mock injeta resposta *"pode confirmar sim"* → Claude classifica → status vira **Confirmado** → Dashboard reflete. Em **staging com Evolution real**: whitelist de números (mensagens só saem para os números de teste do Paulo) + prefixo `[TESTE]`.

**7.3 Testes da IA (Claude).** (a) **Record/replay**: respostas gravadas como fixtures para testes determinísticos de pipeline. (b) **Suite de avaliação com dataset dourado**: ~100+ respostas reais em pt-BR coloquial (*"blz"*, *"n vou pd ir 😢"*, *"quem fala?"*, áudios transcritos) com classificação esperada; roda a cada mudança de prompt/modelo; gate de acurácia ≥95% em confirmar/cancelar antes de deploy. (c) Testes de guard-rail: prompts adversariais ("você é um robô?", pedido de desconto, assunto médico delicado) devem resultar em handoff ou resposta segura, nunca quebra de persona.

**7.4 Idempotência e resiliência do worker.** Chave única `(agendamento_id, automacao_id, etapa)` na tabela de envios; testes que matam e reiniciam o worker no meio de um lote e verificam que **nenhuma mensagem duplica**; teste de fila represada (WhatsApp desconectado 2h → reconecta → mensagens vencidas expiram em vez de disparar tarde e parecer bug).

**7.5 E2E com Playwright, por fase.** Fase 1: fluxo completo do 7.2 + criação rápida de agendamento + máquina de estados + onboarding com import de CSV sujo (telefones mal formatados, duplicatas). Fase 2: assinatura de termo **em viewport mobile** (scroll até o fim, canvas, verificação de identidade errada 3x), orçamento aceito → venda no financeiro, agendamento público com conflito de slot (dois clientes no mesmo horário → um ganha). Fase 3: seeds de reativação (clientes com retorno vencido em offsets variados) → avançar relógio dia a dia → verificar sequência 1/3/13/25/40 e **interrupção da sequência** quando o cliente agenda no meio dela.

**7.6 Seeds de cenário (`pnpm seed:demo`).** Cria uma clínica-demo que exercita cada automação: agendamento amanhã 14h (cadência), no-show ontem (recuperação), aniversariante hoje, pacote com 1 sessão restante (renovação), cliente com retorno vencido há 3 dias (reativação), buraco na agenda de amanhã + cliente atrasado (preenchimento). Usada em dev, CI, staging e **demos de venda do SaaS**.

**7.7 Isolamento multi-tenant.** Testes de integração automatizados que, com sessão válida da clínica A, tentam ler/escrever cada recurso da clínica B por ID direto → esperado 404 em 100% das rotas; se RLS, testes das políticas no Postgres. Roda no CI em todo PR.

**7.8 Piloto em produção (gate de cada fase).** Toda automação nova estreia na clínica real em **modo sombra** (100% via Aprovações) por 2 semanas; critérios para liberar envio automático: taxa de edição < 10% e zero incidentes de tom. Backup: **drill mensal de restore** do pg_dump em container limpo com smoke test automatizado — backup que nunca foi restaurado não é backup.