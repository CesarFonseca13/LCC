import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/session";
import { LandingFx } from "./landing-fx";

export const metadata: Metadata = {
  title: "ClinicaOS — sua clínica no piloto automático humano",
  description:
    "Agenda que confirma sozinha, WhatsApp humanizado, reativação de clientes e financeiro completo — feito para clínicas de estética e saúde.",
};

const CONVERSA = [
  { de: "clinica", texto: "Oi Maria, tudo bem? 💛 Lembrei de você — já está na época do seu retorno de limpeza de pele. Quer que eu veja uns horários?" },
  { de: "cliente", texto: "Oii! Pode ser quinta à tarde?" },
  { de: "clinica", texto: "Quinta 15h com a Dra. Paula, fechado? 😊" },
  { de: "cliente", texto: "Perfeito, confirmado! ❤️" },
];

const RECURSOS = [
  { icone: "📅", titulo: "Agenda que confirma sozinha", texto: "Lembretes em 24h, 2h e 45min pelo WhatsApp — com tom de gente, não de robô. Menos faltas sem ninguém pendurada no telefone." },
  { icone: "💬", titulo: "WhatsApp com IA humanizada", texto: "Responde, agenda, remarca e sabe a hora de chamar uma humana. A cliente nunca percebe que falou com um sistema." },
  { icone: "✨", titulo: "Clientes que voltam", texto: "Venceu o prazo de retorno e a cliente sumiu? Uma sequência carinhosa de até 7 mensagens traz ela de volta — e para na hora se ela responder." },
  { icone: "📈", titulo: "Inteligência de clientes", texto: "Cada cliente com nota de 0 a 100 e o porquê: quem está quente, quem esfriou e qual ação tomar — pronta para enviar." },
  { icone: "📝", titulo: "Termos com assinatura", texto: "Consentimento assinado pelo celular com validade jurídica: hash, IP e trilha de auditoria. PDF direto na ficha." },
  { icone: "💰", titulo: "Financeiro de verdade", texto: "Marcou “Compareceu”? Nasce a conta a receber, a comissão da profissional e a baixa do estoque. Sem planilha." },
];

const PASSOS = [
  { n: "1", titulo: "Conecte o WhatsApp", texto: "Leia um QR code e pronto — seu número, suas conversas, com superpoderes." },
  { n: "2", titulo: "Ligue as automações", texto: "Templates prontos em português. Comece revisando cada envio; quando confiar, deixe automático." },
  { n: "3", titulo: "Veja a agenda encher", texto: "Confirmações, reativações e o funil trabalhando 24h — você acompanha tudo pelo painel." },
];

