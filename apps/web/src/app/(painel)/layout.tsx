import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { requireAuth } from "@/lib/auth-action";

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAuth();

  return (
    <div className="flex h-screen bg-stone-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar auth={auth} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
