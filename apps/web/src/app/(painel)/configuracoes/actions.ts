"use server";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createLlmClient,
  parseClinicAiProvider,
  resolveAiConfig,
  type AiConfig,
} from "@clinicaos/ai/provider";
import { decryptSensitive, encryptSensitive } from "@clinicaos/core/crypto";
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

// ── Modelo de IA por clínica (provedor + chave própria) ─────────────

const aiProviderSchema = z.object({
  mode: z.enum(["default", "custom"]),
  provider: z.enum(["anthropic", "openai"]),
  /** Vazio = manter a chave já salva. */
  apiKey: z.string().trim().max(300),
  baseURL: z.string().trim().max(300),
  agentModel: z.string().trim().max(120),
  classifierModel: z.string().trim().max(120),
});

export interface AiProviderResult {
  ok: boolean;
  error?: string;
  sample?: string;
}

function normalizeBaseURL(v: string): string | null {
  const trimmed = v.replace(/\/$/, "");
  if (!trimmed) return null;
  if (!/^https?:\/\//.test(trimmed)) return null;
  return trimmed;
}

/** Monta a AiConfig a partir do formulário (chave nova ou a já salva). */
async function buildConfigFromForm(
  input: z.infer<typeof aiProviderSchema>,
  savedKeyEnc: string | null,
): Promise<{ config?: AiConfig; error?: string }> {
  const baseURL =
    input.baseURL === "" ? null : normalizeBaseURL(input.baseURL);
  if (input.baseURL && !baseURL) {
    return { error: "O endereço do servidor precisa começar com http:// ou https://" };
  }

  let apiKey = input.apiKey;
  if (!apiKey && savedKeyEnc && process.env.SENSITIVE_DATA_KEY) {
    try {
      apiKey = decryptSensitive(savedKeyEnc, process.env.SENSITIVE_DATA_KEY);
    } catch {
      apiKey = "";
    }
  }

  if (input.provider === "anthropic") {
    if (!apiKey) return { error: "Cole a chave da API da Anthropic (começa com sk-ant-)." };
    return {
      config: {
        provider: "anthropic",
        apiKey,
        baseURL: undefined,
        agentModel: input.agentModel || "claude-sonnet-5",
        classifierModel: input.classifierModel || "claude-haiku-4-5",
      },
    };
  }

  const effectiveBase = baseURL ?? "https://api.openai.com/v1";
  const isOfficial = effectiveBase.includes("api.openai.com");
  if (isOfficial && !apiKey) {
    return { error: "Cole a chave da API (começa com sk-)." };
  }
  if (!isOfficial && !input.agentModel) {
    return {
      error: "Informe o nome do modelo — em servidor próprio não dá para adivinhar (ex.: qwen3:32b).",
    };
  }
  return {
    config: {
      provider: "openai",
      apiKey: apiKey || "sem-chave",
      baseURL: effectiveBase,
      agentModel: input.agentModel || "gpt-4o",
      classifierModel:
        input.classifierModel || (isOfficial ? "gpt-4o-mini" : input.agentModel || "gpt-4o"),
    },
  };
}

/** Testa a conexão SEM salvar: uma chamada mínima ao provedor escolhido. */
export const testAiProvider = authAction({
  permission: "settings.manage",
  schema: aiProviderSchema,
  handler: async (input, { auth, tx }): Promise<AiProviderResult> => {
    if (input.mode === "default") {
      const config = resolveAiConfig(process.env);
      if (!config) {
        return { ok: false, error: "O servidor ainda não tem um provedor padrão configurado." };
      }
      return testConfig(config);
    }
    const clinic = (
      await tx
        .select({ settings: schema.clinics.settings })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, auth.clinicId!))
        .limit(1)
    )[0];
    const saved = parseClinicAiProvider(clinic?.settings);
    const built = await buildConfigFromForm(input, saved.apiKeyEnc);
    if (!built.config) return { ok: false, error: built.error };
    return testConfig(built.config);
  },
});

async function testConfig(config: AiConfig): Promise<AiProviderResult> {
  try {
    const response = await createLlmClient(config).chat({
      model: config.agentModel,
      maxTokens: 60,
      system: ["Você é um teste de conexão de uma clínica. Responda em uma frase curta em português."],
      messages: [{ role: "user", text: "Diga apenas: conexão funcionando!" }],
    });
    const sample = response.text || "(o modelo respondeu, mas sem texto)";
    return { ok: true, sample: sample.slice(0, 160) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = /401|403|invalid|authentication/i.test(msg)
      ? "Chave recusada — confira se copiou a chave inteira."
      : /404|model/i.test(msg)
        ? "O provedor não conhece esse modelo — confira o nome exato."
        : /fetch failed|ECONNREFUSED|ENOTFOUND|timeout/i.test(msg)
          ? "Não consegui alcançar o servidor — confira o endereço (ele precisa estar acessível pela VPS, não só pelo seu computador)."
          : `Falha no teste: ${msg.slice(0, 160)}`;
    return { ok: false, error: friendly };
  }
}

/** Salva o provedor da clínica (chave cifrada; vazia = mantém a salva). */
export const saveAiProvider = authAction({
  permission: "settings.manage",
  schema: aiProviderSchema,
  handler: async (input, { auth, tx }): Promise<AiProviderResult> => {
    const clinic = (
      await tx
        .select({ settings: schema.clinics.settings })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, auth.clinicId!))
        .limit(1)
    )[0];
    const saved = parseClinicAiProvider(clinic?.settings);

    if (input.mode === "custom") {
      // Valida ANTES de salvar — configuração quebrada não entra no banco
      const built = await buildConfigFromForm(input, saved.apiKeyEnc);
      if (!built.config) return { ok: false, error: built.error };
      if (input.apiKey && !process.env.SENSITIVE_DATA_KEY) {
        return {
          ok: false,
          error: "O servidor está sem SENSITIVE_DATA_KEY — não é seguro guardar chaves. Avise o suporte.",
        };
      }
    }

    const canEncrypt = Boolean(process.env.SENSITIVE_DATA_KEY);
    const apiKeyEnc =
      input.apiKey && canEncrypt
        ? encryptSensitive(input.apiKey, process.env.SENSITIVE_DATA_KEY!)
        : saved.apiKeyEnc;
    const keyHint = input.apiKey && canEncrypt ? input.apiKey.slice(-4) : saved.keyHint;

    await tx.execute(sql`
      UPDATE clinics SET settings = settings || jsonb_build_object('aiProvider', jsonb_build_object(
        'mode', ${input.mode}::text,
        'provider', ${input.provider}::text,
        'apiKeyEnc', ${apiKeyEnc}::text,
        'keyHint', ${keyHint}::text,
        'baseURL', ${input.baseURL ? normalizeBaseURL(input.baseURL) : null}::text,
        'agentModel', ${input.agentModel || null}::text,
        'classifierModel', ${input.classifierModel || null}::text
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
