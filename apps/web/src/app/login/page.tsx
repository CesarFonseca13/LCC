import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — ClinicaOS",
};

const PROVAS = [
  {
    titulo: "Agenda que confirma sozinha",
    texto: "Lembretes humanizados no WhatsApp — menos faltas, sem telefonema.",
  },
  {
    titulo: "Clientes que voltam",
    texto: "Reativação inteligente traz de volta quem sumiu, no tom certo.",
  },
  {
    titulo: "Financeiro sem planilha",
    texto: "Cada “Compareceu” vira conta, comissão e baixa de estoque.",
  },
];

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth) redirect("/inicio");

  return (
    <main className="flex min-h-screen bg-stone-50">
      {/* Painel da marca — aurora animada em CSS puro */}
      <section className="relative hidden w-1/2 overflow-hidden bg-teal-950 lg:block">
        <div className="fx-blob left-[-10%] top-[-15%] h-[34rem] w-[34rem] bg-teal-500/40" />
        <div
          className="fx-blob bottom-[-20%] right-[-12%] h-[38rem] w-[38rem] bg-emerald-400/25"
          style={{ animationDelay: "-6s" }}
        />
        <div
          className="fx-blob left-[30%] top-[45%] h-72 w-72 bg-cyan-300/20"
          style={{ animationDelay: "-11s" }}
        />
        <div className="absolute inset-0 fx-grid opacity-40" />

        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <Link href="/" className="text-xl font-semibold tracking-tight text-white">
            Clinica<span className="text-emerald-300">OS</span>
          </Link>

          <div className="max-w-md">
            <h2 className="fx-rise text-3xl font-semibold leading-snug text-white">
              Sua clínica cuidando das clientes.
              <br />
              <span className="text-emerald-300">O sistema cuidando do resto.</span>
            </h2>
            <ul className="mt-8 space-y-5">
              {PROVAS.map((p, i) => (
                <li key={p.titulo} className={`fx-rise fx-rise-${i + 1} flex gap-3`}>
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-[11px] text-emerald-300">
                    ✓
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">{p.titulo}</p>
                    <p className="text-sm text-teal-100/70">{p.texto}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-teal-200/50">
            Feito para clínicas de estética e saúde · LGPD desde o primeiro dia
          </p>
        </div>
      </section>

      {/* Formulário */}
      <section className="relative flex w-full items-center justify-center px-4 py-12 lg:w-1/2">
        <div className="fx-blob right-[-20%] top-[-20%] h-96 w-96 bg-teal-200/50 lg:hidden" />
        <div className="relative w-full max-w-sm">
          <div className="mb-8">
            <Link href="/" className="text-2xl font-semibold tracking-tight text-teal-800 lg:hidden">
              Clinica<span className="text-emerald-500">OS</span>
            </Link>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-stone-900 lg:mt-0">
              Que bom te ver 👋
            </h1>
            <p className="mt-1.5 text-sm text-stone-500">
              Entre para acompanhar sua clínica de hoje.
            </p>
          </div>
          <LoginForm />
          <p className="mt-6 text-center text-xs text-stone-400">
            Problemas para entrar? Fale com a administradora da sua clínica.
          </p>
        </div>
      </section>
    </main>
  );
}
