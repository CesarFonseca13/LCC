/**
 * Formulário de implantação (página pública /form).
 * Fonte única das perguntas: a página renderiza, o servidor valida e limpa,
 * o /admin mostra e o PDF é gerado a partir daqui. Só entra o que a equipe
 * precisa de fato para deixar a conta de uma clínica funcionando.
 */

export const ONBOARDING_FORM_VERSION = 1;

export type OnbFieldType =
  | "text"
  | "tel"
  | "email"
  | "url"
  | "number"
  | "textarea"
  | "select"
  | "radio"
  | "check"
  | "hours"
  | "list"
  | "sub";

export interface OnbField {
  k: string;
  t: OnbFieldType;
  /** Rótulo da pergunta. */
  l: string;
  /** Dica curta embaixo da pergunta. */
  h?: string;
  req?: boolean;
  /** Obrigatório só quando a condição vale (recebe as respostas da mesma seção). */
  reqIf?: (section: Record<string, unknown>) => boolean;
  /** Divide a linha com o campo seguinte (meia largura). */
  half?: boolean;
  /** Opções de select/radio/check. */
  o?: readonly string[];
  /** Lista repetível: rótulo do botão, nome do item e subcampos. */
  add?: string;
  name?: string;
  f?: OnbField[];
}

export interface OnbSection {
  id: string;
  title: string;
  desc: string;
  intro?: string;
  fields: OnbField[];
}

export const ONBOARDING_DAYS: readonly [string, string][] = [
  ["seg", "Segunda"],
  ["ter", "Terça"],
  ["qua", "Quarta"],
  ["qui", "Quinta"],
  ["sex", "Sexta"],
  ["sab", "Sábado"],
  ["dom", "Domingo"],
];

const SN = ["Sim", "Não"] as const;
const LIGAR = ["Ligar", "Não"] as const;

