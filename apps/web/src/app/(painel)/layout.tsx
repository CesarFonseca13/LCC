import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { schema, withTenant } from "@clinicaos/db";
import { TopNav } from "@/components/topnav";
import { requireAuth } from "@/lib/auth-action";
import { requireTermsAccepted } from "@/lib/terms";

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAuth();
  // Primeiro acesso (ou Termos novos): nada do painel abre antes do aceite
  await requireTermsAccepted(auth.userId);

  // Sem clínica vinculada: tela orientando o próximo passo (nunca painel em branco)
  if (!auth.clinicId) {
    const { logoutAction } = await import("@/app/login/actions");
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50 p-8">
        <div className="max-w-md rounded-xl border border-stone-200 bg-white p-8 text-center shadow-sm">
          <p className="text-3xl">🔑</p>
          <h1 className="mt-3 text-lg font-semibold text-stone-800">
            Seu acesso ainda não está vinculado a uma clínica
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Peça para a responsável pela clínica liberar (ou reativar) seu acesso em{" "}
            <span className="font-medium">Equipe</span>. Assim que estiver liberado, é só
            entrar de novo.
          </p>
          <form action={logoutAction} className="mt-6">
            <button
              type="submit"
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Voltar para o login
            </button>
          </form>
        </div>
      </div>
    );
  }

  let whatsappCounts = { connected: 0, total: 0 };
  let approvalsCount = 0;
  if (auth.clinicId) {
    const info = await withTenant(
      auth.clinicId,
      async (tx) => {
        const counts = (
          await tx
            .select({
              total: sql<number>`count(*)::int`,
              connected: sql<number>`count(*) FILTER (WHERE status = 'connected')::int`,
            })
            .from(schema.whatsappInstances)
            .where(
              and(
                eq(schema.whatsappInstances.clinicId, auth.clinicId!),
                // números 'lcc-demo-%' são cenográficos (modo demonstração)
                sql`evolution_instance_name NOT LIKE 'lcc-demo-%'`,
              ),
            )
        )[0] ?? { total: 0, connected: 0 };
        const pending = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.approvals)
          .where(eq(schema.approvals.status, "pending"));
        return { counts, pending: pending[0]?.count ?? 0 };
      },
      auth.userId,
    );
    whatsappCounts = info.counts;
    approvalsCount = info.pending;
  }

  const desconectados = whatsappCounts.total - whatsappCounts.connected;
  const whatsapp =
    whatsappCounts.total > 0 && desconectados === 0
      ? {
          tone: "ok" as const,
          text:
            whatsappCounts.total > 1
              ? `WhatsApp conectado · ${whatsappCounts.total} números`
              : "WhatsApp conectado",
        }
      : whatsappCounts.connected > 0
        ? {
            tone: "warn" as const,
            text: `${desconectados} número${desconectados === 1 ? "" : "s"} desconectado${desconectados === 1 ? "" : "s"}`,
          }
        : whatsappCounts.total > 0
          ? { tone: "off" as const, text: "WhatsApp não conectado" }
          : { tone: "none" as const, text: "Nenhum número conectado ainda" };

  return (
    <div className="flex h-screen flex-col bg-stone-50">
      <TopNav
        clinicName={auth.clinicName ?? null}
        userName={auth.userName ?? null}
        approvalsCount={approvalsCount}
        whatsapp={whatsapp}
      />
      {whatsapp.tone === "off" ? (
        <div className="flex items-center justify-center gap-3 bg-red-600 px-4 py-2 text-sm font-medium text-white">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
          O WhatsApp está desconectado — as mensagens das clientes NÃO estão chegando.
          <Link
            href="/configuracoes"
            className="rounded-md bg-white/15 px-3 py-1 font-semibold underline-offset-2 hover:bg-white/25"
          >
            Reconectar agora
          </Link>
        </div>
      ) : whatsapp.tone === "warn" ? (
        <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-sm font-medium text-white">
          {whatsapp.text} — as mensagens desse número não estão chegando.
          <Link href="/configuracoes" className="rounded-md bg-white/15 px-2.5 py-0.5 font-semibold hover:bg-white/25">
            Reconectar
          </Link>
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-white px-6 py-1.5 text-[11px] text-stone-400">
        <span>
          <span className="font-semibold text-stone-500">VesaliusX</span> — gestão e atendimento
          para clínicas
        </span>
        <span>
          powered by <span className="font-medium text-stone-500">Billions Technology</span> · ©{" "}
          {new Date().getFullYear()} ·{" "}
          <Link href="/termos-de-uso" className="hover:text-stone-600 hover:underline">
            Termos de uso
          </Link>
        </span>
      </footer>
    </div>
  );
}

