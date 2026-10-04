import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Política de Privacidade" };

const ATUALIZADA_EM = "4 de outubro de 2026";
const CONTATO = "billionstechnology.ai@gmail.com";

/** Política de Privacidade pública — exigida pela Meta (Login/Embedded Signup) e pela LGPD. */
export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-lg font-semibold tracking-tight text-teal-800">
          Vesalius<span className="text-emerald-500">X</span>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-stone-900">
          Política de Privacidade da plataforma VesaliusX
        </h1>
        <p className="mt-1 text-xs text-stone-400">Atualizada em {ATUALIZADA_EM}</p>

        <div className="mt-6 space-y-6 rounded-xl border border-stone-200 bg-white p-6 text-sm leading-relaxed text-stone-700 sm:p-8">
          <section className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600">
            <p className="font-semibold text-stone-700">English summary</p>
            <p className="mt-1">
              VesaliusX is a clinic management platform operated by Billions Technology (Brazil).
              Clinics connect their WhatsApp Business number through Meta&apos;s official WhatsApp
              Business Platform. We only use the WhatsApp Business Account ID, phone number ID and
              access token obtained during onboarding to send and receive messages on the
              clinic&apos;s behalf, manage its message templates and receive webhooks. We never sell
              or share this data with third parties beyond the providers needed to run the service.
              Any clinic can request deletion of its data at any time — see our{" "}
              <Link href="/exclusao-de-dados" className="text-teal-700 underline">
                data deletion instructions
              </Link>
              . Contact: {CONTATO}.
            </p>
          </section>

          <Section title="1. Quem somos">
            <p>
              A VesaliusX é uma plataforma de gestão e atendimento para clínicas, desenvolvida e
              operada pela Billions Technology (“Billions”, “nós”). Esta Política explica quais dados
              pessoais tratamos, para quê, com quem compartilhamos e como você pode exercer seus
              direitos. Ela complementa os{" "}
              <Link href="/termos-de-uso" className="text-teal-700 underline">
                Termos de Uso
              </Link>
              .
            </p>
            <p>
              Em relação aos dados das clientes e da equipe de cada clínica, a clínica contratante é
              a controladora e a Billions atua como operadora, tratando os dados apenas para prestar
              o serviço e conforme as instruções da clínica. Em relação aos dados de cadastro e de
              uso da própria clínica e de seus usuários, a Billions é a controladora.
            </p>
          </Section>

          <Section title="2. Quais dados tratamos">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <b>Dados da clínica e da equipe:</b> nome, razão social, CNPJ, endereço, telefone,
                e-mail, horários de funcionamento, nome e e-mail dos usuários, papéis de acesso e
                registros de login.
              </li>
              <li>
                <b>Dados das clientes da clínica:</b> nome, telefone, e-mail, CPF, data de nascimento,
                histórico de agendamentos, procedimentos, orçamentos, termos de consentimento
                assinados, anotações e demais informações que a clínica registra na ficha.
              </li>
              <li>
                <b>Conversas pelo WhatsApp:</b> conteúdo das mensagens trocadas entre a clínica e suas
                clientes pelo número conectado, incluindo mídias, horários e status de entrega.
              </li>
              <li>
                <b>Dados de uso:</b> registros técnicos (endereço IP, navegador, data e hora) usados
                para segurança, auditoria e diagnóstico de falhas.
              </li>
            </ul>
          </Section>

          <Section title="3. Integração com a Meta e o WhatsApp">
            <p>
              Quando a clínica conecta o número pela WhatsApp Business Platform (API oficial da Meta)
              usando o botão “Conectar com o Facebook”, a Meta nos entrega, com autorização da
              clínica, o identificador da conta do WhatsApp Business (WABA ID), o identificador do
              número de telefone, o nome verificado e um token de acesso. Usamos esses dados
              exclusivamente para:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>enviar e receber mensagens em nome da clínica pelo número conectado;</li>
              <li>criar, sincronizar e consultar os modelos de mensagem (templates) da clínica;</li>
              <li>assinar os webhooks de mensagens e status e verificar a saúde da conexão.</li>
            </ul>
            <p>
              Não acessamos o perfil pessoal do Facebook de quem fez a conexão, não publicamos nada
              em nome dela e não usamos os dados da Meta para outra finalidade. O token de acesso é
              guardado criptografado e é descartado quando a clínica desconecta o número ou exclui a
              conta. O uso da integração está sujeito também à{" "}
              <a
                href="https://www.whatsapp.com/legal/business-policy/"
                className="text-teal-700 underline"
                target="_blank"
                rel="noreferrer"
              >
                Política do WhatsApp Business
              </a>
              .
            </p>
          </Section>

          <Section title="4. Para que usamos os dados">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>prestar o serviço contratado: agenda, atendimento, orçamentos, termos, financeiro;</li>
              <li>responder às clientes da clínica com a assistente virtual, conforme configurado;</li>
              <li>enviar lembretes, confirmações e comunicações automáticas definidas pela clínica;</li>
              <li>manter a segurança da plataforma, prevenir fraudes e cumprir obrigações legais;</li>
              <li>melhorar o serviço, usando dados agregados e sem identificação individual.</li>
            </ul>
            <p>
              As bases legais são a execução do contrato com a clínica, o cumprimento de obrigações
              legais, o legítimo interesse (segurança e melhoria do serviço) e, quando aplicável, o
              consentimento colhido pela própria clínica junto às suas clientes.
            </p>
          </Section>

          <Section title="5. Com quem compartilhamos">
            <p>Compartilhamos dados somente com fornecedores necessários para operar a plataforma:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>provedores de hospedagem e armazenamento em nuvem;</li>
              <li>
                a Meta (WhatsApp Business Platform), para entregar e receber as mensagens da clínica;
              </li>
              <li>
                provedores de modelos de inteligência artificial, que processam o conteúdo das
                conversas necessário para gerar as respostas da assistente;
              </li>
              <li>serviços de envio de e-mail e geração de documentos.</li>
            </ul>
            <p>
              Não vendemos dados pessoais nem os usamos para publicidade. Podemos divulgar dados
              quando exigido por lei ou ordem de autoridade competente.
            </p>
          </Section>

          <Section title="6. Segurança">
            <p>
              Adotamos isolamento dos dados por clínica no banco de dados, criptografia de
              credenciais e tokens, comunicação por HTTPS, controle de acesso por papéis, registro de
              atividades sensíveis e cópias de segurança periódicas. Nenhum sistema é totalmente
              imune a incidentes; caso ocorra um que afete dados pessoais, avisaremos a clínica e as
              autoridades conforme a legislação.
            </p>
          </Section>

          <Section title="7. Por quanto tempo guardamos">
            <p>
              Mantemos os dados enquanto a clínica for cliente da plataforma. Ao encerrar o contrato,
              a clínica pode exportar seus dados; após 30 dias eles são excluídos, ressalvados os
              registros que a lei obriga a guardar. A clínica também pode pedir a exclusão a qualquer
              momento — veja as{" "}
              <Link href="/exclusao-de-dados" className="text-teal-700 underline">
                instruções de exclusão de dados
              </Link>
              .
            </p>
          </Section>

          <Section title="8. Seus direitos (LGPD)">
            <p>
              Nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode pedir
              confirmação do tratamento, acesso, correção, anonimização, portabilidade, eliminação
              dos dados e informação sobre compartilhamentos, além de revogar consentimentos. Se você
              é cliente de uma clínica, o pedido deve ser feito diretamente à clínica, que é a
              controladora; nós a apoiaremos no atendimento. Para dúvidas ou pedidos, escreva para{" "}
              <a href={`mailto:${CONTATO}`} className="text-teal-700 underline">
                {CONTATO}
              </a>
              .
            </p>
          </Section>

          <Section title="9. Cookies">
            <p>
              Usamos apenas cookies estritamente necessários para manter a sessão de quem está
              conectado à plataforma. Não usamos cookies de rastreamento ou publicidade.
            </p>
          </Section>

          <Section title="10. Alterações">
            <p>
              Podemos atualizar esta Política para refletir mudanças no serviço ou na legislação. A
              versão vigente fica sempre publicada nesta página, com a data de atualização no topo.
            </p>
          </Section>
        </div>

        <p className="mt-6 text-center text-[11px] text-stone-400">
          VesaliusX · powered by Billions Technology
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-stone-800">{title}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
