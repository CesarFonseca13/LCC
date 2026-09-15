import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TERMS_TITLE } from "@clinicaos/core/terms-of-use";
import { TermsBody } from "@/components/terms-body";
import { logoutAction } from "@/app/login/actions";
import { requireAuth } from "@/lib/auth-action";
import { hasAcceptedTerms } from "@/lib/terms";
import { AceiteForm } from "./aceite-form";

export const metadata: Metadata = { title: "Termos de Uso" };

/** Primeiro acesso (ou nova versão dos Termos): o painel só abre depois daqui. */
export default async function AceitePage() {
  const auth = await requireAuth();
  if (await hasAcceptedTerms(auth.userId)) redirect("/inicio");
  const primeiroNome = auth.userName.split(" ")[0];

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-lg font-semibold tracking-tight text-teal-800">
          Vesalius<span className="text-emerald-500">X</span>
        </p>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-stone-900">
          Antes de começar, {primeiroNome}
        </h1>
        <p className="mt-1.5 text-sm text-stone-500">
          Leia os Termos de Uso da plataforma. Eles explicam como o serviço funciona, o que
          esperar da integração com o WhatsApp e as responsabilidades de cada lado.
        </p>

        <div className="mt-6 rounded-xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-stone-800">{TERMS_TITLE}</h2>
          </div>
          <div className="max-h-[55vh] overflow-y-auto px-6 py-5">
            <TermsBody />
          </div>
          <div className="border-t border-stone-200 px-6 py-5">
            <AceiteForm />
          </div>
        </div>

        <form action={logoutAction} className="mt-6 text-center">
          <button type="submit" className="text-xs text-stone-400 underline-offset-2 hover:underline">
            Não concordo — sair da conta
          </button>
        </form>
      </div>
    </main>
  );
}
