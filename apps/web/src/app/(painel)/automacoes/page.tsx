import { asc, eq } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { AutomationCard } from "./automation-card";

export const metadata = { title: "Automações" };

const PHASE_LABEL: Record<string, { title: string; subtitle: string }> = {
  confirmation: {
    title: "Confirmação de Agenda",
    subtitle: "Confirmam e lembram a cliente da consulta — menos faltas, sem telefonema.",
  },
  auto_reply: {
    title: "Respostas Automáticas",
    subtitle: "O que a cliente recebe na hora quando ela mesma responde pelo WhatsApp.",
  },
  no_show_recovery: {
    title: "Recuperação de Faltas",
    subtitle: "A cliente faltou? O sistema corre atrás do reagendamento sozinho.",
  },
  post_visit: {
    title: "Pós-Atendimento",
    subtitle: "Cuidados de casa, coleta de feedback, retoque e acompanhamento pós-venda.",
  },
  reactivation: {
    title: "Reativação e Datas Especiais",
    subtitle: "Aniversários e reencontros com quem sumiu.",
  },
  growth: {
    title: "Crescimento e Receita",
    subtitle: "Preenchimento inteligente da agenda e renovação de pacotes.",
  },
};

export default async function AutomacoesPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "automations.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Automações</h1>
        <div className="mt-6">
          <EmptyState title="Somente a administradora ou gestora configura as automações." />
        </div>
      </div>
    );
  }

  const { definitions, settings, connected } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const definitions = await tx
        .select()
        .from(schema.automationDefinitions)
        .orderBy(asc(schema.automationDefinitions.sort));
      const settings = await tx.select().from(schema.automationSettings);
      const instance = (
        await tx
          .select({ status: schema.whatsappInstances.status })
          .from(schema.whatsappInstances)
          .where(eq(schema.whatsappInstances.clinicId, auth.clinicId!))
          .limit(1)
      )[0];
      return { definitions, settings, connected: instance?.status === "connected" };
    },
    auth.userId,
  );

  const byPhase = new Map<string, typeof definitions>();
  for (const def of definitions) {
    byPhase.set(def.phase, [...(byPhase.get(def.phase) ?? []), def]);
  }

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-stone-800">Automações</h1>
      <p className="mt-0.5 text-sm text-stone-500">
        Mensagens que o sistema envia sozinho. Comece revisando cada envio — quando
        confiar, deixe automático.
      </p>

      {!connected ? (
        <div className="mt-4 max-w-3xl rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ O WhatsApp ainda não está conectado — as automações ficam em espera até a
          conexão. <a href="/configuracoes" className="font-medium underline">Conectar agora</a>
        </div>
      ) : null}

      <div className="mt-6 max-w-3xl space-y-8">
        {[...byPhase.entries()].map(([phase, defs]) => {
          const meta = PHASE_LABEL[phase] ?? { title: phase, subtitle: "" };
          return (
            <section key={phase}>
              <h2 className="text-sm font-semibold text-stone-700">{meta.title}</h2>
              <p className="text-xs text-stone-500">{meta.subtitle}</p>
              <div className="mt-3 space-y-3">
                {defs.map((def) => {
                  const setting = settings.find((s) => s.automationId === def.id);
                  return (
                    <AutomationCard
                      key={def.id}
                      definition={{
                        id: def.id,
                        name: def.name,
                        description: def.description,
                        defaultTemplate: def.defaultTemplate,
                      }}
                      setting={{
                        enabled: setting?.enabled ?? false,
                        requiresApproval: setting?.requiresApproval ?? true,
                        messageTemplate: setting?.messageTemplate ?? null,
                      }}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
