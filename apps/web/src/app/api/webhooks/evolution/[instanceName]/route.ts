import { eq, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import {
  extractWaMessageId,
  normalizeEvent,
  webhookEnvelopeSchema,
} from "@clinicaos/whatsapp";
import { adoptClinic, schema, withContext } from "@clinicaos/db";

/**
 * Receptor de webhooks da Evolution.
 * Regra estrutural: NUNCA processa nada pesado aqui — valida, grava o evento
 * bruto (dedupe por wa_message_id) e responde <100ms. O worker varre e processa.
 * Exceções síncronas (leves): status de conexão e QR — a UX de conexão depende deles.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> },
) {
  const { instanceName } = await params;
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token ausente" }, { status: 401 });

  let envelope;
  try {
    envelope = webhookEnvelopeSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }
  // Evolution envia eventos como "messages.upsert" ou "MESSAGES_UPSERT" conforme a versão
  const eventType = envelope.event.replace(/\./g, "_").toUpperCase();

  try {
    const handled = await withContext({ webhookToken: token }, async (tx) => {
      const instances = await tx
        .select({
          id: schema.whatsappInstances.id,
          clinicId: schema.whatsappInstances.clinicId,
          name: schema.whatsappInstances.evolutionInstanceName,
        })
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.evolutionInstanceName, instanceName))
        .limit(1);
      const instance = instances[0];
      if (!instance) return false;

      await adoptClinic(tx, instance.clinicId);

      const waMessageId = extractWaMessageId(eventType, envelope.data);
      await tx.execute(sql`
        INSERT INTO whatsapp_events (instance_id, clinic_id, event_type, wa_message_id, payload, processed)
        VALUES (${instance.id}, ${instance.clinicId}, ${eventType},
                ${waMessageId}, ${JSON.stringify(envelope.data ?? {})}::jsonb,
                ${eventType === "CONNECTION_UPDATE" || eventType === "QRCODE_UPDATED"})
        ON CONFLICT DO NOTHING
      `);

      // Estado de conexão e QR: atualização síncrona (leve) para a UX de conexão
      const normalized = normalizeEvent(eventType, envelope.data);
      if (normalized.kind === "connection") {
        const statusMap = {
          open: "connected",
          connecting: "connecting",
          close: "disconnected",
          logout: "disconnected",
          unknown: undefined,
        } as const;
        const status = statusMap[normalized.state];
        if (status) {
          await tx
            .update(schema.whatsappInstances)
            .set({
              status,
              phoneE164: normalized.phoneNumber ?? undefined,
              qrCode: status === "connected" ? null : undefined,
              lastSeenAt: status === "connected" ? new Date() : undefined,
              lastDisconnectAt: status === "disconnected" ? new Date() : undefined,
            })
            .where(eq(schema.whatsappInstances.id, instance.id));
        }
      } else if (normalized.kind === "qr" && normalized.base64) {
        await tx
          .update(schema.whatsappInstances)
          .set({ qrCode: normalized.base64, status: "qr_pending" })
          .where(eq(schema.whatsappInstances.id, instance.id));
      }

      return true;
    });

    if (!handled) return NextResponse.json({ error: "instância desconhecida" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("webhook evolution:", err);
    return NextResponse.json({ error: "erro interno" }, { status: 500 });
  }
}
