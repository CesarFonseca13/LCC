/**
 * Termos de Uso da plataforma — texto versionado no código para que o aceite
 * registrado no banco aponte para uma versão exata. Mudou o texto de forma
 * relevante? Suba TERMS_VERSION: todo usuário precisa aceitar de novo.
 */
export const TERMS_VERSION = "2026-09-15";

export const TERMS_TITLE = "Termos de Uso da plataforma VesaliusX";

export interface TermsSection {
  title: string;
  /** Parágrafos; itens iniciados com "- " viram lista. */
  paragraphs: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: "1. Quem somos e o que você está aceitando",
    paragraphs: [
      "A VesaliusX é uma plataforma de gestão e atendimento para clínicas, desenvolvida e operada pela Billions Technology (“Billions”, “nós”). Estes Termos de Uso regulam o acesso e o uso da plataforma pela clínica contratante (“Clínica”) e por cada pessoa que acessa a conta da Clínica (“Usuário”).",
      "Ao acessar a plataforma pela primeira vez, o Usuário declara que leu, entendeu e concorda com estes Termos, em seu nome e, quando for a administradora da conta, em nome da Clínica. Se não concordar, não utilize a plataforma.",
    ],
  },
  {
    title: "2. O que a plataforma faz",
    paragraphs: [
      "A plataforma reúne, entre outras funções, agenda, atendimento às clientes pelo WhatsApp com assistente virtual, funil de vendas, orçamentos, termos de consentimento com assinatura eletrônica, financeiro, estoque, comissões, campanhas e relatórios. As funcionalidades podem ser ampliadas, alteradas ou descontinuadas ao longo do tempo, sempre buscando manter o serviço útil e seguro para a Clínica.",
    ],
  },
  {
    title: "3. Conta, acessos e responsabilidades",
    paragraphs: [
      "Cada Usuário recebe credenciais pessoais e intransferíveis e é responsável por mantê-las em sigilo. A Clínica administra os acessos da própria equipe (criação, papéis e desativação) e responde por tudo o que for feito por meio da sua conta.",
      "A Clínica se compromete a usar a plataforma apenas para fins lícitos, ligados à sua atividade, e a nos avisar imediatamente se suspeitar de uso indevido ou acesso não autorizado.",
    ],
  },
  {
    title: "4. Integração com o WhatsApp",
    paragraphs: [
      "A plataforma oferece duas formas de conectar o número da Clínica ao WhatsApp, à escolha da Clínica em Configurações: (a) a WhatsApp Business Platform, API oficial da Meta, integração autorizada pelo WhatsApp, na qual mensagens enviadas pela Clínica fora da janela de 24 horas de atendimento só podem usar modelos aprovados pela Meta e são cobradas pela própria Meta conforme a sua tabela; ou (b) a conexão por QR code, feita por meio da Evolution API, uma tecnologia de integração de código aberto mantida por terceiros, que conecta o número de forma semelhante ao WhatsApp Web — e não pela API oficial.",
      "Ao optar pela conexão por QR code, a Clínica reconhece e aceita que:",
      "- a integração depende do funcionamento do WhatsApp e pode sofrer instabilidades, mudanças ou interrupções fora do nosso controle, inclusive exigir nova leitura do QR code para reconectar o número;",
      "- o WhatsApp pode, a seu exclusivo critério, restringir, suspender ou banir números que, na avaliação dele, violem os seus Termos de Serviço ou suas políticas — por exemplo, por envio de mensagens em volume, para contatos que não iniciaram conversa ou que as marquem como spam. Existe, portanto, um risco real de bloqueio ou banimento do número conectado, que a Clínica declara conhecer e assumir;",
      "- a Billions não se responsabiliza por bloqueios, suspensões ou banimentos aplicados pelo WhatsApp ou pela Meta, nem por perdas decorrentes deles, e não garante a recuperação de números afetados.",
      "Para reduzir esse risco, recomendamos: usar um número exclusivo da Clínica (de preferência um chip já em uso há algum tempo), manter automações e campanhas em volumes moderados, enviar mensagens apenas a clientes que já se relacionam com a Clínica e respeitar pedidos de quem não quiser mais receber mensagens — ou, para eliminar o risco, conectar o número pela API oficial da Meta. Em qualquer das duas formas, a Clínica é responsável por cumprir os Termos de Serviço do WhatsApp, as políticas da Meta e a legislação aplicável, inclusive as regras sobre comunicações comerciais.",
    ],
  },
  {
    title: "5. Assistente virtual e automações",
    paragraphs: [
      "A assistente virtual responde às clientes com base no catálogo, na base de conhecimento e nas configurações definidas pela Clínica, usando modelos de inteligência artificial. Apesar dos cuidados adotados, respostas geradas por IA podem conter imprecisões. A Clínica é responsável por revisar suas configurações, manter as informações atualizadas e acompanhar as conversas e as aprovações pendentes.",
      "As mensagens enviadas pela assistente e pelas automações são enviadas em nome da Clínica. A assistente não substitui a avaliação de um profissional de saúde nem presta diagnóstico ou orientação clínica.",
    ],
  },
  {
    title: "6. Dados pessoais e privacidade (LGPD)",
    paragraphs: [
      "Em relação aos dados pessoais das clientes e da equipe, a Clínica é a controladora e a Billions atua como operadora, tratando os dados apenas para prestar o serviço, conforme estes Termos e as instruções da Clínica. Cabe à Clínica ter base legal para o tratamento, informar as suas clientes e coletar somente os dados necessários — especialmente dados de saúde.",
      "Adotamos medidas de segurança como isolamento dos dados por clínica, criptografia de credenciais sensíveis, controle de acesso por papéis e cópias de segurança periódicas. Para prestar o serviço, utilizamos fornecedores de infraestrutura e de modelos de inteligência artificial, que podem processar o conteúdo das conversas necessário para gerar as respostas.",
      "Ao término do contrato, a Clínica pode solicitar a exportação dos seus dados; após o prazo combinado, eles são excluídos, ressalvadas as obrigações legais de guarda.",
    ],
  },
  {
    title: "7. Termos de consentimento, anamneses e documentos",
    paragraphs: [
      "Os modelos de termos de consentimento, anamneses e demais documentos são de responsabilidade da Clínica e devem ser revisados pelo seu responsável técnico antes do uso. A plataforma registra evidências da assinatura eletrônica (data e hora, endereço IP e resumo criptográfico do conteúdo) como assinatura eletrônica simples, nos termos da legislação brasileira.",
      "A Billions não presta assessoria jurídica, regulatória ou clínica; a adequação dos documentos à atividade da Clínica é responsabilidade dela.",
    ],
  },
  {
    title: "8. Disponibilidade, suporte e mudanças",
    paragraphs: [
      "Trabalhamos para manter a plataforma disponível e estável, mas não garantimos funcionamento ininterrupto. Manutenções programadas serão, sempre que possível, avisadas com antecedência. O suporte é prestado pelos canais combinados com a Clínica.",
    ],
  },
  {
    title: "9. Plano, pagamento e cancelamento",
    paragraphs: [
      "As condições comerciais (plano, valores, prazos e forma de pagamento) são as definidas na proposta ou no contrato firmado com a Clínica. O atraso no pagamento pode levar à suspensão do acesso até a regularização. A Clínica pode cancelar o serviço a qualquer momento, observadas as condições comerciais contratadas.",
    ],
  },
  {
    title: "10. Propriedade intelectual",
    paragraphs: [
      "A plataforma, sua marca, seu código e seus materiais pertencem à Billions. Os dados inseridos pela Clínica — cadastros, conversas, documentos e registros — pertencem à Clínica, que nos autoriza a tratá-los apenas para prestar o serviço.",
    ],
  },
  {
    title: "11. Limitação de responsabilidade",
    paragraphs: [
      "Na extensão permitida pela lei, a Billions não responde por lucros cessantes, danos indiretos, decisões tomadas com base nas informações da plataforma, atos de terceiros (como WhatsApp, Meta, operadoras e provedores de IA), falhas de conexão da Clínica ou uso em desacordo com estes Termos. Em qualquer hipótese, a responsabilidade total da Billions fica limitada aos valores pagos pela Clínica nos 12 meses anteriores ao evento.",
    ],
  },
  {
    title: "12. Alterações destes Termos",
    paragraphs: [
      "Estes Termos podem ser atualizados. Quando a mudança for relevante, a nova versão será apresentada no próximo acesso e o uso continuado dependerá do novo aceite. A versão vigente fica sempre disponível na plataforma.",
    ],
  },
  {
    title: "13. Lei aplicável e foro",
    paragraphs: [
      "Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca da sede da Billions Technology para resolver qualquer questão decorrente deles, com renúncia a qualquer outro, por mais privilegiado que seja.",
    ],
  },
];

/** "15/09/2026" a partir de TERMS_VERSION — para exibir na tela. */
export function termsVersionLabel(version: string = TERMS_VERSION): string {
  const [y, m, d] = version.split("-");
  return `${d}/${m}/${y}`;
}
