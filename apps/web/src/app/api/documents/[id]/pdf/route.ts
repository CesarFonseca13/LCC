import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@clinicaos/db";
import { getAuth } from "@/lib/session";

/** Download do PDF assinado pelo painel (autenticado + escopo da clínica). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuth();
  if (!auth?.clinicId) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const { id } = await params;

  const doc = await withTenant(
    auth.clinicId,
    async (tx) =>
      (
        await tx
          .select({ pdfPath: schema.documents.pdfPath, title: schema.documents.title })
          .from(schema.documents)
          .where(eq(schema.documents.id, id))
          .limit(1)
      )[0],
    auth.userId,
  );
  if (!doc?.pdfPath) return NextResponse.json({ error: "PDF indisponível" }, { status: 404 });

  const storageDir = process.env.STORAGE_DIR ?? "./.data/storage";
  try {
    const bytes = await readFile(join(storageDir, doc.pdfPath));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${doc.title.replace(/[^\p{L}\p{N} .-]/gu, "")}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "PDF indisponível" }, { status: 404 });
  }
}
