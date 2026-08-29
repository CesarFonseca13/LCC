import { desc, eq } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { KnowledgeFacts, KnowledgeCards, type KbEntryView, type FactsView } from "./knowledge-client";

export const metadata = { title: "Conhecimento" };

function parseFacts(settings: unknown): FactsView {
  const k = ((settings ?? {}) as Record<string, unknown>).knowledge as
    | Record<string, unknown>
    | undefined;
  const s = (key: string) => {
    const v = k?.[key];
    return typeof v === "string" ? v : "";
  };
  return {
    comoChegar: s("comoChegar"),
    estacionamento: s("estacionamento"),
    pagamento: s("pagamento"),
    convenios: s("convenios"),
    cancelamento: s("cancelamento"),
    observacoes: s("observacoes"),
  };
}

export default async function ConhecimentoPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "settings.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Conhecimento</h1>
        <div className="mt-6">
          <EmptyState title="A base de conhecimento é gerenciada pela administradora ou gestora." />
        </div>
      </div>
    );
  }

  const { facts, entries } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const clinic = (
        await tx
          .select({ settings: schema.clinics.settings })
          .from(schema.clinics)
          .where(eq(schema.clinics.id, auth.clinicId!))
          .limit(1)
      )[0];
      const rows = await tx
        .select({
          id: schema.kbEntries.id,
          kind: schema.kbEntries.kind,
          title: schema.kbEntries.title,
          content: schema.kbEntries.content,
          active: schema.kbEntries.active,
        })
        .from(schema.kbEntries)
        .orderBy(desc(schema.kbEntries.createdAt))
        .limit(200);
      return { facts: parseFacts(clinic?.settings), entries: rows as KbEntryView[] };
    },
    auth.userId,
  );

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-stone-800">Base de Conhecimento</h1>
      <p className="mt-0.5 max-w-2xl text-sm text-stone-500">
        Tudo que a assistente pode afirmar sobre a clínica sai daqui, do catálogo de
        Serviços e das Configurações. O que não estiver escrito, ela não inventa — ela
        avisa que vai confirmar com a equipe.
      </p>

      <div className="mt-6 max-w-3xl space-y-6">
        <KnowledgeFacts initial={facts} />
        <KnowledgeCards initial={entries} />
      </div>
    </div>
  );
}
