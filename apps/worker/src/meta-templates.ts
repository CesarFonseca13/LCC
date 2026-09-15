import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import {
  META_TEMPLATE_CATALOG,
  META_TEMPLATE_LANGUAGE,
  MetaApiError,
  metaStatusToLocal,
  toMetaSpec,
} from "@clinicaos/whatsapp";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { metaClientFor } from "./meta-client";

/**
 * Templates da API oficial: garante que cada número 'meta' tenha o catálogo
 * registrado na conta da clínica e acompanha a aprovação da Meta (até 24h).
 * Sem template aprovado, a automação correspondente não sai fora da janela
 * de 24h — o status fica visível em Configurações.
 */
export async function syncMetaTemplates(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const instances = await db
    .select()
    .from(schema.whatsappInstances)
    .where(eq(schema.whatsappInstances.provider, "meta"));
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  for (const inst of instances) {
    if (!inst.metaWabaId || inst.status === "disconnected") continue;
    const client = metaClientFor(inst);
    if (!client) continue;

    let remote: Awaited<ReturnType<typeof client.listTemplates>>;
    try {
      remote = await client.listTemplates();
    } catch (err) {
      logger.warn({ instance: inst.evolutionInstanceName, err: String(err) }, "meta: falha ao listar templates");
      continue;
    }

    for (const entry of META_TEMPLATE_CATALOG) {
      await db
        .insert(schema.whatsappTemplates)
        .values({
          clinicId: inst.clinicId,
          instanceId: inst.id,
          purpose: entry.purpose,
          metaName: entry.name,
          language: META_TEMPLATE_LANGUAGE,
          category: entry.category,
          bodyText: entry.bodyText,
          paramNames: entry.paramNames,
          buttonUrlParam: entry.button?.param ?? null,
        })
        .onConflictDoNothing();
      const local = (
        await db
          .select()
          .from(schema.whatsappTemplates)
          .where(
            and(
              eq(schema.whatsappTemplates.instanceId, inst.id),
              eq(schema.whatsappTemplates.purpose, entry.purpose),
            ),
          )
          .limit(1)
      )[0];
      if (!local) continue;

      const found = remote.find((r) => r.name === entry.name && r.language === META_TEMPLATE_LANGUAGE);
      if (found) {
        const status = metaStatusToLocal(found.status);
        if (status !== local.status || found.id !== local.metaTemplateId) {
          await db
            .update(schema.whatsappTemplates)
            .set({
              status,
              metaTemplateId: found.id,
              category: found.category || local.category,
              rejectReason: found.rejectedReason,
              updatedAt: new Date(),
            })
            .where(eq(schema.whatsappTemplates.id, local.id));
          logger.info({ instance: inst.evolutionInstanceName, template: entry.name, status }, "meta: template atualizado");
        }
        continue;
      }

      // Não existe na conta: registra (a Meta responde PENDING e avalia em até 24h)
      try {
        const created = await client.createTemplate(toMetaSpec(entry, appUrl));
        await db
          .update(schema.whatsappTemplates)
          .set({
            status: metaStatusToLocal(created.status),
            metaTemplateId: created.id,
            category: created.category || local.category,
            rejectReason: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.whatsappTemplates.id, local.id));
        logger.info({ instance: inst.evolutionInstanceName, template: entry.name }, "meta: template registrado");
      } catch (err) {
        const message = err instanceof MetaApiError ? `${err.message}${err.details ? ` — ${err.details}` : ""}` : String(err);
        await db
          .update(schema.whatsappTemplates)
          .set({ status: "error", rejectReason: message.slice(0, 500), updatedAt: new Date() })
          .where(eq(schema.whatsappTemplates.id, local.id));
        logger.warn({ instance: inst.evolutionInstanceName, template: entry.name, err: message }, "meta: falha ao registrar template");
      }
    }
  }
}
