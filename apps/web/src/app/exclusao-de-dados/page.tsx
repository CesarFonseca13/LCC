import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Exclusão de dados" };

const CONTATO = "billionstechnology.ai@gmail.com";

/** Instruções públicas de exclusão de dados — URL informada à Meta como "Data deletion instructions". */
export default function ExclusaoDeDadosPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-lg font-semibold tracking-tight text-teal-800">
          Vesalius<span className="text-emerald-500">X</span>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-stone-900">
          Como pedir a exclusão dos seus dados
        </h1>

        <div className="mt-6 space-y-6 rounded-xl border border-stone-200 bg-white p-6 text-sm leading-relaxed text-stone-700 sm:p-8">
          <section className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600">
            <p className="font-semibold text-stone-700">English — Data deletion instructions</p>
            <p className="mt-1">
              To delete the data VesaliusX holds about your clinic (including the WhatsApp Business
              Account ID, phone number ID and access token obtained through Facebook / Meta), either
              disconnect the number in <i>Configurações → WhatsApp → Desconectar</i>, which discards
              the access token immediately, or email <b>{CONTATO}</b> from the clinic&apos;s registered
              e-mail with the subject “Data deletion request”. We confirm the request within 2
              business days and permanently delete all data within 30 days, except records we are
              legally required to keep.
            </p>
          </section>

          <Section title="1. Desconectar o WhatsApp (dados da Meta)">
            <p>
              Se a clínica conectou o número pela API oficial da Meta usando o Facebook, a própria
              administradora pode remover a autorização a qualquer momento em{" "}
              <b>Configurações → WhatsApp → Desconectar</b>. Nesse momento o token de acesso e os
              identificadores da conta do WhatsApp Business são descartados da plataforma. A clínica
              também pode revogar o acesso do app VesaliusX em{" "}
              <a
                href="https://business.facebook.com/settings/"
                className="text-teal-700 underline"
                target="_blank"
                rel="noreferrer"
              >
                business.facebook.com → Configurações da empresa → Integrações
              </a>
              .
            </p>
          </Section>

          <Section title="2. Excluir a conta da clínica e todos os dados">
            <p>
              A administradora da clínica envia um e-mail para{" "}
              <a href={`mailto:${CONTATO}`} className="text-teal-700 underline">
                {CONTATO}
              </a>{" "}
              a partir do e-mail cadastrado na plataforma, com o assunto “Pedido de exclusão de
              dados” e o nome da clínica. Confirmamos o recebimento em até 2 dias úteis e, se a
              clínica quiser, enviamos antes uma exportação dos dados.
            </p>
            <p>
              A exclusão definitiva acontece em até 30 dias e abrange cadastro da clínica, usuários,
              fichas das clientes, conversas, agendamentos, orçamentos, termos assinados, documentos
              gerados e credenciais de integrações. Ficam de fora apenas registros que a lei nos
              obriga a guardar (por exemplo, fiscais), mantidos pelo prazo legal e depois apagados.
            </p>
          </Section>

          <Section title="3. Se você é cliente de uma clínica">
            <p>
              A clínica é a controladora dos seus dados. Peça a exclusão diretamente a ela; a
              clínica pode apagar a sua ficha pela própria plataforma. Se preferir, escreva para{" "}
              <a href={`mailto:${CONTATO}`} className="text-teal-700 underline">
                {CONTATO}
              </a>{" "}
              informando a clínica e o telefone cadastrado, e encaminharemos o pedido.
            </p>
          </Section>

          <p className="text-xs text-stone-500">
            Mais detalhes na{" "}
            <Link href="/privacidade" className="text-teal-700 underline">
              Política de Privacidade
            </Link>{" "}
            e nos{" "}
            <Link href="/termos-de-uso" className="text-teal-700 underline">
              Termos de Uso
            </Link>
            .
          </p>
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
