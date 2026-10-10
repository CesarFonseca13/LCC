import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseClinicPlan } from "@clinicaos/core/plans";
import { formatBrl, parseSpendSettings } from "@clinicaos/core/spend";
import { adminDb, schema } from "@clinicaos/db";
import { clinicMonthSpend, currentMonth, isDemoClinic, monthLabel, parseBilling, requireSuperadmin } from "@/lib/admin";
import { ClinicAdmin } from "./clinic-admin";

export default async function AdminClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperadmin();
  const { id } = await params;
  const db = adminDb();
  const clinic = (await db.select().from(schema.clinics).where(eq(schema.clinics.id, id)))[0];
  if (!clinic) notFound();

  const members = await db
    .select({
      userId: schema.clinicMembers.userId,
      role: schema.clinicMembers.role,
      active: schema.clinicMembers.active,
      name: schema.users.name,
      email: schema.users.email,
      isSuperadmin: schema.users.isSuperadmin,
    })
    .from(schema.clinicMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.clinicMembers.userId))
    .where(eq(schema.clinicMembers.clinicId, id))
    .orderBy(schema.users.name);
  const instances = await db
    .select({
      id: schema.whatsappInstances.id,
      label: schema.whatsappInstances.label,
      phone: schema.whatsappInstances.phoneE164,
      status: schema.whatsappInstances.status,
      provider: schema.whatsappInstances.provider,
      verifiedName: schema.whatsappInstances.metaVerifiedName,
      coexistence: schema.whatsappInstances.metaCoexistence,
      lastSeenAt: schema.whatsappInstances.lastSeenAt,
    })
    .from(schema.whatsappInstances)
    .where(eq(schema.whatsappInstances.clinicId, id));
  const month = currentMonth();
  const spend = await clinicMonthSpend(id, clinic.timezone, month);
  const plan = parseClinicPlan(clinic.settings);
  const billing = parseBilling(clinic.settings);
  const spendSettings = parseSpendSettings(clinic.settings);
  const settings = (clinic.settings ?? {}) as Record<string, unknown>;
  const ai = (settings.ai ?? {}) as Record<string, unknown>;
  const adminIsMember = members.some((m) => m.userId === auth.userId && m.active);
  const savedLimit = (settings.spend as Record<string, unknown> | undefined)?.monthlyLimitBrl;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-stone-500 hover:underline">← Clínicas</Link>
        <h1 className="mt-1 text-xl font-semibold text-stone-900">
          {clinic.name}
          {isDemoClinic(clinic.settings) ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">demonstração</span> : null}
          {clinic.status !== "active" ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{clinic.status}</span> : null}
        </h1>
        <p className="text-xs text-stone-500">
          Criada em {clinic.createdAt.toISOString().slice(0, 10)} · fuso {clinic.timezone} · wizard {settings.onboarding_done === true ? "concluído" : "pendente"} · assistente {ai.enabled === true ? "ligada" : "desligada"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Info label={`API em ${monthLabel(month)}`} value={formatBrl(spend.aiBrl + spend.metaBrl)} hint={`IA ${formatBrl(spend.aiBrl)} (${spend.aiCalls} chamadas) · Meta ${formatBrl(spend.metaBrl)} (${spend.metaMessages} modelos)`} />
        <Info label="Limite de gastos em vigor" value={formatBrl(spendSettings.monthlyLimitBrl)} hint={savedLimit != null ? "definido manualmente" : plan ? `franquia do plano ${plan.name}` : "padrão da plataforma"} />
        <Info label="Mensalidade" value={formatBrl(billing.customMonthlyBrl ?? plan?.monthlyBrl ?? 0)} hint={billing.customMonthlyBrl !== null ? `negociada · ${billing.note ?? ""}` : plan ? `preço do plano ${plan.name}` : "sem plano"} />
      </div>

      <ClinicAdmin
        clinic={{
          id: clinic.id,
          name: clinic.name,
          status: clinic.status,
          plan: plan?.id ?? "profissional",
          customMonthlyBrl: billing.customMonthlyBrl !== null ? String(billing.customMonthlyBrl).replace(".", ",") : "",
          billingNote: billing.note ?? "",
          monthlyLimitBrl: savedLimit != null ? String(savedLimit).replace(".", ",") : "",
          allowOverage: spendSettings.allowOverage,
          isDemo: isDemoClinic(clinic.settings),
        }}
        members={members.map((m) => ({ ...m, isMe: m.userId === auth.userId }))}
        instances={instances.map((i) => ({ ...i, lastSeenAt: i.lastSeenAt ? i.lastSeenAt.toISOString() : null }))}
        adminIsMember={adminIsMember}
      />
    </div>
  );
}

function Info({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-stone-900">{value}</p>
      {hint ? <p className="text-[11px] text-stone-400">{hint}</p> : null}
    </div>
  );
}
