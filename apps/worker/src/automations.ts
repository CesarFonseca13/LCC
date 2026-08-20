import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Logger } from "pino";
import { renderTemplate } from "@clinicaos/core/template-render";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { utcToZoned } from "@clinicaos/core/timezone";
import { schema, unsafeGlobalDb } from "@clinicaos/db";

/**
 * Tick das automações: varre automation_runs.next_run_at <= now() (a fila real
 * é o Postgres) e materializa a mensagem — direto na fila de envio ou na fila
 * de Aprovações, conforme a configuração da clínica.
 *
 * Regra de ouro: a run vencida é uma INTENÇÃO — a elegibilidade é revalidada
 * aqui, no momento da execução. Run inválida morre em silêncio (com log).
 */
export async function processAutomationTick(logger: Logger): Promise<number> {
  const db = unsafeGlobalDb();
  const due = await db
    .select({ id: schema.automationRuns.id })
    .from(schema.automationRuns)
    .where(
      and(
        eq(schema.automationRuns.status, "active"),
        lte(schema.automationRuns.nextRunAt, new Date()),
      ),
    )
    .orderBy(asc(schema.automationRuns.nextRunAt))
    .limit(25);

  for (const { id } of due) {
    // Claim otimista: só um worker processa a run
    const claimed = await db
      .update(schema.automationRuns)
      .set({ status: "processing" })
      .where(and(eq(schema.automationRuns.id, id), eq(schema.automationRuns.status, "active")))
      .returning();
    const run = claimed[0];
    if (!run) continue;

    try {
      await executeConfirmationRun(run, logger);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ runId: run.id, err: message }, "falha na automação");
      await finishRun(run.id, "error", message);
      await log(run, "error", message);
    }
  }
  return due.length;
}

type Run = typeof schema.automationRuns.$inferSelect;

async function finishRun(
  runId: string,
  status: "completed" | "goal_reached" | "cancelled" | "skipped" | "error",
  stopReason?: string,
): Promise<void> {
  const db = unsafeGlobalDb();
  await db
    .update(schema.automationRuns)
    .set({ status, stopReason: stopReason ?? null, finishedAt: new Date(), nextRunAt: null })
    .where(eq(schema.automationRuns.id, runId));
}

async function log(
  run: Run,
  result: (typeof schema.automationLog.$inferInsert)["result"],
  detail?: string,
  messageId?: string,
): Promise<void> {
  const db = unsafeGlobalDb();
  await db.insert(schema.automationLog).values({
    clinicId: run.clinicId,
    automationId: run.automationId,
    runId: run.id,
    customerId: run.customerId,
    appointmentId: run.appointmentId,
    result,
    detail: detail ?? null,
    messageId: messageId ?? null,
  });
}

