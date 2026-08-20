import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { ApprovalCard, ApproveAllButton } from "./approval-card";

export const metadata = { title: "Aprovações" };

const AUTOMATION_LABEL: Record<string, string> = {
  reminder_24h: "Lembrete 24h antes",
  confirm_2h: "Confirmação 2h antes",
};

export default async function AprovacoesPage() {
  const auth = await requireAuth();
  if (!auth.clinicId) return null;

  const pending = await withTenant(
    auth.clinicId,
    (tx) =>
      tx
        .select({
          id: schema.approvals.id,
          automationId: schema.approvals.automationId,
          generatedBody: schema.approvals.generatedBody,
          contextLine: schema.approvals.contextLine,
          expiresAt: schema.approvals.expiresAt,
          createdAt: schema.approvals.createdAt,
          customerName: schema.customers.fullName,
          customerId: schema.customers.id,
        })
        .from(schema.approvals)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.approvals.customerId))
        .where(eq(schema.approvals.status, "pending"))
        .orderBy(desc(schema.approvals.createdAt)),
    auth.userId,
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Aprovações</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Mensagens preparadas pelas automações aguardando sua revisão antes do envio.
          </p>
        </div>
        {pending.length > 1 ? <ApproveAllButton count={pending.length} /> : null}
      </div>

      <div className="mt-6 max-w-3xl space-y-4">
        {pending.length === 0 ? (
          <EmptyState title="Tudo em dia! Quando uma automação preparar uma mensagem que exige a sua revisão, ela aparece aqui." />
        ) : (
          pending.map((item) => (
            <ApprovalCard
              key={item.id}
              approval={{
                id: item.id,
                customerName: item.customerName,
                customerId: item.customerId,
                automationLabel:
                  AUTOMATION_LABEL[item.automationId ?? ""] ?? "Automação",
                body: item.generatedBody,
                contextLine: item.contextLine,
                expiresAtISO: item.expiresAt ? new Date(item.expiresAt).toISOString() : null,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
