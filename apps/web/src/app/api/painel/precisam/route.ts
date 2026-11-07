import { NextResponse } from "next/server";
import { can } from "@clinicaos/core/permissions";
import { withTenant } from "@clinicaos/db";
import { countNeedsHuman } from "@/lib/needs-human";
import { getAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

const EMPTY = { count: 0, urgent: 0, latest: null, latestUrgent: null };

/** Contador "precisa de você" do menu — consultado a cada 30 s pelo painel aberto.
 *  Devolve a clínica da sessão: aba aberta em outra clínica (superadmin) ignora. */
export async function GET() {
  const auth = await getAuth();
  if (!auth?.clinicId || !auth.role) {
    return NextResponse.json({ ...EMPTY, clinicId: null }, { status: 401 });
  }
  if (!can(auth.role, "inbox.access")) {
    return NextResponse.json({ ...EMPTY, clinicId: auth.clinicId });
  }
  const clinicId = auth.clinicId;
  const counts = await withTenant(clinicId, (tx) => countNeedsHuman(tx), auth.userId);
  return NextResponse.json({ ...counts, clinicId }, { headers: { "cache-control": "private, no-store" } });
}
