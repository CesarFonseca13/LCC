import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import type { AuthContext } from "@/lib/session";

export function Topbar({
  auth,
  whatsappStatus,
  whatsappCounts,
}: {
  auth: AuthContext;
  whatsappStatus: string | null;
  /** Multi-número: {conectados, total}. */
  whatsappCounts?: { connected: number; total: number };
}) {
  const total = whatsappCounts?.total ?? (whatsappStatus ? 1 : 0);
  const connectedCount =
    whatsappCounts?.connected ?? (whatsappStatus === "connected" ? 1 : 0);
  const pill =
    total > 0 && connectedCount === total
      ? {
          dot: "bg-emerald-500",
          text: total > 1 ? `WhatsApp conectado · ${total} números` : "WhatsApp conectado",
          cls: "bg-emerald-50 text-emerald-700",
        }
      : connectedCount > 0
        ? {
            dot: "bg-amber-500",
            text: `${total - connectedCount} número${total - connectedCount === 1 ? "" : "s"} desconectado${total - connectedCount === 1 ? "" : "s"}`,
            cls: "bg-amber-50 text-amber-700",
          }
        : { dot: "bg-red-400", text: "WhatsApp não conectado", cls: "bg-stone-100 text-stone-500" };

  return (
    <header className="flex h-14 items-center justify-between border-b border-stone-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-stone-700">
          {auth.clinicName ?? "Sem clínica ativa"}
        </span>
        <Link
          href="/configuracoes"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition hover:opacity-80 ${pill.cls}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.text}
        </Link>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-stone-600">{auth.userName}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            title="Sair da conta"
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}

