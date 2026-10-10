import { desc, eq } from "drizzle-orm";
import { adminDb, schema } from "@clinicaos/db";
import { requireSuperadmin } from "@/lib/admin";

const LABEL: Record<string, string> = {
  "clinic.create": "Clínica criada",
  "clinic.update": "Clínica alterada",
  "clinic.delete": "Clínica apagada",
  "clinic.enter": "Entrou no painel da clínica",
  "clinic.leave": "Saiu da clínica",
  "user.add": "Usuário adicionado",
  "user.remove": "Acesso desativado",
  "user.reset_password": "Senha redefinida",
  "demo.clear_conversations": "Conversas da demo limpas",
};

export default async function AdminAuditoria() {
  await requireSuperadmin();
  const db = adminDb();
  const rows = await db
    .select({
      id: schema.platformAuditLog.id,
      action: schema.platformAuditLog.action,
      target: schema.platformAuditLog.target,
      details: schema.platformAuditLog.details,
      createdAt: schema.platformAuditLog.createdAt,
      admin: schema.users.email,
      clinic: schema.clinics.name,
    })
    .from(schema.platformAuditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.platformAuditLog.adminUserId))
    .leftJoin(schema.clinics, eq(schema.clinics.id, schema.platformAuditLog.clinicId))
    .orderBy(desc(schema.platformAuditLog.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-stone-900">Auditoria da administração</h1>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2">Quando</th>
              <th className="px-4 py-2">Quem</th>
              <th className="px-4 py-2">Ação</th>
              <th className="px-4 py-2">Clínica</th>
              <th className="px-4 py-2">Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-stone-400">Nada registrado ainda.</td></tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-stone-500">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td className="px-4 py-2">{r.admin ?? "—"}</td>
                <td className="px-4 py-2">{LABEL[r.action] ?? r.action}</td>
                <td className="px-4 py-2">{r.clinic ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-stone-500">
                  {r.target ? <span className="mr-2">{r.target}</span> : null}
                  {r.details ? <code className="break-all">{JSON.stringify(r.details).slice(0, 160)}</code> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
