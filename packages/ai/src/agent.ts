import {
  createLlmClient,
  type AiConfig,
  type ChatMessage,
  type ToolDef,
  type ToolResultMsg,
} from "./provider";

/**
 * Agente conversacional humanizado — o coração do produto.
 *
 * Princípios (plano §7):
 *  - A IA NUNCA inventa horário, preço ou agendamento: fatos vêm de ferramentas.
 *  - Toda resposta termina na ferramenta `responder_cliente` (1–3 balões curtos).
 *  - Assunto clínico/médico, irritação, negociação ou "é robô?" → escalar_para_humano.
 */

export interface AgentPersona {
  assistantName: string;
  tone: "acolhedora" | "elegante" | "animada";
}

export interface AgentClinicInfo {
  name: string;
  city: string | null;
  businessHoursLabel: string;
  catalog: { name: string; price: string; durationMinutes: number }[];
}

export interface AgentCustomerContext {
  /** Vazio quando a ficha não tem nome utilizável (perfil do WhatsApp sem nome). */
  firstName: string;
  /** true = a ficha tem nome completo de verdade (2+ palavras, não-telefone). */
  nameConfirmed: boolean;
  isNew: boolean;
  visitsCount: number;
  upcomingAppointment: string | null; // "Limpeza de Pele, sex 22/08 às 14:00 (id: ...)"
  activeGoal: string | null; // "obter confirmação da consulta de amanhã 14:00"
  packageSummary: string | null;
}

export interface AgentTurnInput {
  persona: AgentPersona;
  clinic: AgentClinicInfo;
  customer: AgentCustomerContext;
  nowLabel: string; // "quinta-feira, 20/08/2026, 15:32 (horário de Brasília)"
  /** Histórico: papel + texto (já limitado a ~30 mensagens). */
  history: { role: "customer" | "assistant"; text: string }[];
}

export interface AgentReply {
  balloons: string[];
  internalNote: string | null;
  confidence: "alta" | "media" | "baixa";
  escalated: boolean;
  usage: { inputTokens: number; outputTokens: number; calls: number };
  /** Ferramentas chamadas por iteração (diagnóstico de loops). */
  toolTrace: string[];
}

/** Executores das ferramentas — implementados pelo worker com acesso ao banco. */
export interface AgentToolExecutors {
  consultarHorarios(procedimentoNome: string | null): Promise<string>;
  agendar(slotId: string, procedimentoNome: string): Promise<string>;
  reagendar(agendamentoId: string, slotId: string): Promise<string>;
  cancelar(agendamentoId: string, motivo: string | null): Promise<string>;
  confirmarPresenca(agendamentoId: string): Promise<string>;
  consultarPacote(): Promise<string>;
  escalarParaHumano(motivo: string, urgencia: "alta" | "normal"): Promise<string>;
  registrarOptOut(): Promise<string>;
  /** Completa a ficha APENAS nos campos vazios — nunca sobrescreve. */
  atualizarCadastro(dados: Record<string, string>): Promise<string>;
}

const TONE_STYLES: Record<AgentPersona["tone"], string> = {
  acolhedora:
    "Seu tom é caloroso, próximo e maternal — como uma atendente querida que conhece as clientes pelo nome. Usa no máximo um emoji por balão (💛 é o seu favorito), e nem sempre.",
  elegante:
    "Seu tom é elegante, sóbrio e profissional — cordial sem intimidade excessiva. Raramente usa emoji.",
  animada:
    "Seu tom é jovem, leve e animado — sem exagerar. No máximo um emoji por balão.",
};

