import { eq } from "drizzle-orm";
import Link from "next/link";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL, formatDurationMin } from "@/lib/format";
import { PackageFormButton } from "./package-form";
import { ProcedureFormButton } from "./procedure-form";
import { ToggleActiveButton } from "./toggle-buttons";

export const metadata = { title: "Serviços" };

type Tab = "procedimentos" | "pacotes";

export default async function ServicosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;
  const canManage = can(auth.role, "catalog.manage");
  const tab: Tab = (await searchParams).tab === "pacotes" ? "pacotes" : "procedimentos";

  const { procedures, packages } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const procedures = await tx
        .select()
        .from(schema.procedures)
        .orderBy(schema.procedures.name);
      const packagesRaw = await tx
        .select()
        .from(schema.packages)
        .orderBy(schema.packages.name);
      const items = await tx
        .select({
          packageId: schema.packageItems.packageId,
          procedureId: schema.packageItems.procedureId,
          sessions: schema.packageItems.sessions,
          procedureName: schema.procedures.name,
        })
        .from(schema.packageItems)
        .innerJoin(
          schema.procedures,
          eq(schema.procedures.id, schema.packageItems.procedureId),
        );
      const packages = packagesRaw.map((p) => ({
        ...p,
        items: items.filter((i) => i.packageId === p.id),
      }));
      return { procedures, packages };
    },
    auth.userId,
  );

  const activeProcedures = procedures.filter((p) => p.active);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Serviços</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            O que a sua clínica vende: procedimentos e pacotes de sessões.
          </p>
        </div>
        {canManage ? (
          tab === "procedimentos" ? (
            <ProcedureFormButton />
          ) : (
            <PackageFormButton
              procedures={activeProcedures.map((p) => ({ id: p.id, name: p.name }))}
            />
          )
        ) : null}
      </div>

      <div className="mt-5 flex gap-1 border-b border-stone-200">
        {(
          [
            ["procedimentos", "Procedimentos"],
            ["pacotes", "Pacotes"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/servicos?tab=${key}`}
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
        {tab === "procedimentos" ? (
          procedures.length === 0 ? (
            <EmptyState
              title="Cadastre seu primeiro procedimento para agendar em segundos — a duração e o preço já entram sozinhos na agenda. O prazo de retorno alimenta as reativações automáticas."
              action={canManage ? <ProcedureFormButton /> : undefined}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                    <th className="px-4 py-3 font-medium">Procedimento</th>
                    <th className="px-4 py-3 font-medium">Duração</th>
                    <th className="px-4 py-3 font-medium">Preço</th>
                    <th className="px-4 py-3 font-medium">Retorno</th>
                    <th className="px-4 py-3 font-medium">Retoque</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {canManage ? <th className="px-4 py-3" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {procedures.map((p) => (
                    <tr key={p.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-stone-800">{p.name}</span>
                        {p.category ? (
                          <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                            {p.category}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {formatDurationMin(p.durationMinutes)}
                      </td>
                      <td className="px-4 py-3 text-stone-600">{formatBRL(p.price)}</td>
                      <td className="px-4 py-3 text-stone-600">
                        {p.returnDays ? `${p.returnDays} dias` : "—"}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {p.touchupDays ? `${p.touchupDays} dias` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {p.active ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Ativo
                          </span>
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                            Inativo
                          </span>
                        )}
                      </td>
                      {canManage ? (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <ProcedureFormButton
                              initial={{
                                id: p.id,
                                name: p.name,
                                category: p.category ?? "",
                                durationMinutes: p.durationMinutes,
                                price: Number(p.price).toFixed(2).replace(".", ","),
                                returnDays: p.returnDays?.toString() ?? "",
                                touchupDays: p.touchupDays?.toString() ?? "",
                                preCare: p.preCare ?? "",
                                postCare: p.postCare ?? "",
                                commissionDefaultPct: p.commissionDefaultPct
                                  ? Number(p.commissionDefaultPct).toString()
                                  : "",
                              }}
                            />
                            <ToggleActiveButton kind="procedure" id={p.id} active={p.active} />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : packages.length === 0 ? (
          <EmptyState
            title="Crie um pacote de sessões (ex.: Drenagem — 12 sessões). O sistema controla o saldo a cada atendimento e avisa a cliente quando estiver acabando."
            action={
              canManage ? (
                <PackageFormButton
                  procedures={activeProcedures.map((p) => ({ id: p.id, name: p.name }))}
                />
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3 font-medium">Pacote</th>
                  <th className="px-4 py-3 font-medium">Sessões</th>
                  <th className="px-4 py-3 font-medium">Validade</th>
                  <th className="px-4 py-3 font-medium">Preço</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {canManage ? <th className="px-4 py-3" /> : null}
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => {
                  const item = pkg.items[0];
                  return (
                    <tr key={pkg.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-stone-800">{pkg.name}</td>
                      <td className="px-4 py-3 text-stone-600">
                        {item ? `${item.sessions}× ${item.procedureName}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {pkg.validityDays ? `${pkg.validityDays} dias` : "Sem validade"}
                      </td>
                      <td className="px-4 py-3 text-stone-600">{formatBRL(pkg.price)}</td>
                      <td className="px-4 py-3">
                        {pkg.active ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Ativo
                          </span>
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                            Inativo
                          </span>
                        )}
                      </td>
                      {canManage ? (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <PackageFormButton
                              procedures={activeProcedures.map((p) => ({
                                id: p.id,
                                name: p.name,
                              }))}
                              initial={{
                                id: pkg.id,
                                name: pkg.name,
                                price: Number(pkg.price).toFixed(2).replace(".", ","),
                                validityDays: pkg.validityDays?.toString() ?? "",
                                procedureId: item?.procedureId ?? "",
                                sessions: item?.sessions ?? 1,
                              }}
                            />
                            <ToggleActiveButton kind="package" id={pkg.id} active={pkg.active} />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
