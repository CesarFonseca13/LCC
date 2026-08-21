"use server";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { evolutionFromEnv } from "@clinicaos/whatsapp";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface WhatsAppState {
  ok: boolean;
  error?: string;
  status?: string;
  qrCode?: string | null;
  phone?: string | null;
}

const emptySchema = z.object({});

/** Cria (ou retoma) a instância e pede o QR. */
export const setupWhatsApp = authAction({
  permission: "settings.manage",
  schema: emptySchema,
  handler: async (_input, { auth, tx }): Promise<WhatsAppState> => {
    const evolution = evolutionFromEnv();
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";

    const existing = (
      await tx
        .select()
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.clinicId, auth.clinicId))
        .limit(1)
    )[0];

    let name = existing?.evolutionInstanceName;
    let token = existing?.webhookToken;

    if (!existing) {
      name = `cl-${auth.clinicId.slice(0, 8)}-01`;
      token = randomBytes(24).toString("base64url");
      await tx.insert(schema.whatsappInstances).values({
        clinicId: auth.clinicId,
        evolutionInstanceName: name,
        webhookToken: token,
        status: "created",
      });
      const webhookUrl = `${appUrl}/api/webhooks/evolution/${name}?token=${token}`;
      try {
        await evolution.createInstance({ instanceName: name, webhookUrl });
      } catch (err) {
        // Instância pode já existir na Evolution (retomada) — segue para o connect
        console.warn("createInstance:", err);
      }
    }

    // Linha órfã (registrada aqui mas não na Evolution) não pode travar para
    // sempre: se o connect falhar, recria a instância na Evolution e tenta de novo
    const webhookUrl = `${appUrl}/api/webhooks/evolution/${name}?token=${token}`;
    const tryConnect = async () => {
      const qr = await evolution.connect(name!);
      await tx
        .update(schema.whatsappInstances)
        .set({ qrCode: qr.base64 ?? null, status: "qr_pending" })
        .where(eq(schema.whatsappInstances.evolutionInstanceName, name!));
      revalidatePath("/configuracoes");
      return { ok: true, status: "qr_pending", qrCode: qr.base64 ?? null } as WhatsAppState;
    };
    try {
      return await tryConnect();
    } catch {
      try {
        await evolution.createInstance({ instanceName: name!, webhookUrl });
        return await tryConnect();
      } catch {
        return {
          ok: false,
          error:
            "Não foi possível falar com o serviço de WhatsApp. Confira se a Evolution API está no ar.",
        };
      }
    }
  },
});

/** Polling da tela de conexão: devolve status atual; renova QR se preciso. */
export const pollWhatsApp = authAction({
  permission: "settings.manage",
  schema: emptySchema,
  handler: async (_input, { auth, tx }): Promise<WhatsAppState> => {
    const instance = (
      await tx
        .select()
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.clinicId, auth.clinicId))
        .limit(1)
    )[0];
    if (!instance) return { ok: true, status: "none" };

    // Enquanto aguarda leitura do QR, confere o estado direto na Evolution
    // (webhook pode falhar silenciosamente) e renova o QR expirado.
    if (["created", "qr_pending", "connecting"].includes(instance.status)) {
      try {
        const evolution = evolutionFromEnv();
        const state = await evolution.connectionState(instance.evolutionInstanceName);
        if (state.instance?.state === "open") {
          await tx
            .update(schema.whatsappInstances)
            .set({ status: "connected", qrCode: null, lastSeenAt: new Date() })
            .where(eq(schema.whatsappInstances.id, instance.id));
          revalidatePath("/configuracoes");
          return { ok: true, status: "connected", phone: instance.phoneE164 };
        }
        if (!instance.qrCode) {
          const qr = await evolution.connect(instance.evolutionInstanceName);
          if (qr.base64) {
            await tx
              .update(schema.whatsappInstances)
              .set({ qrCode: qr.base64, status: "qr_pending" })
              .where(eq(schema.whatsappInstances.id, instance.id));
            return { ok: true, status: "qr_pending", qrCode: qr.base64 };
          }
        }
      } catch {
        // Evolution fora do ar: devolve o que o banco sabe
      }
    }

    return {
      ok: true,
      status: instance.status,
      qrCode: instance.qrCode,
      phone: instance.phoneE164,
    };
  },
});

// ── Agendamento online ───────────────────────────────────────────────

const bookingSchema = z.object({
  enabled: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,40}$/, "Use só letras minúsculas, números e hífen (3–40)"),
});

export const saveBookingSettings = authAction({
  permission: "settings.manage",
  schema: bookingSchema,
  handler: async (input, { auth, tx }): Promise<WhatsAppState> => {
    try {
      await tx
        .update(schema.clinics)
        .set({ onlineBookingEnabled: input.enabled, bookingSlug: input.slug })
        .where(eq(schema.clinics.id, auth.clinicId));
    } catch (err) {
      if (String(err).includes("clinics_booking_slug")) {
        return { ok: false, error: "Esse endereço já está em uso — escolha outro." };
      }
      throw err;
    }
    revalidatePath("/configuracoes");
    return { ok: true };
  },
});

// ── Assistente virtual (persona da IA) ───────────────────────────────

const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  assistantName: z.string().trim().min(2, "Dê um nome à assistente").max(30),
  tone: z.enum(["acolhedora", "elegante", "animada"]),
});

export const saveAiSettings = authAction({
  permission: "settings.manage",
  schema: aiSettingsSchema,
  handler: async (input, { auth, tx }): Promise<WhatsAppState> => {
    await tx.execute(sql`
      UPDATE clinics SET settings = settings || jsonb_build_object('ai', jsonb_build_object(
        'enabled', ${input.enabled}::boolean,
        'assistantName', ${input.assistantName}::text,
        'tone', ${input.tone}::text
      ))
      WHERE id = ${auth.clinicId}
    `);
    revalidatePath("/configuracoes");
    return { ok: true };
  },
});

export const disconnectWhatsApp = authAction({
  permission: "settings.manage",
  schema: emptySchema,
  handler: async (_input, { auth, tx }): Promise<WhatsAppState> => {
    const instance = (
      await tx
        .select()
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.clinicId, auth.clinicId))
        .limit(1)
    )[0];
    if (!instance) return { ok: true, status: "none" };

    try {
      await evolutionFromEnv().logout(instance.evolutionInstanceName);
    } catch {
      // Evolution pode já estar deslogada — estado local manda
    }
    await tx
      .update(schema.whatsappInstances)
      .set({ status: "disconnected", qrCode: null, lastDisconnectAt: new Date() })
      .where(eq(schema.whatsappInstances.id, instance.id));
    revalidatePath("/configuracoes");
    return { ok: true, status: "disconnected" };
  },
});
