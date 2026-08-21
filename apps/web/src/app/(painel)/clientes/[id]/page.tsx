import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  type AnamnesisAnswers,
  type AnamnesisSchema,
} from "@clinicaos/core/anamnesis";
import { decryptSensitive } from "@clinicaos/core/crypto";
import { can } from "@clinicaos/core/permissions";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { schema, withTenant } from "@clinicaos/db";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { AnamnesisForm } from "./anamnesis-form";
import { DadosForm } from "./dados-form";
import { HeaderActions } from "./header-actions";
import { HistoryFormButton } from "./history-form";
import { AssignPackageButton } from "./package-assign";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  lead: { label: "Lead", className: "bg-sky-50 text-sky-700" },
  active: { label: "Ativa", className: "bg-emerald-50 text-emerald-700" },
  at_risk: { label: "Em risco", className: "bg-amber-50 text-amber-700" },
  inactive: { label: "Inativa", className: "bg-stone-100 text-stone-500" },
};

type Tab = "dados" | "anamnese" | "historico" | "pacotes";

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab =
    sp.tab === "anamnese"
      ? "anamnese"
      : sp.tab === "historico"
        ? "historico"
        : sp.tab === "pacotes"
          ? "pacotes"
          : "dados";

  const canClinicalRead = can(auth.role, "customers.clinical.read");

  const data = await withTenant(
    auth.clinicId,
    async (tx) => {
      const customerRows = await tx
        .select()
        .from(schema.customers)
        .where(and(eq(schema.customers.id, id), isNull(schema.customers.deletedAt)))
        .limit(1);
      const customer = customerRows[0];
      if (!customer) return null;

      // Histórico COMPLETO: atendimentos da agenda (compareceu) ∪ pré-sistema,
      // sem contar dobrado o mesmo dia (mesma regra do score da Inteligência)
      const historyRaw = await tx.execute(sql`
        SELECT id, occurred_on, procedure_name, amount, notes, origem FROM (
          SELECT a.id::text, (a.starts_at AT TIME ZONE 'America/Sao_Paulo')::date AS occurred_on,
                 p.name AS procedure_name, a.price AS amount, a.notes, 'agenda' AS origem
          FROM appointments a
          LEFT JOIN procedures p ON p.id = a.procedure_id
          WHERE a.customer_id = ${id} AND a.status = 'showed'
          UNION ALL
          SELECT h.id::text, h.occurred_on,
                 COALESCE((SELECT p2.name FROM procedures p2 WHERE p2.id = h.procedure_id), h.procedure_name),
                 h.amount, h.notes, 'registro' AS origem
          FROM customer_history_entries h
          WHERE h.customer_id = ${id}
            AND NOT EXISTS (
              SELECT 1 FROM appointments a2
              WHERE a2.customer_id = ${id} AND a2.status = 'showed'
                AND (a2.starts_at AT TIME ZONE 'America/Sao_Paulo')::date = h.occurred_on
            )
        ) t ORDER BY occurred_on DESC
      `);
      const history = (historyRaw.rows as unknown as {
        id: string;
        occurred_on: string;
        procedure_name: string | null;
        amount: string | null;
        notes: string | null;
        origem: string;
      }[]).map((r) => ({
        id: r.id,
        occurredOn: r.occurred_on,
        procedureName: r.procedure_name,
        amount: r.amount,
        notes: r.notes,
      }));

      const latestAnamnesis = (
        await tx
          .select()
          .from(schema.anamnesisResponses)
          .where(eq(schema.anamnesisResponses.customerId, id))
          .orderBy(desc(schema.anamnesisResponses.filledAt))
          .limit(1)
      )[0];

      const templateVersion = (
        await tx
          .select({
            id: schema.anamnesisTemplateVersions.id,
            schema: schema.anamnesisTemplateVersions.schema,
            templateName: schema.anamnesisTemplates.name,
          })
          .from(schema.anamnesisTemplateVersions)
          .innerJoin(
            schema.anamnesisTemplates,
            eq(schema.anamnesisTemplates.id, schema.anamnesisTemplateVersions.templateId),
          )
          .where(eq(schema.anamnesisTemplates.active, true))
          .orderBy(desc(schema.anamnesisTemplateVersions.version))
          .limit(1)
      )[0];

      const procedures = await tx
        .select({ id: schema.procedures.id, name: schema.procedures.name })
        .from(schema.procedures)
        .where(eq(schema.procedures.active, true))
        .orderBy(schema.procedures.name);

      const customerPackages = await tx
        .select({
          id: schema.customerPackages.id,
          sessionsTotal: schema.customerPackages.sessionsTotal,
          sessionsUsed: schema.customerPackages.sessionsUsed,
          status: schema.customerPackages.status,
          expiresAt: schema.customerPackages.expiresAt,
          pricePaid: schema.customerPackages.pricePaid,
          packageName: schema.packages.name,
          procedureName: sql<string | null>`(SELECT p2.name FROM procedures p2 WHERE p2.id = customer_packages.procedure_id)`,
        })
        .from(schema.customerPackages)
        .innerJoin(schema.packages, eq(schema.packages.id, schema.customerPackages.packageId))
        .where(eq(schema.customerPackages.customerId, id))
        .orderBy(desc(schema.customerPackages.createdAt));

      const packageModels = await tx
        .select({
          id: schema.packages.id,
          name: schema.packages.name,
          price: schema.packages.price,
        })
        .from(schema.packages)
        .where(eq(schema.packages.active, true))
        .orderBy(schema.packages.name);

      const otherCustomers = await tx
        .select({
          id: schema.customers.id,
          fullName: schema.customers.fullName,
          phoneE164: schema.customers.phoneE164,
        })
        .from(schema.customers)
        .where(and(isNull(schema.customers.deletedAt), ne(schema.customers.id, id)))
        .orderBy(schema.customers.fullName)
        .limit(300);

      return {
        customer,
        history,
        latestAnamnesis,
        templateVersion,
        procedures,
        otherCustomers,
        customerPackages,
        packageModels,
      };
    },
    auth.userId,
  );

  if (!data) notFound();
  const {
    customer,
    history,
    latestAnamnesis,
    templateVersion,
    procedures,
    otherCustomers,
    customerPackages,
    packageModels,
  } = data;

  // Dados de saúde: decifra apenas para quem tem permissão clínica
  let anamnesisAnswers: AnamnesisAnswers | null = null;
  if (canClinicalRead && latestAnamnesis && process.env.SENSITIVE_DATA_KEY) {
    try {
      anamnesisAnswers = JSON.parse(
        decryptSensitive(latestAnamnesis.answersEncrypted, process.env.SENSITIVE_DATA_KEY),
      ) as AnamnesisAnswers;
    } catch {
      anamnesisAnswers = null;
    }
  }

  const visits = history.length;
  const totalSpent = history.reduce((acc, h) => acc + (h.amount ? Number(h.amount) : 0), 0);
  const lastVisit = history[0]?.occurredOn ?? null;
  const badge = STATUS_BADGE[customer.status] ?? STATUS_BADGE.lead!;
  const initials = customer.fullName
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="p-8">
      <Link href="/clientes" className="text-sm text-stone-400 hover:text-stone-600">
        ← Clientes
      </Link>

      {/* Header fixo da ficha */}
      <div className="mt-3 rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-800">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-stone-800">
                  {customer.socialName ?? customer.fullName}
                </h1>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
              <p className="text-sm text-stone-500">{formatPhoneBR(customer.phoneE164)}</p>
            </div>
          </div>
          <HeaderActions
            customerId={customer.id}
            blocked={customer.automationsBlocked}
            others={otherCustomers.map((o) => ({
              id: o.id,
              label: `${o.fullName} — ${formatPhoneBR(o.phoneE164)}`,
            }))}
          />
        </div>

        {/* Alerta clínico — visível em todas as abas */}
        {canClinicalRead && latestAnamnesis?.riskSummary ? (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            ⚠ {latestAnamnesis.riskSummary}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-3 gap-4 border-t border-stone-100 pt-4 text-center">
          <div>
            <p className="text-lg font-semibold text-stone-800">{visits}</p>
            <p className="text-xs text-stone-500">visitas</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-800">
              {totalSpent > 0 ? formatBRL(totalSpent) : "—"}
            </p>
            <p className="text-xs text-stone-500">total investido</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-800">
              {lastVisit ? new Date(`${lastVisit}T12:00:00`).toLocaleDateString("pt-BR") : "—"}
            </p>
            <p className="text-xs text-stone-500">última visita</p>
          </div>
        </div>
      </div>

      {/* Abas */}
      <div className="mt-5 flex gap-1 border-b border-stone-200">
        {(
          [
            ["dados", "Dados"],
            ["anamnese", "Anamnese"],
            ["historico", "Histórico"],
            ["pacotes", "Pacotes"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/clientes/${customer.id}?tab=${key}`}
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

      <div className="mt-6 max-w-3xl">
        {tab === "dados" ? (
          <DadosForm
            initial={{
              id: customer.id,
              fullName: customer.fullName,
              phone: formatPhoneBR(customer.phoneE164),
              email: customer.email ?? "",
              cpf: customer.cpf ?? "",
              birthDate: customer.birthDate
                ? new Date(`${customer.birthDate}T12:00:00`).toLocaleDateString("pt-BR")
                : "",
              socialName: customer.socialName ?? "",
              instagram: customer.instagram ?? "",
              source: customer.source ?? "",
              addressStreet: customer.addressStreet ?? "",
              addressNumber: customer.addressNumber ?? "",
              addressDistrict: customer.addressDistrict ?? "",
              addressCity: customer.addressCity ?? "",
              addressState: customer.addressState ?? "",
              addressZip: customer.addressZip ?? "",
              notes: customer.notes ?? "",
            }}
          />
        ) : tab === "anamnese" ? (
          !canClinicalRead ? (
            <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
              A anamnese contém dados de saúde e só é visível para a equipe clínica.
            </p>
          ) : !templateVersion ? (
            <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
              Nenhum modelo de anamnese configurado para a clínica.
            </p>
          ) : (
            <AnamnesisForm
              customerId={customer.id}
              templateVersionId={templateVersion.id}
              templateName={templateVersion.templateName}
              schema={templateVersion.schema as AnamnesisSchema}
              initialAnswers={anamnesisAnswers}
              filledAt={
                latestAnamnesis
                  ? new Date(latestAnamnesis.filledAt).toLocaleDateString("pt-BR")
                  : null
              }
            />
          )
        ) : tab === "pacotes" ? (
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-500">
                Pacotes ativos debitam a sessão sozinhos quando o atendimento é marcado
                como “Compareceu”.
              </p>
              <AssignPackageButton
                customerId={customer.id}
                packages={packageModels.map((p) => ({
                  id: p.id,
                  name: p.name,
                  priceLabel: formatBRL(p.price),
                }))}
              />
            </div>
            <div className="mt-4 space-y-3">
              {customerPackages.length === 0 ? (
                <p className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center text-sm text-stone-500">
                  Nenhum pacote atribuído ainda.
                </p>
              ) : (
                customerPackages.map((pkg) => {
                  const remaining = pkg.sessionsTotal - pkg.sessionsUsed;
                  const pct = Math.min((pkg.sessionsUsed / pkg.sessionsTotal) * 100, 100);
                  return (
                    <div key={pkg.id} className="rounded-xl border border-stone-200 bg-white p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-stone-800">
                            {pkg.packageName}
                          </p>
                          <p className="text-xs text-stone-500">
                            {pkg.procedureName ?? ""} · {formatBRL(pkg.pricePaid)}
                            {pkg.expiresAt
                              ? ` · válido até ${new Date(`${pkg.expiresAt}T12:00:00`).toLocaleDateString("pt-BR")}`
                              : ""}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            pkg.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : pkg.status === "completed"
                                ? "bg-teal-50 text-teal-700"
                                : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {pkg.status === "active"
                            ? "Ativo"
                            : pkg.status === "completed"
                              ? "Concluído"
                              : pkg.status === "expired"
                                ? "Vencido"
                                : "Cancelado"}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-stone-700">
                        {pkg.sessionsUsed} de {pkg.sessionsTotal} sessões usadas —{" "}
                        {remaining} restante{remaining === 1 ? "" : "s"}
                      </p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                        <div
                          className="h-full rounded-full bg-teal-600 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-500">
                Atendimentos anteriores ao sistema também contam para o ranking e as
                reativações — registre-os aqui.
              </p>
              <HistoryFormButton customerId={customer.id} procedures={procedures} />
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {history.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-stone-500">
                  Nenhum atendimento registrado ainda.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                      <th className="px-4 py-3 font-medium">Data</th>
                      <th className="px-4 py-3 font-medium">Procedimento</th>
                      <th className="px-4 py-3 font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Observações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-stone-100 last:border-0">
                        <td className="px-4 py-3 text-stone-600">
                          {new Date(`${h.occurredOn}T12:00:00`).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-3 font-medium text-stone-800">
                          {h.procedureName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-stone-600">
                          {h.amount ? formatBRL(h.amount) : "—"}
                        </td>
                        <td className="px-4 py-3 text-stone-500">{h.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
