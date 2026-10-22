import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { decryptSensitive } from "@clinicaos/core/crypto";
import { adoptClinic, schema, withContext } from "@clinicaos/db";

/**
 * Webhook da WhatsApp Business Platform (API oficial da Meta).
 * Um endpoint para o app inteiro: cada evento traz o phone_number_id, que
 * resolve o número da clínica (política RLS meta_webhook_resolve). Mesma
 * regra estrutural do webhook da Evolution: valida, grava o evento bruto
 * (dedupe por id + tipo) e responde rápido — o worker processa.
 */

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "verificação inválida" }, { status: 403 });
}

function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

interface MetaChangeValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: { id?: string; from?: string; to?: string }[];
  statuses?: { id?: string; status?: string }[];
  /** Coexistência: mensagens enviadas pela clínica no app do celular. */
  message_echoes?: { id?: string; to?: string }[];
  /** Coexistência: agenda de contatos do app (importação inicial e mudanças depois). */
  state_sync?: unknown[];
  /** Coexistência: lotes do histórico de conversas (até 6 meses), em fases. */
  history?: { metadata?: { phase?: number; chunk_order?: number } }[];
  /** Erro da sincronização (ex.: 2593109 = clínica não compartilhou o histórico). */
  errors?: unknown;
}

/** Campos que gravamos como evento para o worker; account_update só precisa do 200. */
const HANDLED_FIELDS = new Set(["messages", "smb_message_echoes", "smb_app_state_sync", "history"]);

const digest = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 20);

export async function POST(request: NextRequest) {
  const raw = await request.text();
  let body: { object?: string; entry?: { changes?: { field?: string; value?: MetaChangeValue }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }
  if (body?.object !== "whatsapp_business_account") return NextResponse.json({ ok: true });

  const signature = request.headers.get("x-hub-signature-256");
  const centralSecret = process.env.META_APP_SECRET ?? "";
  let rejected = false;

  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (!change.field || !HANDLED_FIELDS.has(change.field) || !change.value) continue;
        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        await withContext({ metaPhoneNumberId: String(phoneNumberId) }, async (tx) => {
          const instance = (
            await tx
              .select({
                id: schema.whatsappInstances.id,
                clinicId: schema.whatsappInstances.clinicId,
                appSecretEnc: schema.whatsappInstances.metaAppSecretEnc,
              })
              .from(schema.whatsappInstances)
              .where(eq(schema.whatsappInstances.metaPhoneNumberId, String(phoneNumberId)))
              .limit(1)
          )[0];
          if (!instance) return;

          // Assinatura: App Secret do app da clínica (cifrado) ou o do app central
          let secret = centralSecret;
          if (instance.appSecretEnc && process.env.SENSITIVE_DATA_KEY) {
            try {
              secret = decryptSensitive(instance.appSecretEnc, process.env.SENSITIVE_DATA_KEY);
            } catch {
              // segredo ilegível: cai no central
            }
          }
          if (!secret || !validSignature(raw, signature, secret)) {
            rejected = true;
            return;
          }

          await adoptClinic(tx, instance.clinicId);
          const contacts = value.contacts ?? [];
          // Só o campo "messages" traz mensagem ao vivo — o campo "history" também
          // usa value.messages (complemento de mídia), e esse NÃO pode virar mensagem nova
          const liveMessages = change.field === "messages" ? (value.messages ?? []) : [];
          for (const message of liveMessages) {
            if (!message.id) continue;
            const contact = contacts.find((c) => c.wa_id === message.from) ?? contacts[0] ?? null;
            await tx.execute(sql`
              INSERT INTO whatsapp_events (instance_id, clinic_id, event_type, wa_message_id, payload, processed)
              VALUES (${instance.id}, ${instance.clinicId}, 'META_MESSAGE', ${message.id},
                      ${JSON.stringify({ message, contact, metadata: value.metadata ?? null })}::jsonb, false)
              ON CONFLICT DO NOTHING
            `);
          }
          const echoes = change.field === "smb_message_echoes" ? (value.message_echoes ?? []) : [];
          for (const echo of echoes) {
            if (!echo.id) continue;
            await tx.execute(sql`
              INSERT INTO whatsapp_events (instance_id, clinic_id, event_type, wa_message_id, payload, processed)
              VALUES (${instance.id}, ${instance.clinicId}, 'META_ECHO', ${echo.id},
                      ${JSON.stringify({ echo, metadata: value.metadata ?? null })}::jsonb, false)
              ON CONFLICT DO NOTHING
            `);
          }
          // Importação da coexistência: cada lote vira UM evento (dedupe pelo
          // conteúdo — a Meta reenvia o webhook se demoramos a responder)
          if (change.field === "smb_app_state_sync" && Array.isArray(value.state_sync) && value.state_sync.length > 0) {
            await tx.execute(sql`
              INSERT INTO whatsapp_events (instance_id, clinic_id, event_type, wa_message_id, payload, processed)
              VALUES (${instance.id}, ${instance.clinicId}, 'META_CONTACTS', ${`contacts:${digest(value.state_sync)}`},
                      ${JSON.stringify({ state_sync: value.state_sync, metadata: value.metadata ?? null })}::jsonb, false)
              ON CONFLICT DO NOTHING
            `);
          }
          if (change.field === "history") {
            const items: unknown[] = Array.isArray(value.history) ? [...value.history] : [];
            if (items.length === 0 && value.errors) items.push({ errors: value.errors });
            // Complemento de mídia (media_placeholder): a Meta manda o conteúdo em
            // value.messages, sem value.history — vira um lote de uma mensagem só
            for (const m of value.messages ?? []) {
              if (!m.id) continue;
              const threadId = m.to ?? m.from; // "to" só existe quando foi a clínica que enviou
              if (!threadId) continue;
              items.push({ threads: [{ id: threadId, messages: [m] }], mediaFollowUp: true });
            }
            for (const item of items) {
              const meta = (item as { metadata?: { phase?: number; chunk_order?: number } }).metadata;
              const key = `history:${meta?.phase ?? "x"}:${meta?.chunk_order ?? "x"}:${digest(item)}`;
              await tx.execute(sql`
                INSERT INTO whatsapp_events (instance_id, clinic_id, event_type, wa_message_id, payload, processed)
                VALUES (${instance.id}, ${instance.clinicId}, 'META_HISTORY', ${key},
                        ${JSON.stringify({ item, metadata: value.metadata ?? null })}::jsonb, false)
                ON CONFLICT DO NOTHING
              `);
            }
          }
          for (const status of value.statuses ?? []) {
            const st = String(status.status ?? "").toUpperCase();
            if (!status.id || !["DELIVERED", "READ", "FAILED"].includes(st)) continue;
            await tx.execute(sql`
              INSERT INTO whatsapp_events (instance_id, clinic_id, event_type, wa_message_id, payload, processed)
              VALUES (${instance.id}, ${instance.clinicId}, ${`META_STATUS_${st}`}, ${status.id},
                      ${JSON.stringify({ status })}::jsonb, false)
              ON CONFLICT DO NOTHING
            `);
          }
          await tx
            .update(schema.whatsappInstances)
            .set({ lastSeenAt: new Date() })
            .where(eq(schema.whatsappInstances.id, instance.id));
        });
      }
    }
  } catch (err) {
    console.error("webhook meta:", err);
    return NextResponse.json({ error: "erro interno" }, { status: 500 });
  }

  if (rejected) return NextResponse.json({ error: "assinatura inválida" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