export function buildSystemPrompt(
  persona: AgentPersona,
  clinic: AgentClinicInfo,
): string {
  const catalog = clinic.catalog
    .map((c) => `- ${c.name}: a partir de R$ ${c.price} (${c.durationMinutes} min)`)
    .join("\n");

  return `Você é ${persona.assistantName}, atendente da ${clinic.name}${clinic.city ? ` (${clinic.city})` : ""}, conversando pelo WhatsApp da clínica.

${TONE_STYLES[persona.tone]}

SOBRE A CLÍNICA
Horário de atendimento: ${clinic.businessHoursLabel}.
Serviços e valores:
${catalog}

REGRAS INEGOCIÁVEIS
1. Você escreve como uma pessoa real da equipe. Nunca diga que é assistente virtual, IA, robô ou sistema. Se perguntarem diretamente se você é um robô, use escalar_para_humano e responda apenas que vai pedir para alguém da equipe continuar a conversa.
2. NUNCA invente horário, data ou disponibilidade — sempre use consultar_horarios antes de oferecer horários, e agendar/reagendar para efetivar. Só afirme que algo está agendado depois que a ferramenta confirmar.
3. NUNCA invente preço, desconto ou condição de pagamento. Os únicos valores que você pode citar são os do catálogo acima ("a partir de"). Pedido de desconto ou negociação → escalar_para_humano.
4. Qualquer assunto de saúde — dor, inchaço, reação, alergia, medicamento, gravidez, "deu errado", resultado do procedimento — é assunto da equipe clínica: acolha com UMA frase gentil (sem opinião técnica) e use escalar_para_humano com urgência alta.
5. Cliente irritada, frustrada ou pedindo para falar com alguém → escalar_para_humano. Atenção: pedir para remarcar ou cancelar NÃO é frustração — isso é o seu trabalho de todo dia, resolva você mesma com reagendar/cancelar sem escalar.
6. Cliente pedindo para parar de receber mensagens → registrar_opt_out e despeça-se com carinho.
7. Escreva como no WhatsApp: mensagens curtas, informais na medida do tom, sem listas numeradas, sem markdown, sem assinatura. Varie as aberturas (nunca comece toda resposta do mesmo jeito). No máximo 1 emoji por balão.
8. SEMPRE finalize a sua vez CHAMANDO a ferramenta responder_cliente com 1 a 3 balões. Sem exceção. responder_cliente é uma FERRAMENTA — nunca escreva a chamada como texto dentro da mensagem, e nunca acrescente instruções entre parênteses para a cliente.
9. FAÇA, nunca anuncie. É proibido responder "vou reservar/verificar/consultar" e parar por aí — chame a ferramenta AGORA, nesta mesma vez, e responda já com o resultado. Quando a cliente escolher um horário: se você não tiver o slot_id em mãos (ele NÃO fica guardado de uma conversa para a outra), chame consultar_horarios de novo e em seguida agendar com o slot_id correspondente ao horário escolhido — tudo antes de responder. Só diga que está confirmado depois que a ferramenta agendar confirmar.
10. Na PRIMEIRA resposta de uma conversa, cumprimente pelo nome e dê boas-vindas com calor humano antes de qualquer informação — jamais comece direto no preço ou no dado seco, como um sistema faria. Nas respostas seguintes da mesma conversa, não fique repetindo cumprimento.
11. Dados pessoais que a cliente informar na conversa (nome completo, e-mail, CPF, RG, nascimento, endereço, convênio/plano) → guarde na hora com atualizar_cadastro e siga a conversa com naturalidade, sem dizer "atualizei no sistema". NUNCA transforme a conversa em formulário pedindo dados em sequência — no máximo, pergunte o nome completo na hora de marcar pela primeira vez. Para remarcar ou cancelar, use o id do agendamento que está no seu contexto.
12. Tenha noção de tempo como uma pessoa tem: você sabe que dia é hoje. Fale "hoje", "amanhã", "sábado" — nunca fórmulas burocráticas como "no dia anterior" ou "na data em questão". Um horário marcado para amanhã tem véspera HOJE — perceba isso antes de falar. E não ofereça nem prometa lembretes por conta própria: os lembretes automáticos da clínica cuidam disso; se a cliente pedir para ser lembrada, diga só que ela recebe uma mensagem antes do horário.`;
}

const TOOL_NAMES = [
  "consultar_horarios",
  "agendar",
  "reagendar",
  "cancelar",
  "confirmar_presenca",
  "consultar_pacote",
  "escalar_para_humano",
  "registrar_opt_out",
  "atualizar_cadastro",
  "responder_cliente",
] as const;

/** O texto contém sintaxe de ferramenta vazada? (modelo fraco em modo texto) */
export function hasToolSyntaxLeak(text: string): boolean {
  if (/\{\s*"balloons"/.test(text)) return true;
  return TOOL_NAMES.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(text));
}

/**
 * Resgate: o modelo escreveu `responder_cliente({"balloons":[...]})` como
 * TEXTO em vez de chamar a ferramenta. A intenção está clara — extrai os
 * balões do JSON e joga fora o resto (meta-instruções, sintaxe, tudo).
 */
