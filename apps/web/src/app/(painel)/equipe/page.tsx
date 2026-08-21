import { eq } from "drizzle-orm";
import Link from "next/link";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { MemberFormButton, ProfessionalFormButton, RoomForm } from "./forms";
import { ToggleButton } from "./toggle-button";

export const metadata = { title: "Equipe" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Administradora",
  manager: "Gestora",
  professional: "Profissional",
  reception: "Recepção",
};

type Tab = "profissionais" | "acessos" | "salas";

export default async function EquipePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "team.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Equipe</h1>
        <div className="mt-6">
          <EmptyState title="Somente a administradora da clínica pode gerenciar a equipe." />
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "acessos" ? "acessos" : sp.tab === "salas" ? "salas" : "profissionais";

  const { professionals, members, rooms } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const professionals = await tx
        .select()
        .from(schema.professionals)
        .orderBy(schema.professionals.name);
      const members = await tx
        .select({
          id: schema.clinicMembers.id,
          role: schema.clinicMembers.role,
          active: schema.clinicMembers.active,
          professionalId: schema.clinicMembers.professionalId,
          userId: schema.users.id,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.clinicMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.clinicMembers.userId))
        // Filtro explícito: a policy de clinic_members também libera "OR user_id =
        // usuário atual", o que traria vínculos da mesma pessoa em OUTRAS clínicas
        .where(eq(schema.clinicMembers.clinicId, auth.clinicId!));
      const rooms = await tx.select().from(schema.rooms).orderBy(schema.rooms.name);
      return { professionals, members, rooms };
    },
    auth.userId,
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Equipe</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Quem atende (agenda), quem acessa o sistema e as salas da clínica.
          </p>
        </div>
        {tab === "profissionais" ? (
          <ProfessionalFormButton />
        ) : tab === "acessos" ? (
          <MemberFormButton
            professionals={professionals
              .filter((p) => p.active)
              .map((p) => ({ id: p.id, name: p.name }))}
          />
        ) : null}
      </div>

      <div className="mt-5 flex gap-1 border-b border-stone-200">
        {(
          [
            ["profissionais", "Profissionais"],
            ["acessos", "Acessos"],
            ["salas", "Salas"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/equipe?tab=${key}`}
            className={
              tab === key
                ? "border-b-2 border-teal-700 px-4 py-2 text-sm font-medium text-teal-800"
                : "border-b-2 border-transparent px-4 py-2 text-sm text-stone-500 hover:text-stone-800"
            }
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        {tab === "profissionais" ? (
          professionals.length === 0 ? (
            <EmptyState
              title="Cadastre quem atende na clínica — cada profissional vira uma coluna na agenda."
              action={<ProfessionalFormButton />}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                    <th className="px-4 py-3 font-medium">Profissional</th>
                    <th className="px-4 py-3 font-medium">Especialidade</th>
                    <th className="px-4 py-3 font-medium">Registro</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {professionals.map((p) => (
                    <tr key={p.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3">
                        <span
                          className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                          style={{ backgroundColor: p.calendarColor }}
                        />
                        <span className="font-medium text-stone-800">{p.name}</span>
                      </td>
                      <td className="px-4 py-3 text-stone-600">{p.specialty ?? "—"}</td>
                      <td className="px-4 py-3 text-stone-600">
                        {p.registrationNumber ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {p.active ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Ativa
                          </span>
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                            Inativa
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <ProfessionalFormButton
                            initial={{
                              id: p.id,
                              name: p.name,
                              specialty: p.specialty ?? "",
                              registrationNumber: p.registrationNumber ?? "",
                              calendarColor: p.calendarColor,
                            }}
                          />
                          <ToggleButton kind="professional" id={p.id} active={p.active} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === "acessos" ? (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Papel</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-stone-800">{m.userName}</td>
                    <td className="px-4 py-3 text-stone-600">{m.userEmail}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                        {ROLE_LABEL[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {m.active ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Ativo
                        </span>
                      ) : (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                          Removido
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.userId !== auth.userId ? (
                        <ToggleButton kind="member" id={m.id} active={m.active} />
                      ) : (
                        <span className="text-xs text-stone-400">você</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="max-w-xl">
            <RoomForm />
            <div className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {rooms.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-stone-500">
                  Nenhuma sala cadastrada. Salas evitam conflito de horário quando duas
                  profissionais atendem ao mesmo tempo.
                </p>
              ) : (
                <ul>
                  {rooms.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5 last:border-0"
                    >
                      <span
                        className={
                          r.active ? "text-sm text-stone-800" : "text-sm text-stone-400 line-through"
                        }
                      >
                        {r.name}
                      </span>
                      <ToggleButton kind="room" id={r.id} active={r.active} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