export const ONBOARDING_SECTIONS: OnbSection[] = [
  {
    id: "clinica",
    title: "Sobre a clínica",
    desc: "Nome, contato e endereço",
    fields: [
      { k: "nome", t: "text", l: "Nome da clínica", req: true, h: "Do jeito que as clientes conhecem. É assim que a atendente se apresenta no WhatsApp." },
      {
        k: "especialidade",
        t: "select",
        l: "Especialidade principal",
        req: true,
        o: ["Estética facial", "Estética corporal", "Harmonização orofacial", "Depilação a laser", "Dermatologia", "Odontologia", "Clínica médica / consultório", "Fisioterapia", "Nutrição", "Psicologia", "Veterinária", "Outra"],
      },
      { k: "especialidade_outra", t: "text", l: "Se marcou Outra, qual?" },
      { k: "tel", t: "tel", l: "Telefone da clínica", req: true, h: "Com DDD. É o número que a atendente passa para as clientes." },
      { k: "google", t: "url", l: "Link de avaliação no Google", h: "Link direto para deixar a avaliação (começa com g.page/r/...). No Perfil da Empresa no Google, toque em \"Pedir avaliações\" e copie o link. Quando uma cliente elogia, a atendente manda esse link." },
      { k: "_end", t: "sub", l: "Endereço" },
      { k: "cep", t: "text", l: "CEP", req: true, half: true },
      { k: "numero", t: "text", l: "Número", req: true, half: true },
      { k: "rua", t: "text", l: "Rua / Avenida", req: true },
      { k: "compl", t: "text", l: "Complemento (sala, andar, bloco)" },
      { k: "bairro", t: "text", l: "Bairro", req: true, half: true },
      { k: "cidade", t: "text", l: "Cidade", req: true, half: true },
      { k: "uf", t: "text", l: "Estado (UF)", req: true, half: true, h: "Ex.: SP" },
    ],
  },
  {
    id: "horario",
    title: "Horário de funcionamento",
    desc: "Dias, horários, almoço e fechamentos",
    fields: [
      { k: "hours", t: "hours", l: "Para cada dia: aberto? De que hora até que hora?", req: true, h: "Só são oferecidos horários dentro deste período. Dia desmarcado é dia fechado." },
      { k: "almoco", t: "text", l: "Pausa de almoço em que não se agenda", h: "Ex.: 12:00 às 13:00. Deixe em branco se atende direto. A equipe bloqueia esse horário na agenda para você." },
      { k: "feriados", t: "textarea", l: "Feriados e fechamentos já previstos", h: "Datas em que a clínica fecha nos próximos meses, uma por linha. Ex.: 02/11 Finados; 24/12 a 02/01 recesso. A equipe cadastra cada data como bloqueio na agenda; datas novas você bloqueia pelo painel." },
      { k: "ferias", t: "textarea", l: "Férias ou ausências já marcadas de alguém da equipe", h: "Nome e período. Ex.: Dra. Paula, 10/01 a 20/01." },
    ],
  },
  {
    id: "casa",
    title: "Como chegar e regras da casa",
    desc: "O que a atendente responde sobre localização, pagamento e políticas",
    intro: "Escreva do jeito que você explicaria para uma cliente. A atendente usa estes textos como estão.",
    fields: [
      { k: "chegar", t: "textarea", l: "Como chegar", req: true, h: "Referências, metrô ou ônibus mais perto, entrada do prédio, portaria, andar e sala, interfone." },
      { k: "estac", t: "textarea", l: "Estacionamento", req: true, h: "Próprio, conveniado, valet, zona azul ou rua? Preço e regras. Se não tem, onde as clientes costumam parar?" },
      { k: "pagto", t: "textarea", l: "Formas de pagamento e parcelamento", req: true, h: "Pix, dinheiro, débito, crédito, link? Em quantas vezes, com ou sem juros, a partir de qual valor? Cobra sinal para reservar?" },
      { k: "convenios", t: "textarea", l: "Convênios", h: "Atende por convênio ou plano? Quais? Se não, emite recibo para reembolso?" },
      { k: "cancel", t: "textarea", l: "Cancelamento, remarcação, atraso e falta", req: true, h: "Prazo mínimo para cancelar, cobrança de taxa, tolerância de atraso em minutos, o que acontece na falta sem aviso." },
      { k: "outras", t: "textarea", l: "Outras informações que a atendente precisa saber", h: "Instagram e site, acessibilidade (rampa, elevador), acompanhante, crianças e pets, idade mínima, se precisa de avaliação antes de marcar, Wi-Fi, regras da casa." },
    ],
  },
  {
    id: "equipe",
    title: "Equipe e acessos ao painel",
    desc: "Quem entra no sistema e com qual papel",
    fields: [
      { k: "dona_nome", t: "text", l: "Nome completo da responsável (administradora da conta)", req: true },
      { k: "dona_email", t: "email", l: "E-mail de login da responsável", req: true, h: "Será o login dela. A senha inicial é entregue pela equipe do VesaliusX." },
      { k: "dona_atende", t: "radio", l: "A responsável também atende clientes (tem agenda própria)?", req: true, o: SN },
      {
        k: "logins",
        t: "list",
        l: "Outras pessoas que vão usar o painel",
        add: "Adicionar pessoa",
        name: "Pessoa",
        f: [
          { k: "nome", t: "text", l: "Nome completo" },
          { k: "email", t: "email", l: "E-mail de login" },
          { k: "papel", t: "select", l: "Papel", o: ["Recepção (agenda, clientes, WhatsApp)", "Profissional (vê a própria agenda)", "Administradora (acesso total)"] },
          { k: "atende", t: "radio", l: "Também atende clientes?", o: SN },
        ],
      },
      { k: "responsavel_wa", t: "text", l: "Quem cuida do WhatsApp no dia a dia e aprova as mensagens quando houver revisão?", req: true },
    ],
  },
  {
    id: "profissionais",
    title: "Profissionais que atendem",
    desc: "Uma por pessoa, com o nome que aparece para a cliente",
    intro: "Inclua a responsável se ela atende. Quem não vai usar o sistema também entra aqui, só para ter agenda.",
    fields: [
      {
        k: "lista",
        t: "list",
        l: "Profissionais",
        req: true,
        add: "Adicionar profissional",
        name: "Profissional",
        f: [
          { k: "nome", t: "text", l: "Nome como deve aparecer para a cliente", req: true, h: "Ex.: Dra. Paula, Camila. Sai nas mensagens: \"com a Dra. Paula\"." },
          { k: "area", t: "text", l: "Especialidade / área de atuação" },
          { k: "servicos", t: "textarea", l: "Serviços que realiza", h: "Escreva \"todos\" ou liste quais. Horários dela só são oferecidos para esses serviços." },
          { k: "horario", t: "text", l: "Dias e horários diferentes do da clínica, e folgas fixas", h: "Ex.: só terças e quintas, das 9h às 15h; não atende às quartas. Em branco = segue o horário da clínica. A equipe cria os bloqueios na agenda dela a partir disso." },
        ],
      },
    ],
  },
  {
    id: "salas",
    title: "Salas de atendimento",
    desc: "Para a agenda não marcar duas pessoas na mesma sala",
    fields: [
      { k: "salas", t: "textarea", l: "Salas ou cabines (nome de cada uma)", h: "Ex.: Sala 1, Sala 2, Cabine de laser. Deixe em branco se não quer controlar sala." },
    ],
  },
  {
    id: "servicos",
    title: "Serviços e procedimentos",
    desc: "A tabela completa, um bloco por serviço",
    intro: "Preencha todos os serviços que a clínica faz. Preparo, cuidados e prazo de retorno alimentam as mensagens automáticas e a reativação de clientes.",
    fields: [
      {
        k: "lista",
        t: "list",
        l: "Serviços",
        req: true,
        add: "Adicionar serviço",
        name: "Serviço",
        f: [
          { k: "nome", t: "text", l: "Nome do serviço", req: true, h: "Exatamente como as clientes chamam. A atendente reconhece o serviço por esse nome." },
          { k: "categoria", t: "text", l: "Categoria", half: true, h: "Facial, Corporal, Injetáveis..." },
          { k: "duracao", t: "number", l: "Duração (minutos)", half: true },
          { k: "preco", t: "text", l: "Preço (R$)", half: true, h: "A atendente informa como \"a partir de\". Deixe em branco se o valor depende de avaliação." },
          { k: "retorno", t: "number", l: "Prazo de retorno (dias)", half: true, h: "De quantos em quantos dias a cliente deve voltar. Ex.: limpeza 45, botox 120." },
          { k: "descricao", t: "textarea", l: "O que é e para que serve (2 a 4 linhas)", h: "Como a atendente deve explicar para a cliente." },
          { k: "contra", t: "textarea", l: "Contraindicações", h: "Gestantes, lactantes, uso de ácido, doenças de pele..." },
          { k: "pre", t: "textarea", l: "Orientações ANTES do procedimento", h: "A cliente recebe no WhatsApp um dia antes. Ex.: \"Evite álcool 24h antes. Venha sem maquiagem.\"" },
          { k: "pos", t: "textarea", l: "Orientações DEPOIS do procedimento", h: "Enviadas após o atendimento. Ex.: \"Evite sol por 24h.\"" },
          { k: "retoque", t: "number", l: "Retoque (dias)", half: true, h: "Só para serviços com retoque incluso. Ex.: botox 15." },
          { k: "acomp", t: "text", l: "Dias de acompanhamento depois", half: true, h: "Quando mandar \"como está o resultado?\". Ex.: 7, 30. Em branco = não manda." },
          { k: "ofertar", t: "radio", l: "Pode aparecer para as clientes agora?", half: true, o: ["Sim", "Ainda não"] },
          { k: "junto", t: "text", l: "Serviços que podem ser oferecidos junto com este", h: "Ex.: quem pede Limpeza de pele pode receber oferta de Peeling. A atendente só sugere o que estiver aqui, uma vez, sem insistir." },
          { k: "promo", t: "text", l: "Promoção vigente e até quando", h: "Ex.: 2ª sessão com 20% de desconto, válida até 30/11." },
        ],
      },
    ],
  },
  {
    id: "pacotes",
    title: "Pacotes de sessões",
    desc: "Se a clínica vende pacotes",
    fields: [
      { k: "vende", t: "radio", l: "A clínica vende pacotes de sessões?", req: true, o: SN },
      {
        k: "lista",
        t: "list",
        l: "Pacotes",
        reqIf: (s) => s.vende === "Sim",
        add: "Adicionar pacote",
        name: "Pacote",
        f: [
          { k: "nome", t: "text", l: "Nome do pacote", req: true, h: "Ex.: Drenagem - 10 sessões." },
          { k: "servico", t: "text", l: "Serviço incluído", h: "Hoje cada pacote é de um único serviço." },
          { k: "sessoes", t: "number", l: "Quantidade de sessões", half: true },
          { k: "preco", t: "text", l: "Preço do pacote (R$)", half: true },
          { k: "validade", t: "number", l: "Validade (dias a partir da compra)", h: "Em branco = sem validade." },
        ],
      },
      { k: "andamento", t: "textarea", l: "Clientes com pacotes em andamento hoje", h: "Nome, pacote, sessões já usadas, valor pago, data da compra. Pode mandar em planilha." },
    ],
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    desc: "O número que será conectado e como",
    fields: [
      { k: "numero", t: "tel", l: "Número de WhatsApp da clínica", req: true },
      { k: "onde", t: "radio", l: "Onde esse número está hoje?", req: true, o: ["No app WhatsApp Business do celular", "No WhatsApp comum (verde)", "É um chip novo, ainda sem WhatsApp", "Já está na API oficial por outra empresa"] },
      { k: "coex", t: "radio", l: "Quer continuar usando esse número no celular, além do painel?", req: true, o: ["Sim, nos dois (recomendado)", "Não, só no painel"] },
      { k: "importar", t: "radio", l: "Quer trazer os contatos e as conversas dos últimos 6 meses do app para o painel?", o: SN, h: "Só pode ser feito uma vez, logo depois da conexão, e precisa aceitar na tela do celular." },
      { k: "exibicao", t: "text", l: "Nome que deve aparecer para as clientes como remetente", req: true, h: "Nome de exibição da conta Business. Ex.: Clínica Bella." },
      { k: "facebook", t: "text", l: "Quem tem o login do Facebook ou Meta Business da empresa e o celular com o chip?", req: true, h: "A conexão é feita ao vivo: janela da Meta mais um código que chega no celular. Precisa dessa pessoa na hora." },
      { k: "segundo", t: "text", l: "Haverá um segundo número? Qual e para quê?", h: "Ex.: um para recepção e outro para campanhas. Depende do plano." },
    ],
  },
  {
    id: "ana",
    title: "Atendente virtual",
    desc: "Nome, tom de voz e limites",
    intro: "A atendente responde 24 horas, consulta a agenda real, marca horários e passa para uma pessoa quando não sabe ou quando o assunto é de saúde. As clientes não sabem que é um sistema.",
    fields: [
      { k: "ligar", t: "radio", l: "A atendente deve responder as clientes desde o primeiro dia?", req: true, o: ["Sim, desde o início", "Começar só com lembretes e ligar depois"] },
      { k: "nome", t: "text", l: "Nome da atendente", req: true, half: true, h: "Padrão: Ana." },
      { k: "ofertas", t: "radio", l: "Pode sugerir um serviço complementar?", req: true, half: true, o: SN, h: "Só os marcados em \"oferecidos junto\"." },
      { k: "tom", t: "radio", l: "Tom de voz", req: true, o: ["Acolhedora (calorosa e próxima, usa um coração)", "Elegante (sóbria e profissional, quase sem emoji)", "Animada (jovem e leve)"] },
      { k: "estouro", t: "radio", l: "Se a franquia mensal acabar antes do fim do mês:", req: true, h: "Seu plano inclui uma franquia mensal de uso da atendente e de mensagens oficiais da Meta (o gasto aparece em tempo real em Configurações, com aviso em 80% e 100%). Respostas dentro de 24 horas da mensagem da cliente não contam.", o: ["Pausar a atendente e as mensagens automáticas pagas até o mês seguinte (a equipe responde pelo painel)", "Continuar e pagar o excedente na próxima fatura (com 20% de acréscimo)"] },
      {
        k: "faq",
        t: "list",
        l: "Perguntas que as clientes mais fazem, com a resposta oficial",
        add: "Adicionar pergunta",
        name: "Pergunta",
        f: [
          { k: "p", t: "text", l: "Pergunta", req: true, h: "Ex.: Pode fazer botox grávida? Quanto tempo dura o resultado?" },
          { k: "r", t: "textarea", l: "Resposta, do jeito que a atendente deve responder", req: true },
        ],
      },
    ],
  },
  {
    id: "auto",
    title: "Mensagens automáticas",
    desc: "Quais ligar e se alguém revisa antes de enviar",
    intro: "Cada mensagem pode sair sozinha ou entrar numa fila para alguém aprovar. Os textos padrão já existem; só escreva se quiser um texto próprio.",
    fields: [
      { k: "modo", t: "radio", l: "Como começar?", req: true, h: "Duas mensagens saem sempre sozinhas, mesmo no modo de revisão: o aviso de 45 minutos antes e a resposta automática quando a cliente confirma.", o: ["Tudo automático (recomendado)", "Revisar cada mensagem antes de enviar nas primeiras semanas"] },
      {
        k: "ligar",
        t: "check",
        l: "Quais mensagens ligar?",
        req: true,
        h: "Sugestão: todas.",
        o: [
          "Lembrete um dia antes pedindo confirmação",
          "Reforço 2 horas antes para quem não confirmou",
          "Aviso 45 minutos antes",
          "Orientações de preparo antes do procedimento",
          "Resposta automática quando a cliente confirma",
          "Mensagem para remarcar quando a cliente falta (e nova tentativa 3 dias depois)",
          "Agradecimento e cuidados de casa 2 horas depois do atendimento",
          "Pedir nota de 0 a 10 no dia seguinte (notas altas recebem o link do Google)",
          "Oferecer retoque na data certa",
          "Perguntar como está o resultado alguns dias depois (nos dias marcados em cada serviço)",
          "Parabéns no aniversário",
          "Chamar de volta quem passou do prazo de retorno de um serviço",
          "Chamar de volta quem está sem visita há mais de 90 dias",
          "Oferecer horários vagos dos próximos 3 dias a quem está com retorno atrasado",
          "Convite de renovação quando o pacote está acabando ou vencendo",
        ],
      },
      { k: "aniv_mimo", t: "text", l: "Tem algum mimo ou desconto de aniversário para citar?" },
      { k: "revisar", t: "text", l: "Quais dessas mensagens vocês querem revisar antes de enviar?", h: "Em branco = segue a escolha acima." },
      { k: "textos", t: "textarea", l: "Textos próprios", h: "Se quiser substituir algum texto padrão, escreva qual mensagem e o texto. Pode usar {{nome}}, {{procedimento}}, {{data}}, {{hora}}, {{profissional}} e {{clinica}}." },
    ],
  },
  {
    id: "online",
    title: "Agendamento online",
    desc: "Link para a cliente marcar sozinha",
    fields: [
      { k: "quer", t: "radio", l: "Quer um link público de agendamento (para a bio do Instagram) em que a cliente escolhe o serviço, vê horários livres e marca?", req: true, o: SN },
      { k: "slug", t: "text", l: "Nome curto para o link", reqIf: (s) => s.quer === "Sim", h: "Ex.: clinica-bella vira vesaliusx.com.br/agendar/clinica-bella. Só letras minúsculas, números e hífen. Dê duas opções." },
    ],
  },
  {
    id: "clientes",
    title: "Clientes e documentos",
    desc: "A base atual, termos e fichas",
    fields: [
      { k: "base", t: "radio", l: "Vocês têm uma lista de clientes para importar?", req: true, o: ["Sim, em planilha ou app (vamos enviar)", "Sim, mas só em papel ou no celular", "Não, começamos do zero"], h: "A planilha pode ter: nome, WhatsApp, e-mail, nascimento, última visita, último procedimento, total gasto." },
      { k: "origens", t: "text", l: "Como as clientes costumam chegar até vocês?", h: "Ex.: Instagram, indicação, Google. Vira a lista de origem da ficha." },
      { k: "agenda", t: "textarea", l: "Agenda já marcada para as próximas semanas", h: "Cliente, serviço, profissional, data e hora. Pode mandar em foto ou planilha." },
      { k: "termos", t: "radio", l: "Termos de consentimento", req: true, o: ["Temos os nossos (vamos enviar o texto)", "Usar o modelo padrão do VesaliusX", "Não usamos termo"] },
      { k: "anamnese", t: "radio", l: "Ficha de anamnese", req: true, o: ["Temos a nossa (vamos enviar)", "Usar a ficha padrão", "Não usamos"], h: "A padrão pergunta alergias, medicamentos, doenças crônicas, gestante, lactante e marca-passo." },
    ],
  },
];

