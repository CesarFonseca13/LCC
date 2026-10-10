import { and, eq, gte, lt, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { COMMERCIAL_RULES, type Plan, parseClinicPlan } from "@clinicaos/core/plans";
import { parseSpendSettings } from "@clinicaos/core/spend";
import { todayISO, zonedToUtc } from "@clinicaos/core/timezone";
import { adminDb, hasAdminDb, schema } from "@clinicaos/db";
import { getAuth, type AuthContext } from "@/lib/session";

/** Só o superadmin da plataforma entra em /admin. Qualquer outro vai para o painel normal. */
export async function requireSuperadmin(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.isSuperadmin) redirect("/inicio");
  if (!hasAdminDb()) {
    throw new Error("DATABASE_URL_ADMIN não configurada no servidor — veja infra/docker-compose.yml.");
  }
  return auth;
}

export async function platformAudit(
  adminUserId: string,
  action: string,
  opts: { clinicId?: string | null; target?: string | null; details?: Record<string, unknown> } = {},
): Promise<void> {
  await adminDb().insert(schema.platformAuditLog).values({
    adminUserId,
    action,
    clinicId: opts.clinicId ?? null,
    target: opts.target ?? null,
    details: opts.details ?? null,
  });
}

// ── Faturamento ──────────────────────────────────────────────────────

export interface ClinicBilling {
  /** Mensalidade negociada (settings.billing.monthlyBrl) ou null = preço do plano. */
  customMonthlyBrl: number | null;
  /** Observação livre, ex.: "cliente fundadora, R$ 200 até 09/2027". */
  note: string | null;
}

export function parseBilling(settings: unknown): ClinicBilling {
  const b = ((settings ?? {}) as Record<string, unknown>).billing as Record<string, unknown> | undefined;
  const n = Number(b?.monthlyBrl);
  return {
    customMonthlyBrl: Number.isFinite(n) && n >= 0 && b?.monthlyBrl !== undefined && b?.monthlyBrl !== null ? n : null,
    note: typeof b?.note === "string" && b.note.trim() ? b.note.trim() : null,
  };
}

export function isDemoClinic(settings: unknown): boolean {
  return ((settings ?? {}) as Record<string, unknown>).isDemo === true;
}

export interface MonthSpendRow {
  aiBrl: number;
  metaBrl: number;
  aiCalls: number;
  metaMessages: number;
}

/** Gasto de API de UMA clínica num mês "YYYY-MM" (fuso da clínica). */
export async function clinicMonthSpend(clinicId: string, tz: string, month: string): Promise<MonthSpendRow> {
  const db = adminDb();
  const since = zonedToUtc(`${month}-01`, "00:00", tz);
  const [y, m] = month.split("-").map(Number);
  const nextMonth = `${m === 12 ? y! + 1 : y}-${String(m === 12 ? 1 : m! + 1).padStart(2, "0")}-01`;
  const until = zonedToUtc(nextMonth, "00:00", tz);
  const ai = (
    await db
      .select({ total: sql<string>`COALESCE(sum(cost_brl), 0)::text`, n: sql<number>`count(*)::int` })
      .from(schema.aiUsage)
      .where(and(eq(schema.aiUsage.clinicId, clinicId), gte(schema.aiUsage.createdAt, since), lt(schema.aiUsage.createdAt, until)))
  )[0];
  const meta = (
    await db
      .select({ total: sql<string>`COALESCE(sum(cost_brl), 0)::text`, n: sql<number>`count(*)::int` })
      .from(schema.whatsappUsage)
      .where(
        and(eq(schema.whatsappUsage.clinicId, clinicId), gte(schema.whatsappUsage.createdAt, since), lt(schema.whatsappUsage.createdAt, until)),
      )
  )[0];
  return { aiBrl: Number(ai?.total ?? 0), metaBrl: Number(meta?.total ?? 0), aiCalls: ai?.n ?? 0, metaMessages: meta?.n ?? 0 };
}

export interface InvoiceLine {
  clinicId: string;
  clinicName: string;
  status: string;
  isDemo: boolean;
  plan: Plan | null;
  monthlyBrl: number;
  customPrice: boolean;
  spendBrl: number;
  allowanceBrl: number;
  allowOverage: boolean;
  /** Excedente já com o acréscimo, só se a clínica liberou ultrapassar. */
  overageChargeBrl: number;
  totalBrl: number;
  aiCalls: number;
  metaMessages: number;
}

/** Fatura estimada de todas as clínicas num mês. Demo não entra no total. */
export async function invoiceForMonth(month: string): Promise<InvoiceLine[]> {
  const db = adminDb();
  const clinics = await db
    .select({ id: schema.clinics.id, name: schema.clinics.name, timezone: schema.clinics.timezone, settings: schema.clinics.settings, status: schema.clinics.status })
    .from(schema.clinics)
    .orderBy(schema.clinics.name);
  const lines: InvoiceLine[] = [];
  for (const c of clinics) {
    const plan = parseClinicPlan(c.settings);
    const billing = parseBilling(c.settings);
    const spendSettings = parseSpendSettings(c.settings);
    const spend = await clinicMonthSpend(c.id, c.timezone, month);
    const spendBrl = spend.aiBrl + spend.metaBrl;
    const allowanceBrl = plan?.apiAllowanceBrl ?? spendSettings.monthlyLimitBrl;
    const monthlyBrl = billing.customMonthlyBrl ?? plan?.monthlyBrl ?? 0;
    const overage = Math.max(0, spendBrl - allowanceBrl);
    const overageChargeBrl = spendSettings.allowOverage ? Math.round(overage * (1 + COMMERCIAL_RULES.apiOverageMarkup) * 100) / 100 : 0;
    lines.push({
      clinicId: c.id,
      clinicName: c.name,
      status: c.status,
      isDemo: isDemoClinic(c.settings),
      plan,
      monthlyBrl,
      customPrice: billing.customMonthlyBrl !== null,
      spendBrl: Math.round(spendBrl * 100) / 100,
      allowanceBrl,
      allowOverage: spendSettings.allowOverage,
      overageChargeBrl,
      totalBrl: Math.round((monthlyBrl + overageChargeBrl) * 100) / 100,
      aiCalls: spend.aiCalls,
      metaMessages: spend.metaMessages,
    });
  }
  return lines;
}

export function currentMonth(): string {
  return todayISO("America/Sao_Paulo").slice(0, 7);
}

export function lastMonths(n: number): string[] {
  const [y, m] = currentMonth().split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_PT[Number(m) - 1]}/${y}`;
}
