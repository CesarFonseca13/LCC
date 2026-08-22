import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@clinicaos/db";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { requireAuth } from "@/lib/auth-action";

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAuth();

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

  let whatsappStatus: string | null = null;
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
            .where(eq(schema.whatsappInstances.clinicId, auth.clinicId!))
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
    whatsappStatus =
      info.counts.total > 0 && info.counts.connected === info.counts.total
        ? "connected"
        : info.counts.total > 0
          ? "disconnected"
          : null;
    approvalsCount = info.pending;
  }

  return (
    <div className="flex h-screen bg-stone-50">
      <Sidebar approvalsCount={approvalsCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar auth={auth} whatsappStatus={whatsappStatus} whatsappCounts={whatsappCounts} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