/** Executa lembrete 24h / confirmação 2h de um agendamento. */
async function executeConfirmationRun(run: Run, logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();

  if (!run.appointmentId) {
    await finishRun(run.id, "skipped", "sem agendamento");
    return;
  }

  // ── Revalidação de elegibilidade ─────────────────────────────────
  const appt = (
    await db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, run.appointmentId))
      .limit(1)
  )[0];
  if (!appt || !["scheduled", "confirmed"].includes(appt.status)) {
    await finishRun(run.id, "cancelled", `agendamento ${appt?.status ?? "inexistente"}`);
    await log(run, "cancelled", `agendamento ${appt?.status ?? "inexistente"}`);
    return;
  }
  // Confirmação já obtida → objetivo atingido, não cobra de novo
  if (appt.status === "confirmed") {
    await finishRun(run.id, "goal_reached", "cliente já confirmou");
    await log(run, "goal_reached");
    return;
  }
  // Lembrete depois do horário não faz sentido
  if (new Date(appt.startsAt) <= new Date()) {
    await finishRun(run.id, "skipped", "horário já passou");
    await log(run, "expired", "horário já passou");
    return;
  }

  const customer = (
    await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, run.customerId))
      .limit(1)
  )[0];
  if (!customer || customer.deletedAt || customer.automationsBlocked || customer.optedOutAt) {
    await finishRun(run.id, "skipped", "cliente bloqueada/opt-out");
    await log(run, "skipped", "cliente bloqueada/opt-out");
    return;
  }

  const settings = (
    await db
      .select()
      .from(schema.automationSettings)
      .where(
        and(
          eq(schema.automationSettings.clinicId, run.clinicId),
          eq(schema.automationSettings.automationId, run.automationId),
        ),
      )
      .limit(1)
  )[0];
  if (!settings?.enabled) {
    await finishRun(run.id, "cancelled", "automação desligada");
    await log(run, "cancelled", "automação desligada");
    return;
  }

  const instance = (
    await db
      .select()
      .from(schema.whatsappInstances)
      .where(eq(schema.whatsappInstances.clinicId, run.clinicId))
      .limit(1)
  )[0];
  if (!instance || instance.status !== "connected") {
    // WhatsApp fora: adia 5 minutos sem perder o estado
    await db
      .update(schema.automationRuns)
      .set({ status: "active", nextRunAt: new Date(Date.now() + 5 * 60_000) })
      .where(eq(schema.automationRuns.id, run.id));
    logger.warn({ runId: run.id }, "instância desconectada — automação adiada 5min");
    return;
  }

  // ── Render do template ───────────────────────────────────────────
  const definition = (
    await db
      .select()
      .from(schema.automationDefinitions)
      .where(eq(schema.automationDefinitions.id, run.automationId))
      .limit(1)
  )[0];
  const clinic = (
    await db
      .select({ name: schema.clinics.name, timezone: schema.clinics.timezone })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, run.clinicId))
      .limit(1)
  )[0];
  const professional = appt.professionalId
    ? (
        await db
          .select({ name: schema.professionals.name })
          .from(schema.professionals)
          .where(eq(schema.professionals.id, appt.professionalId))
          .limit(1)
      )[0]
    : undefined;
  const procedure = appt.procedureId
    ? (
        await db
          .select({ name: schema.procedures.name })
          .from(schema.procedures)
          .where(eq(schema.procedures.id, appt.procedureId))
          .limit(1)
      )[0]
    : undefined;

  const tz = clinic?.timezone ?? "America/Sao_Paulo";
  const zoned = utcToZoned(new Date(appt.startsAt), tz);
  const [y, m, d] = zoned.dateISO.split("-");
  const template = settings.messageTemplate ?? definition?.defaultTemplate ?? "";

  const body = renderTemplate(
    template,
    {
      nome: customer.fullName.split(" ")[0] ?? customer.fullName,
      clinica: clinic?.name ?? "",
      data: `${d}/${m}/${y}`,
      hora: zoned.timeHHMM,
      profissional: professional?.name ?? "nossa equipe",
      procedimento: procedure?.name ?? "seu atendimento",
      telefone: formatPhoneBR(customer.phoneE164),
    },
    { html: false },
  );

  // ── Conversa + mensagem ──────────────────────────────────────────
  const remoteJid = `${customer.phoneE164.replace("+", "")}@s.whatsapp.net`;
  const conversationId = await ensureConversationForAutomation(
    run.clinicId,
    instance.id,
    remoteJid,
    customer.id,
  );

  const initialStatus = settings.requiresApproval ? "pending_approval" : "queued";
  const [message] = await db
    .insert(schema.messages)
    .values({
      clinicId: run.clinicId,
      conversationId,
      direction: "outbound",
      author: "automation",
      body,
      status: initialStatus,
      automationId: run.automationId,
      automationRunId: run.id,
      // Jitter anti-fingerprint: nunca envia em segundo exato
      scheduledFor: new Date(Date.now() + 5_000 + Math.floor(Math.random() * 25_000)),
    })
    .returning({ id: schema.messages.id });
  if (!message) throw new Error("falha ao criar mensagem");

  if (settings.requiresApproval) {
    const contextLine = [
      procedure?.name,
      `${d}/${m} às ${zoned.timeHHMM}`,
      professional?.name,
    ]
      .filter(Boolean)
      .join(" · ");
    await db.insert(schema.approvals).values({
      clinicId: run.clinicId,
      messageId: message.id,
      customerId: customer.id,
      automationId: run.automationId,
      runId: run.id,
      generatedBody: body,
      contextLine,
      expiresAt: new Date(appt.startsAt),
    });
    await log(run, "pending_approval", undefined, message.id);
  } else {
    await log(run, "queued", undefined, message.id);
  }

  await finishRun(run.id, "completed");
}

async function ensureConversationForAutomation(
  clinicId: string,
  instanceId: string,
  remoteJid: string,
  customerId: string,
): Promise<string> {
  const db = unsafeGlobalDb();
  const existing = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.instanceId, instanceId),
        eq(schema.conversations.remoteJid, remoteJid),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [created] = await db
    .insert(schema.conversations)
    .values({ clinicId, instanceId, remoteJid, customerId })
    .onConflictDoNothing()
    .returning({ id: schema.conversations.id });
  if (created) return created.id;

  const retry = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.instanceId, instanceId),
        eq(schema.conversations.remoteJid, remoteJid),
      ),
    )
    .limit(1);
  if (!retry[0]) throw new Error("falha ao garantir conversa da automação");
  return retry[0].id;
}

/** Aprovações vencidas: pula o envio (o passo expira, não empilha atraso). */
export async function expireApprovals(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const expired = await db
    .update(schema.approvals)
    .set({ status: "expired" })
    .where(
      and(eq(schema.approvals.status, "pending"), lte(schema.approvals.expiresAt, new Date())),
    )
    .returning({ messageId: schema.approvals.messageId, clinicId: schema.approvals.clinicId });
  if (expired.length === 0) return;

  await db
    .update(schema.messages)
    .set({ status: "expired" })
    .where(
      and(
        inArray(
          schema.messages.id,
          expired.map((e) => e.messageId),
        ),
        eq(schema.messages.status, "pending_approval"),
      ),
    );
  logger.info({ count: expired.length }, "aprovações expiradas");
}
