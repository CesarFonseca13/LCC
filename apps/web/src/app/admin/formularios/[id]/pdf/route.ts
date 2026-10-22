import { eq } from "drizzle-orm";
import { onboardingHtml, type OnbAnswers } from "@clinicaos/core/onboarding-form";
import { adminDb, schema } from "@clinicaos/db";
import { requireSuperadmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** PDF do formulário respondido, gerado na hora pelo Gotenberg (mesmo motor dos termos assinados). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireSuperadmin();
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response("não encontrado", { status: 404 });
  const row = (
    await adminDb().select().from(schema.onboardingForms).where(eq(schema.onboardingForms.id, id)).limit(1)
  )[0];
  if (!row) return new Response("não encontrado", { status: 404 });

  const gotenbergUrl = process.env.GOTENBERG_URL;
  if (!gotenbergUrl) return new Response("GOTENBERG_URL não configurada no servidor", { status: 500 });

  const html = onboardingHtml(row.answers as OnbAnswers, {
    id: row.id,
    receivedAt: row.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  // Usa o @page { size: A4; margin } do HTML em vez do Letter padrão do Gotenberg
  form.append("preferCssPageSize", "true");
  let res: Response;
  try {
    res = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
  } catch (err) {
    console.error("[admin/formularios/pdf] Gotenberg indisponível", { formId: id, err: String(err) });
    return new Response("Falha ao gerar o PDF: o motor de PDF (Gotenberg) não respondeu. Tente de novo em instantes.", { status: 502 });
  }
  if (!res.ok) {
    console.error("[admin/formularios/pdf] Gotenberg respondeu erro", { formId: id, status: res.status, body: await res.text().catch(() => "") });
    return new Response(`Falha ao gerar o PDF (${res.status})`, { status: 502 });
  }
  const bytes = await res.arrayBuffer();
  const slug = row.clinicName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "clinica";
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="implantacao-${slug}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
