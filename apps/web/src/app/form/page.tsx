import type { Metadata } from "next";
import Link from "next/link";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Formulário de implantação",
  description: "Responda o questionário para a equipe do VesaliusX configurar a conta da sua clínica.",
  robots: { index: false, follow: false },
};

/** Página pública: a clínica nova responde antes de ter login. */
export default function FormPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 pb-24 pt-8 text-stone-800">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-lg font-semibold tracking-tight text-teal-800">
          Vesalius<span className="text-emerald-500">X</span>
        </Link>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
          Formulário de implantação da sua clínica
        </h1>
        <p className="mt-2 max-w-prose text-stone-600">
          Com estas respostas a equipe do VesaliusX deixa a conta pronta: agenda, serviços, equipe, WhatsApp e a
          atendente respondendo com as informações certas. Leva de 30 a 45 minutos e pode ser preenchido aos poucos:
          as respostas ficam salvas neste aparelho até você enviar.
        </p>
        <OnboardingForm />
        <p className="mt-10 text-center text-[11px] text-stone-400">
          VesaliusX · powered by Billions Technology · 53.133.495 CESAR EUSTAQUIO DA FONSECA FILHO - ME · CNPJ 53.133.495/0001-93
        </p>
      </div>
    </main>
  );
}
