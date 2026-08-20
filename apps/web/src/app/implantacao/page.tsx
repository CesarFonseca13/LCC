import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { can } from "@clinicaos/core/permissions";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { schema, withTenant } from "@clinicaos/db";
import { requireAuth } from "@/lib/auth-action";
import { Wizard } from "./wizard";

export const metadata = { title: "Implantação" };

export default async function ImplantacaoPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) redirect("/inicio");
  if (!can(auth.role, "settings.manage")) redirect("/inicio");

  const data = await withTenant(
    auth.clinicId,
    async (tx) => {
      const clinic = (
        await tx
          .select()
          .from(schema.clinics)
          .where(eq(schema.clinics.id, auth.clinicId!))
          .limit(1)
      )[0];
      const procedures = await tx
        .select({ id: schema.procedures.id, name: schema.procedures.name })
        .from(schema.procedures)
        .where(eq(schema.procedures.active, true));
      const professionals = await tx
        .select({ id: schema.professionals.id, name: schema.professionals.name })
        .from(schema.professionals)
        .where(eq(schema.professionals.active, true));
      const customersCount = (
        await tx
          .select({ count: schema.customers.id })
          .from(schema.customers)
          .limit(1)
      ).length;
      const instance = (
        await tx
          .select({
            status: schema.whatsappInstances.status,
            phoneE164: schema.whatsappInstances.phoneE164,
            qrCode: schema.whatsappInstances.qrCode,
          })
          .from(schema.whatsappInstances)
          .where(eq(schema.whatsappInstances.clinicId, auth.clinicId!))
          .limit(1)
      )[0];
      const automations = await tx
        .select({
          automationId: schema.automationSettings.automationId,
          enabled: schema.automationSettings.enabled,
        })
        .from(schema.automationSettings);
      return { clinic, procedures, professionals, customersCount, instance, automations };
    },
    auth.userId,
  );

  if (!data.clinic) redirect("/inicio");
  const settings = (data.clinic.settings ?? {}) as Record<string, unknown>;

  return (
    <Wizard
      initial={{
        clinicName: data.clinic.name,
        city: data.clinic.addressCity ?? "",
        state: data.clinic.addressState ?? "",
        specialty: (settings.specialty as string) ?? "estetica_facial",
        procedures: data.procedures.map((p) => p.name),
        professionals: data.professionals.map((p) => p.name),
        whatsapp: {
          status: data.instance?.status ?? "none",
          qr: data.instance?.qrCode ?? null,
          phone: data.instance?.phoneE164 ? formatPhoneBR(data.instance.phoneE164) : null,
        },
        automationsOn: data.automations.some((a) => a.enabled),
      }}
    />
  );
}
