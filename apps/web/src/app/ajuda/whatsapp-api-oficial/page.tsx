import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "API oficial do WhatsApp" };

/** Guia público: o que é, quanto custa e como a clínica cadastra o próprio app na Meta
 *  (cada clínica paga o próprio uso direto para a Meta). */

const PASSOS: { titulo: string; itens: string[] }[] = [
  {
    titulo: "1. Tenha uma conta no Meta Business",
    itens: [
      "Acesse business.facebook.com e entre com a conta do Facebook da responsável pela clínica. Se a clínica ainda não tem um portfólio de empresas (Business Portfolio), crie um com o nome e o CNPJ da clínica.",
      "Em Configurações da empresa → Central de segurança → Verificação da empresa, envie os documentos (cartão CNPJ, comprovante de endereço). A verificação leva de algumas horas a alguns dias e libera o uso do número próprio com limites normais.",
    ],
  },
  {
    titulo: "2. Crie o app da clínica na Meta",
    itens: [
      "Acesse developers.facebook.com → Meus apps → Criar app. Escolha o caso de uso “Outro”, tipo “Empresa”, dê um nome (ex.: “Clínica Bella — WhatsApp”) e vincule ao portfólio da clínica.",
      "No painel do app, em Adicionar produtos, adicione o WhatsApp.",
    ],
  },
  {
    titulo: "3. Cadastre o número da clínica",
    itens: [
      "Em WhatsApp → Configuração da API, clique em Adicionar número de telefone. O número precisa ser exclusivo: se hoje ele está no aplicativo do WhatsApp (comum ou Business) do celular, exclua a conta lá antes — a API oficial não convive com o app no mesmo número.",
      "Informe o nome de exibição (o nome que as clientes veem — precisa bater com o nome da clínica) e confirme o código recebido por SMS ou ligação.",
      "Anote a Identificação do número de telefone (Phone Number ID) e a Identificação da conta do WhatsApp Business (WABA ID) que aparecem nessa tela.",
    ],
  },
  {
    titulo: "4. Adicione a forma de pagamento",
    itens: [
      "Em business.facebook.com → WhatsApp Manager → Configurações da conta → Métodos de pagamento, cadastre um cartão de crédito. É por ele que a Meta cobra as mensagens de modelo — direto da clínica, sem intermediário.",
      "Sem forma de pagamento a conta fica limitada e as mensagens fora da janela de 24 h não saem.",
    ],
  },
  {
    titulo: "5. Gere o token permanente",
    itens: [
      "Em Configurações da empresa → Usuários → Usuários do sistema, crie um usuário do sistema com função Administrador (ex.: “VesaliusX”).",
      "Clique em Adicionar ativos: marque o app criado (Controle total) e a conta do WhatsApp Business (Gerenciar).",
      "Clique em Gerar novo token, escolha o app, expiração “Nunca”, e marque as permissões whatsapp_business_messaging e whatsapp_business_management. Copie o token — ele aparece uma única vez.",
    ],
  },
  {
    titulo: "6. Copie a chave secreta do app",
    itens: [
      "No painel do app → Configurações do app → Básico → Chave secreta do app → Mostrar. É com ela que o VesaliusX confere que cada mensagem recebida veio mesmo da Meta.",
    ],
  },
  {
    titulo: "7. Cadastre o webhook",
    itens: [
      "No painel do app → WhatsApp → Configuração → Webhook → Editar. Cole a URL de callback e o token de verificação que aparecem no VesaliusX (Configurações → Números do WhatsApp → API oficial da Meta) e clique em Verificar e salvar.",
      "Depois, em Campos do webhook → Gerenciar, assine o campo messages.",
    ],
  },
  {
    titulo: "8. Cole tudo no VesaliusX",
    itens: [
      "Em Configurações → Números do WhatsApp → Conectar → API oficial da Meta, cole o Phone Number ID, o WABA ID, o token permanente e a chave secreta do app, e clique em Conectar.",
      "O sistema valida as credenciais na Meta na hora, assina os webhooks e envia para aprovação os 17 modelos de mensagem usados nos lembretes, confirmações, termos e avisos. A Meta aprova em até 24 horas (normalmente em minutos); até lá, conversas respondidas em 24 h já funcionam.",
    ],
  },
];

const FAQ: { p: string; r: string }[] = [
  {
    p: "Posso usar o número que já está no WhatsApp da clínica?",
    r: "Sim, mas ele sai do aplicativo do celular: na API oficial o número passa a existir só na plataforma da Meta, e o atendimento é feito pelo painel do VesaliusX (com a assistente e a equipe). Se a clínica quer manter o WhatsApp no celular, use um número novo para a API.",
  },
  {
    p: "Quanto vou pagar por mês?",
    r: "Depende do volume de mensagens que a clínica inicia fora da janela de 24 h. Uma clínica pequena, com cerca de 150 atendimentos por mês e reativações moderadas, fica na faixa de R$ 30 a R$ 100 por mês pagos à Meta. Conversas em que a cliente escreveu nas últimas 24 h são gratuitas.",
  },
  {
    p: "O que acontece se um modelo for recusado pela Meta?",
    r: "O painel mostra o modelo com problema. Enquanto isso, a automação correspondente não sai fora da janela de 24 h (a mensagem fica marcada como não enviada, com o motivo). Avise o suporte para ajustar o texto e reenviar para aprovação.",
  },
  {
    p: "Existe limite de mensagens?",
    r: "Sim, definido pela Meta por número: começa em 250 conversas iniciadas pela empresa a cada 24 h (1.000 com a empresa verificada) e sobe automaticamente conforme a qualidade do número. Para uma clínica isso raramente é atingido.",
  },
  {
    p: "E se eu quiser continuar por QR code?",
    r: "Continua disponível. É grátis por mensagem, mas não é a integração oficial: o WhatsApp pode bloquear o número. Muitas clínicas usam os dois — a API oficial para lembretes e confirmações e um número por QR code para campanhas.",
  },
];