export default async function RootPage() {
  const auth = await getAuth();
  if (auth) redirect("/inicio");

  return (
    <main className="bg-teal-950 text-white">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="fx-blob left-[-12%] top-[-18%] h-[36rem] w-[36rem] bg-teal-500/30" />
        <div className="fx-blob right-[-10%] top-[25%] h-[30rem] w-[30rem] bg-emerald-400/20" style={{ animationDelay: "-7s" }} />
        <div className="fx-blob bottom-[-25%] left-[25%] h-[28rem] w-[28rem] bg-cyan-300/15" style={{ animationDelay: "-12s" }} />
        <div className="absolute inset-0 fx-grid opacity-50" />
        <LandingFx />

        <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="text-xl font-semibold tracking-tight">
            Clinica<span className="text-emerald-300">OS</span>
          </span>
          <Link
            href="/login"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium backdrop-blur transition hover:bg-white/10"
          >
            Entrar
          </Link>
        </nav>

        <div className="relative z-10 mx-auto grid max-w-6xl gap-14 px-6 pb-24 pt-14 lg:grid-cols-2 lg:items-center lg:pt-20">
          <div>
            <p className="fx-rise inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3.5 py-1.5 text-xs font-medium text-emerald-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
              Para clínicas de estética e saúde
            </p>
            <h1 className="fx-rise fx-rise-1 mt-6 text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
              A recepcionista que <span className="fx-shine-text">nunca dorme</span> — e ninguém percebe que é um sistema.
            </h1>
            <p className="fx-rise fx-rise-2 mt-6 max-w-lg text-lg leading-relaxed text-teal-100/80">
              Agenda que confirma sozinha, WhatsApp que conversa como gente,
              clientes sumidas voltando e o financeiro se preenchendo — enquanto
              sua equipe cuida de quem está na maca.
            </p>
            <div className="fx-rise fx-rise-3 mt-9 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-emerald-400 px-6 py-3.5 text-sm font-semibold text-teal-950 shadow-lg shadow-emerald-400/25 transition hover:bg-emerald-300 hover:shadow-emerald-400/40"
              >
                Entrar no painel
              </Link>
              <a
                href="#recursos"
                className="rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-medium backdrop-blur transition hover:bg-white/10"
              >
                Ver o que ele faz ↓
              </a>
            </div>
          </div>

          {/* Conversa humanizada — a prova viva do produto */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute -inset-6 rounded-3xl bg-emerald-400/10 blur-2xl" />
            <div className="relative rounded-3xl border border-white/10 bg-teal-900/60 p-5 shadow-2xl backdrop-blur">
              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/20 text-sm">💆‍♀️</span>
                <div>
                  <p className="text-sm font-medium">Maria Silva</p>
                  <p className="text-xs text-emerald-300">reativada automaticamente</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {CONVERSA.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      m.de === "clinica"
                        ? "rounded-tl-sm bg-white/10 text-teal-50"
                        : "ml-auto rounded-tr-sm bg-emerald-400/90 text-teal-950"
                    }`}
                    style={{ animation: `fx-bubble 14s ease-in-out ${i * 1.1}s infinite` }}
                  >
                    {m.texto}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-[11px] text-teal-200/50">
                escrita, enviada e agendada pelo ClinicaOS ✨
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recursos ─────────────────────────────────────────────── */}
      <section id="recursos" className="relative bg-stone-50 py-24 text-stone-800">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-teal-600">
            Tudo em um lugar só
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl text-center text-3xl font-semibold tracking-tight text-stone-900">
            O dia inteiro da clínica, do “oi” no WhatsApp ao fechamento do caixa
          </h2>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {RECURSOS.map((r) => (
              <div
                key={r.titulo}
                className="group rounded-2xl border border-stone-200 bg-white p-6 transition hover:-translate-y-1 hover:border-teal-200 hover:shadow-xl hover:shadow-teal-900/5"
              >
                <span className="text-2xl">{r.icone}</span>
                <h3 className="mt-4 text-base font-semibold text-stone-900">{r.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">{r.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Como funciona ────────────────────────────────────────── */}
      <section className="bg-white py-24 text-stone-800">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900">
            No ar em uma tarde
          </h2>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {PASSOS.map((p) => (
              <div key={p.n} className="relative text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-700 text-lg font-semibold text-white shadow-lg shadow-teal-700/25">
                  {p.n}
                </span>
                <h3 className="mt-5 text-base font-semibold text-stone-900">{p.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">{p.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24">
        <div className="fx-blob left-[10%] top-[-30%] h-96 w-96 bg-emerald-400/20" />
        <div className="fx-blob right-[5%] bottom-[-40%] h-96 w-96 bg-teal-400/20" style={{ animationDelay: "-8s" }} />
        <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Sua agenda cheia começa com um <span className="fx-shine-text">oi</span>.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-teal-100/80">
            Multi-clínica, LGPD desde o primeiro dia e automações que passam pela
            sua aprovação até você confiar de olhos fechados.
          </p>
          <Link
            href="/login"
            className="mt-9 inline-block rounded-xl bg-emerald-400 px-8 py-4 text-sm font-semibold text-teal-950 shadow-lg shadow-emerald-400/25 transition hover:bg-emerald-300 hover:shadow-emerald-400/40"
          >
            Entrar no painel
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-teal-200/50">
          <span>
            Clinica<span className="text-emerald-300/70">OS</span> — gestão e atendimento para clínicas
          </span>
          <span>Feito com carinho no Brasil 🇧🇷</span>
        </div>
      </footer>
    </main>
  );
}
