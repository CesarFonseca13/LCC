import { eq } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { AiCard } from "./ai-card";
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

  const { instance, aiSettings } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const instance =
        (
          await tx
            .select({
              status: schema.whatsappInstances.status,
              phoneE164: schema.whatsappInstances.phoneE164,
              qrCode: schema.whatsappInstances.qrCode,
            })
            .from(schema.whatsappInstances)
            .where(eq(schema.whatsappInstances.clinicId, auth.clinicId!))
            .limit(1)
        )[0] ?? null;
      const clinic = (
        await tx
          .select({ settings: schema.clinics.settings })
          .from(schema.clinics)
          .where(eq(schema.clinics.id, auth.clinicId!))
          .limit(1)
      )[0];
      const ai = ((clinic?.settings ?? {}) as Record<string, unknown>).ai as
        | Record<string, unknown>
        | undefined;
      return {
        instance,
        aiSettings: {
          enabled: ai?.enabled === true,
          assistantName:
            typeof ai?.assistantName === "string" && ai.assistantName
              ? ai.assistantName
              : "Ana",
          tone: typeof ai?.tone === "string" ? ai.tone : "acolhedora",
        },
      };
    },
    auth.userId,
  );

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-stone-800">Configurações</h1>
      <p className="mt-0.5 text-sm text-stone-500">
        Dados da clínica, WhatsApp e preferências.
      </p>

      <div className="mt-6 max-w-2xl space-y-6">
        <WhatsAppCard
          initialStatus={instance?.status ?? "none"}
          initialQr={instance?.qrCode ?? null}
          initialPhone={instance?.phoneE164 ? formatPhoneBR(instance.phoneE164) : null}
        />

        <AiCard hasApiKey={Boolean(process.env.ANTHROPIC_API_KEY)} initial={aiSettings} />

        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-stone-700">Dados da clínica</h2>
          <p className="mt-2 text-sm text-stone-500">
            Nome, logo, endereço e horários de funcionamento — em construção (chega junto
            com o wizard de implantação).
          </p>
        </section>
      </div>
    </div>
  );
}
