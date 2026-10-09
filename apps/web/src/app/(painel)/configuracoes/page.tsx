import { eq, sql } from "drizzle-orm";
import { parseClinicAiProvider, resolveAiConfig } from "@clinicaos/ai/provider";
import { can } from "@clinicaos/core/permissions";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { parseClinicPlan } from "@clinicaos/core/plans";
import { metaTemplateCostBrl, parseSpendSettings, usdBrlRate } from "@clinicaos/core/spend";
import { todayISO } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/clinic-profile";
import { AiCard } from "./ai-card";
import { AiProviderCard } from "./ai-provider-card";
import { BookingCard } from "./booking-card";
import { ClinicCard, type ClinicProfileView } from "./clinic-card";
import { SpendCard, type SpendMonthRow, type SpendView } from "./spend-card";
import { WhatsAppCard } from "./whatsapp-card";

export const metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "settings.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Configurações</h1>
        <div className="mt-6">
          <EmptyState title="Somente a administradora da clínica pode alterar as configurações." />
        </div>
      </div>
    );
  }

  const { instances, templateRows, aiProvider, aiSettings, booking, clinicProfile, spendView } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const instances = await tx
        .select({
          id: schema.whatsappInstances.id,
          label: schema.whatsappInstances.label,
          status: schema.whatsappInstances.status,
          phoneE164: schema.whatsappInstances.phoneE164,
          qrCode: schema.whatsappInstances.qrCode,
          isPrimary: schema.whatsappInstances.isPrimary,
          createdAt: schema.whatsappInstances.createdAt,
          provider: schema.whatsappInstances.provider,
          metaPhoneNumberId: schema.whatsappInstances.metaPhoneNumberId,
          metaWabaId: schema.whatsappInstances.metaWabaId,
          metaTokenHint: schema.whatsappInstances.metaTokenHint,
          metaVerifiedName: schema.whatsappInstances.metaVerifiedName,
          metaCoexistence: schema.whatsappInstances.metaCoexistence,
        })
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.clinicId, auth.clinicId!))
        .orderBy(schema.whatsappInstances.createdAt);
      const templateRows = await tx
        .select({
          instanceId: schema.whatsappTemplates.instanceId,
          status: schema.whatsappTemplates.status,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.whatsappTemplates)
        .groupBy(schema.whatsappTemplates.instanceId, schema.whatsappTemplates.status);
      const clinic = (
        await tx
          .select()
          .from(schema.clinics)
          .where(eq(schema.clinics.id, auth.clinicId!))
          .limit(1)
      )[0];
      const clinicSettings = (clinic?.settings ?? {}) as Record<string, unknown>;
      const ai = clinicSettings.ai as Record<string, unknown> | undefined;
      const aiProvider = parseClinicAiProvider(clinic?.settings);
      const savedHours = (clinic?.businessHours ?? {}) as BusinessHours;
      const clinicProfile: ClinicProfileView = {
        name: clinic?.name ?? "",
        legalName: clinic?.legalName ?? "",
        cnpj: clinic?.cnpj ?? "",
        phone: clinic?.phone ? formatPhoneBR(clinic.phone) : "",
        email: clinic?.email ?? "",
        addressZip: clinic?.addressZip ?? "",
        addressStreet: clinic?.addressStreet ?? "",
        addressNumber: clinic?.addressNumber ?? "",
        addressComplement: clinic?.addressComplement ?? "",
        addressDistrict: clinic?.addressDistrict ?? "",
        addressCity: clinic?.addressCity ?? "",
        addressState: clinic?.addressState ?? "",
        timezone: clinic?.timezone ?? "America/Sao_Paulo",
        googleReviewUrl: clinic?.googleReviewUrl ?? "",
        specialty:
          typeof clinicSettings.specialty === "string" ? clinicSettings.specialty : "estetica_facial",
        specialtyOther:
          typeof clinicSettings.specialtyOther === "string" ? clinicSettings.specialtyOther : "",
        businessHours: Object.keys(savedHours).length > 0 ? savedHours : DEFAULT_BUSINESS_HOURS,
      };
      // Gastos com API: mês atual + 6 anteriores, no fuso da clínica
      const tz = clinic?.timezone ?? "America/Sao_Paulo";
      const currentMonth = todayISO(tz).slice(0, 7);
      const spendRaw = await tx.execute(sql`
        SELECT month,
               sum(ai)::text AS ai_brl, sum(meta)::text AS meta_brl,
               sum(ai_calls)::int AS ai_calls, sum(meta_msgs)::int AS meta_msgs
        FROM (
          SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
                 cost_brl AS ai, 0 AS meta, 1 AS ai_calls, 0 AS meta_msgs
            FROM ai_usage
           WHERE clinic_id = ${auth.clinicId!} AND created_at >= now() - interval '7 months'
          UNION ALL
          SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM'),
                 0, cost_brl, 0, 1
            FROM whatsapp_usage
           WHERE clinic_id = ${auth.clinicId!} AND created_at >= now() - interval '7 months'
        ) u
        GROUP BY month ORDER BY month DESC LIMIT 7
      `);
      const spendRows = (spendRaw.rows as unknown as {
        month: string; ai_brl: string; meta_brl: string; ai_calls: number; meta_msgs: number;
      }[]).map<SpendMonthRow>((r) => ({
        month: r.month,
        aiBrl: Number(r.ai_brl),
        metaBrl: Number(r.meta_brl),
        aiCalls: r.ai_calls,
        metaMessages: r.meta_msgs,
      }));
      const spendSettings = parseSpendSettings(clinic?.settings);
      const spendView: SpendView = {
        currentMonth,
        current: spendRows.find((r) => r.month === currentMonth) ?? {
          month: currentMonth, aiBrl: 0, metaBrl: 0, aiCalls: 0, metaMessages: 0,
        },
        history: spendRows.filter((r) => r.month !== currentMonth),
        monthlyLimitBrl: spendSettings.monthlyLimitBrl,
        allowOverage: spendSettings.allowOverage,
        ownAiKey: aiProvider.mode === "custom",
        plan: (() => {
          const plan = parseClinicPlan(clinic?.settings);
          return plan ? { name: plan.name, apiAllowanceBrl: plan.apiAllowanceBrl } : null;
        })(),
        usdBrlRate: usdBrlRate(process.env),
        metaPrices: {
          utility: metaTemplateCostBrl("utility"),
          marketing: metaTemplateCostBrl("marketing"),
          authentication: metaTemplateCostBrl("authentication"),
        },
      };
      return {
        instances,
        templateRows,
        aiProvider,
        clinicProfile,
        spendView,
        aiSettings: {
          enabled: ai?.enabled === true,
          assistantName:
            typeof ai?.assistantName === "string" && ai.assistantName
              ? ai.assistantName
              : "Ana",
          tone: typeof ai?.tone === "string" ? ai.tone : "acolhedora",
          offers: ai?.offers !== false,
        },
        booking: {
          enabled: clinic?.onlineBookingEnabled ?? false,
          slug:
            clinic?.bookingSlug ??
            (clinic?.name ?? "clinica")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[̀-ͯ]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, ""),
        },
      };
    },
    auth.userId,
  );

  return (
    <div className="p-8">
      {/* Status do WhatsApp muda sozinho (vigia) — a página acompanha sem F5 */}
      <AutoRefresh seconds={10} />
      <h1 className="text-xl font-semibold text-stone-800">Configurações</h1>
      <p className="mt-0.5 text-sm text-stone-500">
        Dados da clínica, WhatsApp e preferências.
      </p>

      <div className="mt-6 max-w-2xl space-y-6">
        <WhatsAppCard
          initialInstances={instances.map((inst, i) => {
            const counts = { approved: 0, pending: 0, rejected: 0, total: 0 };
            for (const row of templateRows) {
              if (row.instanceId !== inst.id) continue;
              counts.total += row.n;
              if (row.status === "approved") counts.approved += row.n;
              else if (row.status === "pending") counts.pending += row.n;
              else counts.rejected += row.n;
            }
            return {
              id: inst.id,
              label: inst.label ?? (inst.isPrimary ? "Principal" : `Número ${i + 1}`),
              phone: inst.phoneE164 ? formatPhoneBR(inst.phoneE164) : null,
              status: inst.status,
              qr: inst.qrCode,
              isPrimary: inst.isPrimary,
              provider: inst.provider,
              meta:
                inst.provider === "meta"
                  ? {
                      phoneNumberId: inst.metaPhoneNumberId ?? "",
                      wabaId: inst.metaWabaId ?? "",
                      tokenHint: inst.metaTokenHint,
                      verifiedName: inst.metaVerifiedName,
                      coexistence: inst.metaCoexistence,
                      templates: counts,
                    }
                  : null,
            };
          })}
          metaSetup={{
            webhookUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/webhooks/meta`,
            verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null,
            hasCentralSecret: Boolean(process.env.META_APP_SECRET),
            appId: process.env.META_APP_ID ?? null,
            configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? null,
            graphVersion: process.env.META_GRAPH_VERSION ?? "v23.0",
          }}
        />

        <ClinicCard initial={clinicProfile} />

        <SpendCard view={spendView} />

        <AiCard
          hasApiKey={
            resolveAiConfig(process.env) !== null || aiProvider.mode === "custom"
          }
          initial={aiSettings}
        />

        <AiProviderCard
          initial={{
            mode: aiProvider.mode,
            provider: aiProvider.provider,
            baseURL: aiProvider.baseURL ?? "",
            agentModel: aiProvider.agentModel ?? "",
            classifierModel: aiProvider.classifierModel ?? "",
            keyHint: aiProvider.keyHint,
          }}
          systemDefaultLabel={(() => {
            const config = resolveAiConfig(process.env);
            if (!config) return null;
            return config.provider === "anthropic"
              ? `Claude (${config.agentModel})`
              : config.agentModel;
          })()}
        />

        <BookingCard
          appUrl={process.env.APP_URL ?? "http://localhost:3000"}
          initial={booking}
        />
      </div>
    </div>
  );
}
