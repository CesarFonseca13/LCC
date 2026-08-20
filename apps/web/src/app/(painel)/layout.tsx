import { eq } from "drizzle-orm";
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

  let whatsappStatus: string | null = null;
  if (auth.clinicId) {
    const instance = await withTenant(
      auth.clinicId,
      async (tx) =>
        (
          await tx
            .select({ status: schema.whatsappInstances.status })
            .from(schema.whatsappInstances)
            .where(eq(schema.whatsappInstances.clinicId, auth.clinicId!))
            .limit(1)
        )[0] ?? null,
      auth.userId,
    );
    whatsappStatus = instance?.status ?? null;
  }

  return (
    <div className="flex h-screen bg-stone-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar auth={auth} whatsappStatus={whatsappStatus} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