// ── Respostas ───────────────────────────────────────────────────────────

export type OnbAnswers = Record<string, Record<string, unknown>>;
export interface OnbHoursDay {
  on: boolean;
  a: string;
  f: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const INT_RE = /^\d{1,6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_LIST = 80;
/** Tamanho máximo por resposta (a página limita o campo; o servidor corta no mesmo valor). */
export const ONBOARDING_MAX_LEN = { textarea: 20_000, text: 500 } as const;

function cleanString(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

function cleanField(f: OnbField, v: unknown): unknown {
  switch (f.t) {
    case "sub":
      return undefined;
    case "textarea":
      return cleanString(v, ONBOARDING_MAX_LEN.textarea);
    case "text":
    case "tel":
    case "email":
    case "url":
    case "number":
      return cleanString(v, ONBOARDING_MAX_LEN.text);
    case "select":
    case "radio": {
      const s = cleanString(v, 200);
      return f.o?.includes(s) ? s : "";
    }
    case "check": {
      if (!Array.isArray(v)) return [];
      return v.filter((x): x is string => typeof x === "string" && (f.o?.includes(x) ?? false)).slice(0, 50);
    }
    case "hours": {
      const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      const out: Record<string, OnbHoursDay> = {};
      for (const [k] of ONBOARDING_DAYS) {
        const d = src[k] && typeof src[k] === "object" ? (src[k] as Record<string, unknown>) : {};
        const a = cleanString(d.a, 5);
        const fch = cleanString(d.f, 5);
        out[k] = { on: d.on === true, a: TIME_RE.test(a) ? a : "", f: TIME_RE.test(fch) ? fch : "" };
      }
      return out;
    }
    case "list": {
      if (!Array.isArray(v)) return [];
      return v
        .map((item) => {
          const src = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          const out: Record<string, unknown> = {};
          for (const sf of f.f ?? []) {
            const c = cleanField(sf, src[sf.k]);
            if (c !== undefined) out[sf.k] = c;
          }
          return out;
        })
        .filter((item) => Object.values(item).some((x) => (Array.isArray(x) ? x.length > 0 : String(x ?? "").trim() !== "")))
        .slice(0, MAX_LIST);
    }
  }
}

/** Mantém só as perguntas conhecidas, com tamanho limitado — o que vai para o banco. */
export function sanitizeOnboardingAnswers(raw: unknown): OnbAnswers {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: OnbAnswers = {};
  for (const sec of ONBOARDING_SECTIONS) {
    const s = src[sec.id] && typeof src[sec.id] === "object" ? (src[sec.id] as Record<string, unknown>) : {};
    const o: Record<string, unknown> = {};
    for (const f of sec.fields) {
      const c = cleanField(f, s[f.k]);
      if (c !== undefined) o[f.k] = c;
    }
    out[sec.id] = o;
  }
  return out;
}

export function isAnswered(f: OnbField, v: unknown): boolean {
  if (f.t === "sub") return true;
  if (f.t === "list") return Array.isArray(v) && v.some((it) => it && typeof it === "object" && Object.values(it as object).some((x) => (Array.isArray(x) ? x.length > 0 : String(x ?? "").trim() !== "")));
  if (f.t === "hours") return !!v && typeof v === "object" && Object.values(v as Record<string, OnbHoursDay>).some((d) => d?.on);
  if (f.t === "check") return Array.isArray(v) && v.length > 0;
  return String(v ?? "").trim() !== "";
}

/** Valor preenchido com formato que o sistema não aceita (número inteiro, e-mail). */
function badFormat(f: OnbField, v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (s === "") return false;
  if (f.t === "number") return !INT_RE.test(s);
  if (f.t === "email") return !EMAIL_RE.test(s);
  return false;
}

/** Obrigatória agora? (fixa ou condicional à própria seção) */
export function isRequired(f: OnbField, section: Record<string, unknown> | undefined): boolean {
  return Boolean(f.req) || Boolean(f.reqIf?.(section ?? {}));
}

/**
 * Pendências que impedem o envio: obrigatórias vazias, formato inválido, dia aberto sem
 * horário válido e item de lista sem o campo que o identifica. Cada item traz a seção e a
 * pergunta, no formato "Seção: Pergunta", que a página usa para levar até o campo.
 */
export function missingRequired(a: OnbAnswers): string[] {
  const out: string[] = [];
  for (const sec of ONBOARDING_SECTIONS) {
    const s = a[sec.id] ?? {};
    for (const f of sec.fields) {
      const v = s[f.k];
      if (isRequired(f, s) && !isAnswered(f, v)) {
        out.push(`${sec.title}: ${f.l}`);
        continue;
      }
      if (badFormat(f, v)) {
        out.push(`${sec.title}: ${f.l} (${f.t === "email" ? "e-mail inválido" : "só números inteiros"})`);
        continue;
      }
      if (f.t === "hours" && v && typeof v === "object") {
        const h = v as Record<string, OnbHoursDay>;
        for (const [k, n] of ONBOARDING_DAYS) {
          const d = h[k];
          if (!d?.on) continue;
          if (!TIME_RE.test(d.a) || !TIME_RE.test(d.f) || d.a >= d.f) out.push(`${sec.title}: ${f.l} (${n}: horário inválido)`);
        }
      }
      if (f.t === "list" && Array.isArray(v)) {
        (v as Record<string, unknown>[]).forEach((item, i) => {
          if (!item || typeof item !== "object") return;
          const filled = Object.values(item).some((x) => (Array.isArray(x) ? x.length > 0 : String(x ?? "").trim() !== ""));
          if (!filled) return; // bloco em branco é descartado na limpeza
          for (const sf of f.f ?? []) {
            if (sf.req && !isAnswered(sf, item[sf.k])) out.push(`${sec.title}: ${f.name ?? "Item"} ${i + 1} sem ${sf.l.toLowerCase()}`);
            else if (badFormat(sf, item[sf.k])) out.push(`${sec.title}: ${f.name ?? "Item"} ${i + 1}, ${sf.l.toLowerCase()} (${sf.t === "email" ? "e-mail inválido" : "só números inteiros"})`);
          }
        });
      }
    }
  }
  return out;
}

/** Quem mandou: nome da clínica e contato, para a lista do /admin. */
export function onboardingSummary(a: OnbAnswers): { clinicName: string; contactName: string; contactPhone: string; contactEmail: string } {
  return {
    clinicName: cleanString(a.clinica?.nome, 120) || "(sem nome)",
    contactName: cleanString(a.equipe?.dona_nome, 120),
    contactPhone: cleanString(a.whatsapp?.numero, 40) || cleanString(a.clinica?.tel, 40),
    contactEmail: cleanString(a.equipe?.dona_email, 120),
  };
}

export interface OnbEntry {
  label: string;
  value: string;
  /** Item de lista: rótulo do item (ex.: "Serviço 2") e seus pares. */
  items?: { title: string; pairs: { label: string; value: string }[] }[];
}

function hoursText(v: unknown): string {
  const h = (v && typeof v === "object" ? v : {}) as Record<string, OnbHoursDay>;
  return ONBOARDING_DAYS.map(([k, n]) => `${n}: ${h[k]?.on ? `${h[k].a || "?"} às ${h[k].f || "?"}` : "fechado"}`).join("\n");
}

function valueText(f: OnbField, v: unknown): string {
  if (f.t === "hours") return hoursText(v);
  if (f.t === "check") return Array.isArray(v) && v.length ? v.map((x) => `• ${x}`).join("\n") : "";
  return String(v ?? "").trim();
}

/** Respostas achatadas por seção, prontas para a tela do /admin e para o PDF. */
export function onboardingEntries(a: OnbAnswers): { id: string; title: string; entries: OnbEntry[] }[] {
  return ONBOARDING_SECTIONS.map((sec) => ({
    id: sec.id,
    title: sec.title,
    entries: sec.fields
      .filter((f) => f.t !== "sub")
      .map((f): OnbEntry => {
        const v = a[sec.id]?.[f.k];
        if (f.t === "list") {
          const arr = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
          return {
            label: f.l,
            value: arr.length ? `${arr.length} ${arr.length === 1 ? "item" : "itens"}` : "",
            items: arr.map((it, i) => ({
              title: `${f.name ?? "Item"} ${i + 1}${it.nome ? `: ${String(it.nome)}` : it.p ? `: ${String(it.p)}` : ""}`,
              pairs: (f.f ?? []).map((sf) => ({ label: sf.l, value: valueText(sf, it[sf.k]) })).filter((p) => p.value !== ""),
            })),
          };
        }
        return { label: f.l, value: valueText(f, v) };
      }),
  }));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const nl = (s: string) => esc(s).replace(/\n/g, "<br>");

/** HTML completo do formulário respondido (vira PDF pelo Gotenberg). */
export function onboardingHtml(a: OnbAnswers, meta: { id: string; receivedAt: string }): string {
  const s = onboardingSummary(a);
  const sections = onboardingEntries(a)
    .map(
      (sec) => `
    <section>
      <h2>${esc(sec.title)}</h2>
      <table>
        ${sec.entries
          .map((e) => {
            if (e.items) {
              const inner = e.items.length
                ? e.items
                    .map(
                      (it) => `<div class="item"><div class="item-title">${esc(it.title)}</div><table class="inner">${it.pairs
                        .map((p) => `<tr><td class="k">${esc(p.label)}</td><td>${nl(p.value)}</td></tr>`)
                        .join("")}</table></div>`,
                    )
                    .join("")
                : `<span class="empty">nenhum</span>`;
              return `<tr class="list"><td class="k">${esc(e.label)}</td><td>${inner}</td></tr>`;
            }
            return `<tr><td class="k">${esc(e.label)}</td><td>${e.value ? nl(e.value) : `<span class="empty">não respondido</span>`}</td></tr>`;
          })
          .join("")}
      </table>
    </section>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Implantação - ${esc(s.clinicName)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #1c1917; line-height: 1.45; }
  .brand { color: #0f766e; font-weight: 700; font-size: 13px; letter-spacing: .02em; }
  h1 { font-size: 20px; margin: 4px 0 2px; }
  .meta { color: #78716c; font-size: 10px; margin-bottom: 14px; }
  section { margin-top: 14px; }
  h2 { break-after: avoid; }
  tr { break-inside: avoid; }
  tr.list { break-inside: auto; }
  h2 { font-size: 13px; color: #0f766e; border-bottom: 1px solid #d6d3d1; padding-bottom: 3px; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td { vertical-align: top; padding: 3px 6px 3px 0; border-bottom: 1px solid #f5f5f4; overflow-wrap: anywhere; }
  td.k { width: 34%; color: #57534e; font-weight: 600; }
  .empty { color: #a8a29e; font-style: italic; }
  .item { border: 1px solid #e7e5e4; border-radius: 6px; padding: 6px 8px; margin: 4px 0; page-break-inside: avoid; }
  .item-title { font-weight: 700; margin-bottom: 2px; }
  table.inner td { border: 0; padding: 1px 6px 1px 0; }
  table.inner td.k { width: 36%; font-weight: 500; }
</style></head><body>
  <div class="brand">VesaliusX · Formulário de implantação</div>
  <h1>${esc(s.clinicName)}</h1>
  <div class="meta">Responsável: ${esc(s.contactName || "—")} · ${esc(s.contactEmail || "—")} · WhatsApp ${esc(s.contactPhone || "—")}<br>Recebido em ${esc(meta.receivedAt)} · protocolo ${esc(meta.id.slice(0, 8))}</div>
  ${sections}
</body></html>`;
}