export function salvageBalloons(text: string): string[] | null {
  const start = text.search(/responder_cliente\s*\(/);
  if (start === -1) return null;
  const braceStart = text.indexOf("{", start);
  if (braceStart === -1) return null;
  // Varredura de chaves ciente de strings (textos de balão têm chaves/aspas)
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      try {
        const parsed = JSON.parse(text.slice(braceStart, i + 1)) as { balloons?: unknown };
        const balloons = Array.isArray(parsed.balloons)
          ? parsed.balloons
              .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
              .slice(0, 3)
          : [];
        return balloons.length > 0 ? balloons : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const TOOLS: ToolDef[] = [
  {
    name: "consultar_horarios",
    description:
      "Consulta os horários realmente livres da agenda para um procedimento nos próximos dias. Use SEMPRE antes de oferecer qualquer horário.",
    inputSchema: {
      type: "object",
      properties: {
        procedimento_nome: {
          type: "string",
          description: "Nome do procedimento desejado (como está no catálogo)",
        },
      },
    },
  },
  {
    name: "agendar",
    description:
      "Agenda a cliente em um horário retornado por consultar_horarios. Use apenas slot_id vindos da consulta.",
    inputSchema: {
      type: "object",
      properties: {
        slot_id: { type: "string" },
        procedimento_nome: { type: "string" },
      },
      required: ["slot_id", "procedimento_nome"],
    },
  },
  {
    name: "reagendar",
    description:
      "Remarca um agendamento existente para um novo horário (slot_id de consultar_horarios).",
    inputSchema: {
      type: "object",
      properties: {
        agendamento_id: { type: "string" },
        slot_id: { type: "string" },
      },
      required: ["agendamento_id", "slot_id"],
    },
  },
  {
    name: "cancelar",
    description: "Cancela um agendamento existente da cliente.",
    inputSchema: {
      type: "object",
      properties: {
        agendamento_id: { type: "string" },
        motivo: { type: "string" },
      },
      required: ["agendamento_id"],
    },
  },
  {
    name: "confirmar_presenca",
    description: "Confirma a presença da cliente no agendamento existente.",
    inputSchema: {
      type: "object",
      properties: { agendamento_id: { type: "string" } },
      required: ["agendamento_id"],
    },
  },
  {
    name: "consultar_pacote",
    description: "Consulta o saldo de sessões e validade dos pacotes da cliente.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "escalar_para_humano",
    description:
      "Passa a conversa para a equipe humana. Use para: assunto de saúde, irritação, negociação de preço, pedido explícito, pergunta se você é robô, ou quando não souber ajudar.",
    inputSchema: {
      type: "object",
      properties: {
        motivo: { type: "string" },
        urgencia: { type: "string", enum: ["alta", "normal"] },
      },
      required: ["motivo"],
    },
  },
  {
    name: "registrar_opt_out",
    description: "Registra que a cliente não quer mais receber mensagens da clínica.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "atualizar_cadastro",
    description:
      "Guarda na ficha dados pessoais que a CLIENTE INFORMOU nesta conversa. Só completa campos que estão vazios — nunca apaga nem substitui o que a clínica já preencheu. Use quando ela contar espontaneamente (novo e-mail, mudou de endereço, informou CPF para o convênio etc.).",
    inputSchema: {
      type: "object",
      properties: {
        nome_completo: { type: "string" },
        email: { type: "string" },
        cpf: { type: "string" },
        rg: { type: "string" },
        data_nascimento: { type: "string", description: "dd/mm/aaaa" },
        convenio: { type: "string", description: "Nome do convênio (ex.: Unimed)" },
        plano: { type: "string", description: "Plano do convênio" },
        endereco_rua: { type: "string" },
        endereco_numero: { type: "string" },
        endereco_bairro: { type: "string" },
        endereco_cidade: { type: "string" },
      },
    },
  },
  {
    name: "responder_cliente",
    description:
      "OBRIGATÓRIA ao final de toda vez sua: envia a resposta à cliente em 1 a 3 balões curtos de WhatsApp.",
    inputSchema: {
      type: "object",
      properties: {
        balloons: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 3,
          description: "Balões curtos (até ~250 caracteres cada), sem markdown",
        },
        nota_interna: {
          type: "string",
          description: "Nota opcional para a equipe (a cliente não vê)",
        },
        confianca: { type: "string", enum: ["alta", "media", "baixa"] },
      },
      required: ["balloons"],
    },
  },
];

export interface RunAgentOptions {
  /** Configuração do provedor (Anthropic ou OpenAI-compatível). */
  config: AiConfig;
  maxIterations?: number;
}

export async function runAgentTurn(
  input: AgentTurnInput,
  executors: AgentToolExecutors,
  options: RunAgentOptions,
): Promise<AgentReply> {
  const client = createLlmClient(options.config);
  const model = options.config.agentModel;
  const maxIterations = options.maxIterations ?? 6;

  const system = [
    buildSystemPrompt(input.persona, input.clinic),
    `AGORA: ${input.nowLabel}.

SOBRE ESTA CLIENTE
Nome: ${input.customer.firstName || "ainda não sabemos (o perfil do WhatsApp não tem nome utilizável)"}${input.customer.isNew ? " (primeira conversa — ainda não é cliente)" : ` (${input.customer.visitsCount} visita(s) anteriores)`}.
${input.customer.nameConfirmed ? "" : "ATENÇÃO: a ficha ainda NÃO tem o nome completo confirmado. Antes de finalizar um agendamento, pergunte o nome completo dela com naturalidade e guarde com atualizar_cadastro — a ferramenta agendar não funciona sem isso."}
${input.customer.upcomingAppointment ? `Próximo agendamento: ${input.customer.upcomingAppointment}.` : "Sem agendamento futuro."}
${input.customer.packageSummary ? `Pacotes: ${input.customer.packageSummary}.` : ""}
${input.customer.activeGoal ? `CONTEXTO: esta conversa tem um objetivo ativo — ${input.customer.activeGoal}.` : ""}`,
  ];

  const messages: ChatMessage[] = input.history.map((m) => ({
    role: m.role === "customer" ? ("user" as const) : ("assistant" as const),
    text: m.text,
  }));

  let escalated = false;
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  // Garantia MECÂNICA de boas-vindas: modelo econômico esquece a regra 10
  // de vez em quando — na primeira resposta da conversa, se o 1º balão não
  // cumprimenta, o cumprimento entra por código (variado, nunca template fixo)
  const isFirstReply = !input.history.some((m) => m.role === "assistant");
  const GREETING_RE =
    /\b(oi+|olá|ola|bom dia|boa tarde|boa noite|bem[- ]vind|tudo bem|que bom)\b/i;
  const ensureGreeting = (balloons: string[]): string[] => {
    if (!isFirstReply || balloons.length === 0 || GREETING_RE.test(balloons[0]!)) {
      return balloons;
    }
    const nome = input.customer.firstName;
    const variants = nome
      ? [`Oi, ${nome}! `, `Olá, ${nome}, tudo bem? `, `Oi, ${nome}, tudo bem? 💛 `]
      : ["Oi! ", "Olá, tudo bem? ", "Oi, tudo bem? 💛 "];
    const pick =
      variants[
        Math.abs([...(nome || "x")].reduce((a, c) => a + c.charCodeAt(0), 0)) %
          variants.length
      ]!;
    const first = balloons[0]!;
    return [pick + first.charAt(0).toLowerCase() + first.slice(1), ...balloons.slice(1)];
  };
  const wrappedExecutors: Record<string, (raw: Record<string, unknown>) => Promise<string>> = {
    consultar_horarios: (raw) =>
      executors.consultarHorarios(typeof raw.procedimento_nome === "string" ? raw.procedimento_nome : null),
    agendar: (raw) => executors.agendar(String(raw.slot_id ?? ""), String(raw.procedimento_nome ?? "")),
    reagendar: (raw) => executors.reagendar(String(raw.agendamento_id ?? ""), String(raw.slot_id ?? "")),
    cancelar: (raw) =>
      executors.cancelar(String(raw.agendamento_id ?? ""), typeof raw.motivo === "string" ? raw.motivo : null),
    confirmar_presenca: (raw) => executors.confirmarPresenca(String(raw.agendamento_id ?? "")),
    consultar_pacote: () => executors.consultarPacote(),
    escalar_para_humano: async (raw) => {
      escalated = true;
      return executors.escalarParaHumano(
        String(raw.motivo ?? "sem motivo"),
        raw.urgencia === "alta" ? "alta" : "normal",
      );
    },
    registrar_opt_out: () => executors.registrarOptOut(),
    atualizar_cadastro: (raw) => {
      const dados: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "string" && value.trim()) dados[key] = value.trim();
      }
      return executors.atualizarCadastro(dados);
    },
  };

  const toolTrace: string[] = [];
  let toolFailures = 0;
  for (let i = 0; i < maxIterations; i++) {
    const response = await client.chat({
      model,
      maxTokens: 700,
      system,
      messages,
      tools: TOOLS,
    });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.calls += 1;
    toolTrace.push(response.toolCalls.map((c) => c.name).join("+") || "(texto)");

    // Resposta final?
    const responder = response.toolCalls.find((t) => t.name === "responder_cliente");
    if (responder) {
      const raw = responder.input as {
        balloons?: unknown;
        nota_interna?: unknown;
        confianca?: unknown;
      };
      const balloons = Array.isArray(raw.balloons)
        ? raw.balloons.filter((b): b is string => typeof b === "string" && b.trim().length > 0).slice(0, 3)
        : [];
      if (balloons.length > 0) {
        return {
          balloons: ensureGreeting(balloons),
          internalNote: typeof raw.nota_interna === "string" ? raw.nota_interna : null,
          confidence:
            raw.confianca === "baixa" ? "baixa" : raw.confianca === "media" ? "media" : "alta",
          escalated,
          usage,
          toolTrace,
        };
      }
    }

    if (response.toolCalls.length === 0) {
      if (response.text) {
        // Modelo escreveu a chamada da ferramenta como TEXTO? Resgata só os
        // balões do JSON — a cliente JAMAIS pode ver sintaxe de sistema
        const salvaged = salvageBalloons(response.text);
        if (salvaged) {
          return {
            balloons: ensureGreeting(salvaged),
            internalNote: "Resgatado: modelo escreveu responder_cliente como texto.",
            confidence: "media",
            escalated,
            usage,
            toolTrace,
          };
        }
        if (hasToolSyntaxLeak(response.text)) {
          // Vazou sintaxe e não deu para resgatar: manda o modelo refazer
          // (nunca envia texto com cara de código para a cliente)
          messages.push({ role: "assistant", text: response.text });
          messages.push({
            role: "user",
            text: "[sistema] Sua última resposta continha sintaxe de ferramenta como texto e NÃO foi enviada. Chame a ferramenta responder_cliente de verdade, com 1 a 3 balões limpos.",
          });
          continue;
        }
        // Texto limpo sem ferramenta: vira balão único (fallback)
        return {
          balloons: ensureGreeting([response.text]),
          internalNote: null,
          confidence: "media",
          escalated,
          usage,
          toolTrace,
        };
      }
      break;
    }

    // Executa as ferramentas e continua o loop
    messages.push({
      role: "assistant_tools",
      text: response.text || null,
      calls: response.toolCalls,
    });
    const results: ToolResultMsg[] = [];
    for (const toolCall of response.toolCalls) {
      if (toolCall.name === "responder_cliente") {
        // Chegou aqui = balões vazios/inválidos; todo tool call precisa de
        // resposta (Anthropic e OpenAI exigem) — devolve a instrução de correção
        results.push({
          toolCallId: toolCall.id,
          content: "Os balões vieram vazios. Chame responder_cliente de novo com 1 a 3 balões de texto.",
          isError: true,
        });
        continue;
      }
      const executor = wrappedExecutors[toolCall.name];
      if (!executor) {
        results.push({
          toolCallId: toolCall.id,
          content: "Ferramenta indisponível.",
          isError: true,
        });
        continue;
      }
      try {
        const output = await executor(toolCall.input);
        results.push({ toolCallId: toolCall.id, content: output });
      } catch (err) {
        toolFailures += 1;
        results.push({
          toolCallId: toolCall.id,
          content: err instanceof Error ? err.message : "Falha na ferramenta.",
          isError: true,
        });
        if (toolFailures >= 2 && !escalated) {
          // Duas falhas seguidas: rede de segurança — escala
          escalated = true;
          await executors.escalarParaHumano("falhas técnicas seguidas", "normal");
        }
      }
    }
    messages.push({ role: "tool_results", results });
  }

  // Loop esgotado sem resposta: fallback seguro + escala
  if (!escalated) {
    escalated = true;
    await executors.escalarParaHumano("agente não concluiu a resposta", "normal");
  }
  return {
    balloons: ["Só um instante — vou pedir para alguém da equipe te ajudar com isso, tá? 💛"],
    internalNote: "Fallback: agente não concluiu com responder_cliente.",
    confidence: "baixa",
    escalated,
    usage,
    toolTrace,
  };
}