export default function GuiaApiOficialPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-lg font-semibold tracking-tight text-teal-800">
          Vesalius<span className="text-emerald-500">X</span>
        </Link>
        <p className="mt-6 text-xs font-medium uppercase tracking-wide text-teal-700">Guia da clínica</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">
          WhatsApp pela API oficial da Meta
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          A integração autorizada pelo WhatsApp: sem risco de bloqueio do número. A clínica cadastra o
          próprio app na Meta e paga as mensagens diretamente a ela — este guia mostra quanto custa e
          como fazer, passo a passo.
        </p>

        <section className="mt-8 rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-base font-semibold text-stone-800">Quanto custa</h2>
          <p className="mt-2 text-sm text-stone-600">
            A Meta cobra <strong>por mensagem de modelo entregue</strong>, e só quando é a clínica que
            inicia a conversa fora da janela de 24 h. Tudo o que é resposta a uma cliente que escreveu
            nas últimas 24 h é gratuito. Valores de referência para o Brasil em 2026 (a Meta pode
            reajustar a cada trimestre; a partir de julho de 2026 a cobrança é em reais):
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="py-2 pr-4 font-medium">Tipo de mensagem</th>
                  <th className="py-2 pr-4 font-medium">Exemplos no VesaliusX</th>
                  <th className="py-2 font-medium">Custo por mensagem</th>
                </tr>
              </thead>
              <tbody className="text-stone-700">
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4">Resposta em conversa aberta (até 24 h)</td>
                  <td className="py-2 pr-4">Atendimento da assistente e da equipe, confirmações respondidas</td>
                  <td className="py-2 font-medium text-emerald-700">Grátis</td>
                </tr>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4">Utilidade (fora das 24 h)</td>
                  <td className="py-2 pr-4">Lembrete, confirmação, pré-cuidados, pós-atendimento, termo, orçamento</td>
                  <td className="py-2">≈ R$ 0,03 a 0,05</td>
                </tr>
                <tr className="border-b border-stone-100">
                  <td className="py-2 pr-4">Marketing (fora das 24 h)</td>
                  <td className="py-2 pr-4">Reativação, aniversário, retoque, horário livre, renovação de pacote</td>
                  <td className="py-2">≈ R$ 0,31 a 0,35 (US$ 0,0625)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Autenticação</td>
                  <td className="py-2 pr-4">Códigos de verificação — não usados pelo VesaliusX</td>
                  <td className="py-2">≈ R$ 0,15 a 0,19</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-stone-600">
            <strong>Exemplo:</strong> uma clínica com 150 atendimentos por mês envia cerca de 450 mensagens de
            utilidade (lembrete, confirmação e pós-atendimento) e umas 150 de marketing (reativações e
            aniversários): ≈ 450 × R$ 0,04 + 150 × R$ 0,33 = <strong>cerca de R$ 70 por mês</strong>, pagos
            no cartão cadastrado na Meta. Não há mensalidade nem valor mínimo.
          </p>
          <p className="mt-2 text-xs text-stone-400">
            Fonte: tabela de preços da WhatsApp Business Platform (Meta), consultada em setembro de 2026.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-base font-semibold text-stone-800">Antes de começar</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-stone-600">
            <li>Um número de telefone <strong>exclusivo</strong> para a API (chip da clínica que receba SMS ou ligação).</li>
            <li>CNPJ e documentos da clínica para a verificação da empresa na Meta.</li>
            <li>Um cartão de crédito da clínica para o pagamento das mensagens.</li>
            <li>Cerca de 40 minutos, com o VesaliusX aberto em Configurações → Números do WhatsApp.</li>
          </ul>
        </section>

        <section className="mt-6 space-y-4">
          {PASSOS.map((passo) => (
            <div key={passo.titulo} className="rounded-xl border border-stone-200 bg-white p-6">
              <h2 className="text-base font-semibold text-stone-800">{passo.titulo}</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-stone-600">
                {passo.itens.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-base font-semibold text-stone-800">Perguntas frequentes</h2>
          <dl className="mt-3 space-y-4">
            {FAQ.map((item) => (
              <div key={item.p}>
                <dt className="text-sm font-medium text-stone-800">{item.p}</dt>
                <dd className="mt-1 text-sm text-stone-600">{item.r}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-8 text-center text-[11px] text-stone-400">
          VesaliusX · powered by Billions Technology ·{" "}
          <Link href="/termos-de-uso" className="hover:underline">
            Termos de uso
          </Link>
        </p>
      </div>
    </main>
  );
}
