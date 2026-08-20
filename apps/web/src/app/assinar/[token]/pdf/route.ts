import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema, withContext } from "@clinicaos/db";

/** Download público do PDF assinado — autenticado pelo próprio sign_token. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const doc = await withContext({ signToken: token }, async (tx) =>
    (
      await tx
        .select({
          pdfPath: schema.documents.pdfPath,
          status: schema.documents.status,
          title: schema.documents.title,
        })
        .from(schema.documents)
        .where(eq(schema.documents.signToken, token))
        .limit(1)
    )[0],
  );
  if (!doc || doc.status !== "signed" || !doc.pdfPath) {
    return NextResponse.json({ error: "PDF indisponível" }, { status: 404 });
  }

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
