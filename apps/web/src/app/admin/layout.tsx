import Link from "next/link";
import { requireSuperadmin } from "@/lib/admin";
import { AdminNav } from "./admin-nav";

export const metadata = { title: "Administração · VesaliusX" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireSuperadmin();
  return (
    <div className="min-h-screen bg-stone-100 text-stone-800">
      <header className="border-b border-stone-800 bg-stone-900 text-stone-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tracking-tight">
              Vesalius<span className="text-emerald-400">X</span>
            </span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              Administração
            </span>
          </div>
          <AdminNav />
          <div className="flex items-center gap-3 text-xs text-stone-400">
            <span className="hidden sm:inline">{auth.userEmail}</span>
            {auth.clinicId ? (
              <Link href="/inicio" className="rounded-lg border border-stone-700 px-3 py-1.5 text-stone-200 hover:bg-stone-800">
                Painel da clínica
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
