import { and, eq } from "drizzle-orm";
import { adoptClinic, schema, withContext } from "@clinicaos/db";
import { isLinkPreviewBot } from "@/lib/preview-bot";
import { SignPad } from "./sign-pad";

export const metadata = { title: "Assinatura de termo" };

export default async function AssinarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const previewBot = await isLinkPreviewBot();

  const data = await withContext({ signToken: token }, async (tx) => {
    const doc = (
      await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.signToken, token))
        .limit(1)
    )[0];
    if (!doc) return null;

    await adoptClinic(tx, doc.clinicId);
    const clinic = (
      await tx
        .select({ name: schema.clinics.name })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, doc.clinicId))
        .limit(1)
    )[0];

    const expired =
      doc.status !== "signed" && new Date(doc.tokenExpiresAt) < new Date();

    // Trilha: registro de abertura + primeiro "visualizado" — a prévia de link
    // do WhatsApp faz um GET no envio e não conta como abertura de verdade
    if (!expired && !previewBot && ["sent", "viewed"].includes(doc.status)) {
      await tx.insert(schema.documentAuditLog).values({
        clinicId: doc.clinicId,
        documentId: doc.id,
        event: "link_opened",
      });
      if (doc.status === "sent") {
        await tx
          .update(schema.documents)
          .set({ status: "viewed", viewedAt: new Date() })
          .where(and(eq(schema.documents.id, doc.id), eq(schema.documents.status, "sent")));
      }
    }

    return {
      title: doc.title,
      bodyHtml: doc.bodyHtmlRendered,
      status: expired ? "expired" : doc.status,
      hasPdf: Boolean(doc.pdfPath),
      clinicName: clinic?.name ?? "Clínica",
    };
  });

  if (!data) {
    return (
      <Shell clinicName="">
        <p className="text-center text-stone-600">
          Link inválido. Peça para a clínica enviar o termo novamente.
        </p>
      </Shell>
    );
  }

  if (data.status === "expired") {
    return (
      <Shell clinicName={data.clinicName}>
        <p className="text-center text-stone-600">
          Este link expirou. Peça para a clínica reenviar o termo. 💛
        </p>
      </Shell>
    );
  }

  if (data.status === "signed") {
    return (
      <Shell clinicName={data.clinicName}>
        <div className="space-y-4 text-center">
          <p className="text-4xl">✅</p>
          <h1 className="text-lg font-semibold text-stone-800">Termo assinado!</h1>
          <p className="text-sm text-stone-600">
            Tudo certo — a {data.clinicName} já recebeu sua assinatura.
          </p>
          {data.hasPdf ? (
            <a
              href={`/assinar/${token}/pdf`}
              className="inline-block rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800"
            >
              Baixar meu termo (PDF)
            </a>
          ) : (
            <p className="text-xs text-stone-400">
              Sua cópia em PDF está sendo preparada — volte aqui em instantes.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell clinicName={data.clinicName}>
      <h1 className="text-center text-base font-semibold text-stone-800">{data.title}</h1>
      <SignPad token={token} bodyHtml={data.bodyHtml} />
    </Shell>
  );
}

function Shell({
  clinicName,
  children,
}: {
  clinicName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-stone-100 px-4 py-8">
      <div className="mx-auto max-w-xl">
        {clinicName ? (
          <p className="mb-4 text-center text-sm font-semibold uppercase tracking-wide text-teal-800">
            {clinicName}
          </p>
        ) : null}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {children}
        </div>
        <p className="mt-4 text-center text-[11px] text-stone-400">
          Assinatura eletrônica com registro de data, hora e integridade do documento.
        </p>
      </div>
    </main>
  );
}

