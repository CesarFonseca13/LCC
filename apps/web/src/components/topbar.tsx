import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import type { AuthContext } from "@/lib/session";

export function Topbar({
  auth,
  whatsappStatus,
}: {
  auth: AuthContext;
  whatsappStatus: string | null;
}) {
  const connected = whatsappStatus === "connected";
  const pill = connected
    ? { dot: "bg-emerald-500", text: "WhatsApp conectado", cls: "bg-emerald-50 text-emerald-700" }
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
            className="rounded-lg px-3 py-1.5 text-sm text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
          >
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
