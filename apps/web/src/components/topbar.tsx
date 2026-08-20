import { logoutAction } from "@/app/login/actions";
import type { AuthContext } from "@/lib/session";

export function Topbar({ auth }: { auth: AuthContext }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-stone-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-stone-700">
          {auth.clinicName ?? "Sem clínica ativa"}
        </span>
        {/* Pílula de status do WhatsApp — vira status real no milestone Evolution */}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
          WhatsApp não conectado
        </span>
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
