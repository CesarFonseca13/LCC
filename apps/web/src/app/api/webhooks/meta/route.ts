import { createHmac, timingSafeEqual } from "node:crypto";
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
  messages?: { id?: string; from?: string }[];
  statuses?: { id?: string; status?: string }[];
}

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
        if (change.field !== "messages" || !change.value) continue;
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
          for (const message of value.messages ?? []) {
            if (!message.id) continue;
            const contact = contacts.find((c) => c.wa_id === message.from) ?? contacts[0] ?? null;
            await tx.execute(sql`
              INSERT INTO whatsapp_events (instance_id, clinic_id, event_type, wa_message_id, payload, processed)
              VALUES (${instance.id}, ${instance.clinicId}, 'META_MESSAGE', ${message.id},
                      ${JSON.stringify({ message, contact, metadata: value.metadata ?? null })}::jsonb, false)
              ON CONFLICT DO NOTHING
            `);
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
