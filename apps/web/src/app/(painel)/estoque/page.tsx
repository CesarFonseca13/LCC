import { asc, desc, eq, sql } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { MovementButton, NewItemButton, SupplyEditor } from "./stock-client";

export const metadata = { title: "Estoque" };

const KIND_LABEL: Record<string, string> = {
  purchase: "Compra",
  sale: "Venda",
  procedure_use: "Uso em atendimento",
  adjustment: "Ajuste",
  loss: "Perda",
};

export default async function EstoquePage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "stock.read")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Estoque</h1>
        <div className="mt-6">
          <EmptyState title="O estoque é visível para a administradora, a gestora e as profissionais." />
        </div>
      </div>
    );
  }

  const { items, movements, supplies, procedures } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const items = await tx
        .select({
          id: schema.stockItems.id,
          name: schema.stockItems.name,
          unit: schema.stockItems.unit,
          minQuantity: schema.stockItems.minQuantity,
          cost: schema.stockItems.cost,
          balance: sql<string | null>`(
            SELECT COALESCE(sum(quantity), 0) FROM stock_movements sm
            WHERE sm.stock_item_id = stock_items.id
          )`,
        })
        .from(schema.stockItems)
        .where(eq(schema.stockItems.active, true))
        .orderBy(asc(schema.stockItems.name));

      const movements = await tx
        .select({
          id: schema.stockMovements.id,
          kind: schema.stockMovements.kind,
          quantity: schema.stockMovements.quantity,
          unitCost: schema.stockMovements.unitCost,
          notes: schema.stockMovements.notes,
          createdAt: schema.stockMovements.createdAt,
          itemName: schema.stockItems.name,
          unit: schema.stockItems.unit,
        })
        .from(schema.stockMovements)
        .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.stockMovements.stockItemId))
        .orderBy(desc(schema.stockMovements.createdAt))
        .limit(20);

      const supplies = await tx
        .select({
          id: schema.procedureSupplies.id,
          quantity: schema.procedureSupplies.quantityPerSession,
          procedureName: schema.procedures.name,
          itemName: schema.stockItems.name,
          unit: schema.stockItems.unit,
        })
        .from(schema.procedureSupplies)
        .innerJoin(schema.procedures, eq(schema.procedures.id, schema.procedureSupplies.procedureId))
        .innerJoin(schema.stockItems, eq(schema.stockItems.id, schema.procedureSupplies.stockItemId))
        .orderBy(asc(schema.procedures.name));

      const procedures = await tx
        .select({ id: schema.procedures.id, name: schema.procedures.name })
        .from(schema.procedures)
        .where(eq(schema.procedures.active, true))
        .orderBy(asc(schema.procedures.name));

      return { items, movements, supplies, procedures };
    },
    auth.userId,
  );

  const canManage = can(auth.role, "stock.manage");
  const lowItems = items.filter((i) => Number(i.balance ?? 0) < Number(i.minQuantity));
  const options = items.map((i) => ({ id: i.id, name: i.name }));

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Estoque</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            O saldo baixa sozinho quando você marca “Compareceu” — configure o consumo
            de cada procedimento abaixo.
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            {items.length > 0 ? <MovementButton items={options} /> : null}
            <NewItemButton />
          </div>
        ) : null}
      </div>

      {lowItems.length > 0 ? (
        <div className="mt-4 max-w-4xl rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠ {lowItems.length === 1 ? "1 item está" : `${lowItems.length} itens estão`} abaixo
          do mínimo: {lowItems.map((i) => i.name).join(", ")} — hora de repor.
        </div>
      ) : null}

      <div className="mt-6 max-w-4xl space-y-6">
        {items.length === 0 ? (
          <EmptyState
            title="Cadastre os materiais que a clínica usa (toxina, fios, cremes...) e o estoque passa a se controlar sozinho."
            action={canManage ? <NewItemButton /> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Em estoque</th>
                  <th className="px-4 py-3 font-medium">Mínimo</th>
                  <th className="px-4 py-3 font-medium">Custo unit.</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const balance = Number(item.balance ?? 0);
                  const low = balance < Number(item.minQuantity);
                  return (
                    <tr key={item.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-stone-800">{item.name}</td>
                      <td className="px-4 py-3 text-stone-800">
                        {balance} {item.unit}
                      </td>
                      <td className="px-4 py-3 text-stone-500">
                        {Number(item.minQuantity)} {item.unit}
                      </td>
                      <td className="px-4 py-3 text-stone-600">{formatBRL(item.cost)}</td>
                      <td className="px-4 py-3">
                        {low ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                            Repor
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canManage && items.length > 0 ? (
          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-stone-700">Consumo por procedimento</h2>
            <p className="mt-0.5 text-xs text-stone-500">
              É daqui que sai a baixa automática — e o custo de materiais nos Relatórios.
            </p>
            <div className="mt-3">
              <SupplyEditor
                procedures={procedures}
                items={options}
                supplies={supplies.map((s) => ({
                  id: s.id,
                  procedureName: s.procedureName,
                  itemName: s.itemName,
                  quantity: s.quantity,
                  unit: s.unit,
                }))}
              />
            </div>
          </section>
        ) : null}

        {movements.length > 0 ? (
          <section className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-stone-700">Últimos movimentos</h2>
            <ul className="mt-3 divide-y divide-stone-100 text-sm">
              {movements.map((m) => {
                const qty = Number(m.quantity);
                return (
                  <li key={m.id} className="flex items-center justify-between py-2">
                    <span className="text-stone-700">
                      {m.itemName}
                      <span className="ml-2 text-xs text-stone-400">
                        {KIND_LABEL[m.kind] ?? m.kind}
                        {m.notes ? ` · ${m.notes}` : ""}
                      </span>
                    </span>
                    <span
                      className={`font-medium tabular-nums ${qty >= 0 ? "text-emerald-700" : "text-red-600"}`}
                    >
                      {qty > 0 ? "+" : ""}
                      {qty} {m.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
