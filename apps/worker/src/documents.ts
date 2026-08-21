import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { schema, unsafeGlobalDb } from "@clinicaos/db";

/**
 * Geração do PDF do termo assinado (Gotenberg) com página de evidências:
 * signatária, assinatura, data/hora, IP, user-agent e hash de integridade.
 * Depois envia a cópia por WhatsApp (link de download público do documento).
 */
export async function processPdfGeneration(logger: Logger): Promise<void> {
  const gotenbergUrl = process.env.GOTENBERG_URL;
  if (!gotenbergUrl) return; // sem Gotenberg configurado, o sweep é inerte

  const db = unsafeGlobalDb();

  // Termos com link vencido saem do limbo: viram "expirado" e a dona vê no painel
  await db.execute(sql`
    UPDATE documents SET status = 'expired', updated_at = now()
    WHERE status IN ('sent', 'viewed') AND token_expires_at < now()
  `);

  const pending = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.status, "signed"), isNull(schema.documents.pdfPath)))
    .orderBy(asc(schema.documents.signedAt))
    .limit(5);

  for (const doc of pending) {
    try {
      // Advisory lock: varreduras sobrepostas nunca geram o mesmo PDF em dobro
      const lock = await db.execute(
        sql`SELECT pg_try_advisory_lock(hashtext(${`pdf-${doc.id}`})) AS ok`,
      );
      if (!(lock.rows[0] as { ok: boolean }).ok) continue;
      try {
        await generatePdf(doc, gotenbergUrl, logger);
      } finally {
        await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${`pdf-${doc.id}`}))`);
      }
    } catch (err) {
      logger.error(
        { documentId: doc.id, err: err instanceof Error ? err.message : String(err) },
        "falha ao gerar PDF do termo",
      );
    }
  }
}

type DocumentRow = typeof schema.documents.$inferSelect;

async function generatePdf(
  doc: DocumentRow,
  gotenbergUrl: string,
  logger: Logger,
): Promise<void> {
  const db = unsafeGlobalDb();

  const signature = (
    await db
      .select()
      .from(schema.documentSignatures)
      .where(eq(schema.documentSignatures.documentId, doc.id))
      .limit(1)
  )[0];
  const clinic = (
    await db
      .select({ name: schema.clinics.name })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, doc.clinicId))
      .limit(1)
  )[0];
  if (!signature || !clinic) return;

  const signedAtBR = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(signature.signedAt));

  const signatureBlock =
    signature.signatureKind === "drawn" && signature.signatureImage
      ? `<img src="${signature.signatureImage}" style="height:80px" alt="Assinatura"/>`
      : `<p style="font-family:'Brush Script MT',cursive;font-size:28px;margin:4px 0">${escapeHtml(signature.signatureImage ?? signature.signerName)}</p>`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/><style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1c1917; margin: 48px; font-size: 13px; line-height: 1.65; }
  h1 { font-size: 17px; text-align: center; margin-bottom: 4px; }
  .clinic { text-align: center; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #0f766e; margin-bottom: 28px; }
  .evidence { page-break-before: always; border: 1px solid #d6d3d1; padding: 20px 24px; font-size: 11px; }
  .evidence h2 { font-size: 13px; margin-top: 0; }
  .evidence td { padding: 3px 8px 3px 0; vertical-align: top; }
  .evidence .k { color: #78716c; white-space: nowrap; }
  .hash { font-family: monospace; font-size: 9px; word-break: break-all; }
</style></head><body>
  <p class="clinic">${escapeHtml(clinic.name)}</p>
  <h1>${escapeHtml(doc.title)}</h1>
  ${doc.bodyHtmlRendered}
  <div class="evidence">
    <h2>Registro de Assinatura Eletrônica</h2>
    <table>
      <tr><td class="k">Signatária:</td><td>${escapeHtml(signature.signerName)}</td></tr>
      <tr><td class="k">Assinatura:</td><td>${signatureBlock}</td></tr>
      <tr><td class="k">Data e hora:</td><td>${signedAtBR} (horário de Brasília)</td></tr>
      <tr><td class="k">Endereço IP:</td><td>${escapeHtml(String(signature.ip))}</td></tr>
      <tr><td class="k">Dispositivo:</td><td>${escapeHtml(signature.userAgent.slice(0, 140))}</td></tr>
      <tr><td class="k">Integridade (SHA-256):</td><td class="hash">${doc.contentSha256}</td></tr>
    </table>
    <p style="margin-bottom:0;color:#78716c">Documento assinado eletronicamente nos termos da MP 2.200-2/2001, art. 10, §2º. O hash acima garante que o conteúdo assinado não foi alterado.</p>
  </div>
</body></html>`;

  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  const response = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Gotenberg ${response.status}: ${await response.text()}`);
  }
  const pdfBytes = Buffer.from(await response.arrayBuffer());
  const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");

  const storageDir = process.env.STORAGE_DIR ?? "./.data/storage";
  const relativePath = join(doc.clinicId, "documents", `${doc.id}.pdf`);
  const fullPath = join(storageDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, pdfBytes);

  await db
    .update(schema.documents)
    .set({ pdfPath: relativePath.replace(/\\/g, "/"), pdfSha256 })
    .where(eq(schema.documents.id, doc.id));
  await db.insert(schema.documentAuditLog).values({
    clinicId: doc.clinicId,
    documentId: doc.id,
    event: "pdf_generated",
    metadata: { pdfSha256 },
  });

  // Cópia para a cliente via WhatsApp (link público do próprio termo)
  const customer = (
    await db
      .select({ fullName: schema.customers.fullName, phoneE164: schema.customers.phoneE164 })
      .from(schema.customers)
      .where(eq(schema.customers.id, doc.customerId))
      .limit(1)
  )[0];
  const instance = (
    await db
      .select({ id: schema.whatsappInstances.id, status: schema.whatsappInstances.status })
      .from(schema.whatsappInstances)
      .where(eq(schema.whatsappInstances.clinicId, doc.clinicId))
      .limit(1)
  )[0];
  if (customer && instance?.status === "connected") {
    const remoteJid = `${customer.phoneE164.replace("+", "")}@s.whatsapp.net`;
    const conversation = (
      await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.instanceId, instance.id),
            eq(schema.conversations.remoteJid, remoteJid),
          ),
        )
        .limit(1)
    )[0];
    if (conversation) {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      await db.insert(schema.messages).values({
        clinicId: doc.clinicId,
        conversationId: conversation.id,
        direction: "outbound",
        author: "automation",
        body: `Tudo certo, ${customer.fullName.split(" ")[0]}! 💛 Sua cópia do termo assinado já está disponível aqui: ${appUrl}/assinar/${doc.signToken}`,
        status: "queued",
        automationId: "consent_term_copy",
        scheduledFor: new Date(Date.now() + 3_000 + Math.floor(Math.random() * 7_000)),
      });
    }
  }

  logger.info({ documentId: doc.id }, "PDF do termo gerado");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
