import { asc, desc, eq, sql } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { CampaignActions, NewCampaignButton } from "./campaign-client";

export const metadata = { title: "Campanhas" };

const STATUS_META: Record<string, { label: string; chip: string }> = {
  draft: { label: "Rascunho", chip: "bg-stone-100 text-stone-600" },
  running: { label: "Enviando", chip: "bg-teal-50 text-teal-700" },
  paused: { label: "Pausada", chip: "bg-amber-50 text-amber-700" },
  done: { label: "Concluída", chip: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelada", chip: "bg-stone-100 text-stone-500" },
};

export default async function CampanhasPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "automations.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Campanhas</h1>
        <div className="mt-6">
          <EmptyState title="As campanhas são configuradas pela administradora ou gestora." />
        </div>
      </div>
    );
  }

  const { campaigns, procedures } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const campaigns = await tx
        .select({
          id: schema.campaigns.id,
          name: schema.campaigns.name,
          status: schema.campaigns.status,
          dailyCap: schema.campaigns.dailyCap,
          recipientCount: schema.campaigns.recipientCount,
          messageTemplate: schema.campaigns.messageTemplate,
          createdAt: schema.campaigns.createdAt,
          sent: sql<number>`(SELECT count(*) FROM campaign_recipients r
                             WHERE r.campaign_id = campaigns.id AND r.status = 'sent')::int`,
          skipped: sql<number>`(SELECT count(*) FROM campaign_recipients r
                                WHERE r.campaign_id = campaigns.id AND r.status = 'skipped')::int`,
        })
        .from(schema.campaigns)
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(50);
      const procedures = await tx
        .select({ id: schema.procedures.id, name: schema.procedures.name })
        .from(schema.procedures)
        .where(eq(schema.procedures.active, true))
        .orderBy(asc(schema.procedures.name));
      return { campaigns, procedures };
    },
    auth.userId,
  );

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Campanhas</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Uma mensagem para um grupo de clientes — enviada aos poucos, no ritmo que
            protege o seu número.
          </p>
        </div>
        <NewCampaignButton procedures={procedures} />
      </div>

      <div className="mt-6 max-w-3xl space-y-4">
        {campaigns.length === 0 ? (
          <EmptyState title="Crie sua primeira campanha: escolha o público, escreva a mensagem e o sistema envia aos poucos, sozinho." />
        ) : (
          campaigns.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.draft!;
            const total = c.recipientCount ?? 0;
            const progress = total > 0 ? Math.round(((c.sent + c.skipped) / total) * 100) : 0;
            return (
              <section key={c.id} className="rounded-xl border border-stone-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-stone-800">{c.name}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 max-w-lg text-xs text-stone-500">
                      {c.messageTemplate}
                    </p>
                  </div>
                  <CampaignActions id={c.id} status={c.status} />
                </div>
                {c.status !== "draft" && total > 0 ? (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between text-xs text-stone-500">
                      <span>
                        {c.sent} de {total} enviadas
                        {c.skipped > 0 ? ` · ${c.skipped} puladas` : ""}
                      </span>
                      <span>até {c.dailyCap}/dia</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-stone-100">
                      <div
                        className="h-2 rounded-full bg-teal-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
