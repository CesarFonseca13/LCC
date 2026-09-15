import type { Metadata } from "next";
import Link from "next/link";
import { TERMS_TITLE } from "@clinicaos/core/terms-of-use";
import { TermsBody } from "@/components/terms-body";

export const metadata: Metadata = { title: "Termos de Uso" };

/** Página pública — a versão vigente fica sempre disponível para consulta. */
export default function TermosDeUsoPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-lg font-semibold tracking-tight text-teal-800">
          Vesalius<span className="text-emerald-500">X</span>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-stone-900">{TERMS_TITLE}</h1>
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
          <TermsBody />
        </div>
        <p className="mt-6 text-center text-[11px] text-stone-400">
          VesaliusX · powered by Billions Technology
        </p>
      </div>
    </main>
  );
}
