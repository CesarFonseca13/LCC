import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { renderTemplate } from "@clinicaos/core/template-render";
import { todayISO, utcToZoned, zonedToUtc } from "@clinicaos/core/timezone";
import { findSlots, schema, unsafeGlobalDb } from "@clinicaos/db";
import { clampToSendWindow, mergedConfig } from "./reactivation";
import { pickInstanceForCustomer } from "./whatsapp";

/**
 * Motor de automações: varre automation_runs.next_run_at <= now() (a fila real
 * é o Postgres) e executa cada tipo com a SUA elegibilidade — revalidada no
 * momento da execução. Run inválida morre em silêncio, com log.
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
    const claimed = await db
      .update(schema.automationRuns)
      .set({ status: "processing" })
      .where(and(eq(schema.automationRuns.id, id), eq(schema.automationRuns.status, "active")))
      .returning();
    const run = claimed[0];
    if (!run) continue;

    try {
      await executeRun(run, logger);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ runId: run.id, automationId: run.automationId, err: message }, "falha na automação");
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

// ── Contexto compartilhado ───────────────────────────────────────────

interface RunContext {
  run: Run;
  appointment: typeof schema.appointments.$inferSelect | null;
  customer: typeof schema.customers.$inferSelect;
  clinic: { name: string; timezone: string; googleReviewUrl: string | null };
  procedure: typeof schema.procedures.$inferSelect | null;
  professionalName: string | null;
  settings: typeof schema.automationSettings.$inferSelect | null;
  definition: typeof schema.automationDefinitions.$inferSelect;
  instance: { id: string; name: string } | null;
}

/** Carrega tudo e aplica as guardas universais. Retorna null se a run deve morrer. */
async function loadContext(run: Run): Promise<RunContext | "postpone" | null> {
  const db = unsafeGlobalDb();

  const customer = (
    await db.select().from(schema.customers).where(eq(schema.customers.id, run.customerId)).limit(1)
  )[0];
  if (!customer || customer.deletedAt || customer.automationsBlocked || customer.optedOutAt) {
    await finishRun(run.id, "skipped", "cliente bloqueada/opt-out");
    await log(run, "skipped", "cliente bloqueada/opt-out");
    return null;
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
    return null;
  }

  const definition = (
    await db
      .select()
      .from(schema.automationDefinitions)
      .where(eq(schema.automationDefinitions.id, run.automationId))
      .limit(1)
  )[0];
  const clinic = (
    await db
      .select({
        name: schema.clinics.name,
        timezone: schema.clinics.timezone,
        googleReviewUrl: schema.clinics.googleReviewUrl,
      })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, run.clinicId))
      .limit(1)
  )[0];
  if (!definition || !clinic) {
    await finishRun(run.id, "error", "definição/clínica ausente");
    return null;
  }

  // Multi-número: usa o número que JÁ conversa com a cliente (senão o principal)
  const instance = await pickInstanceForCustomer(run.clinicId, run.customerId);
  if (!instance) {
    // WhatsApp fora: adia 5 minutos sem perder o estado
    const db2 = unsafeGlobalDb();
    await db2
      .update(schema.automationRuns)
      .set({ status: "active", nextRunAt: new Date(Date.now() + 5 * 60_000) })
      .where(eq(schema.automationRuns.id, run.id));
    return "postpone";
  }

  let appointment: RunContext["appointment"] = null;
  let procedure: RunContext["procedure"] = null;
  let professionalName: string | null = null;
  // Reativação: a run guarda o procedimento direto (não nasce de agendamento)
  if (!run.appointmentId && run.procedureId) {
    procedure =
      (
        await db
          .select()
          .from(schema.procedures)
          .where(eq(schema.procedures.id, run.procedureId))
          .limit(1)
      )[0] ?? null;
  }
  if (run.appointmentId) {
    appointment =
      (
        await db
          .select()
          .from(schema.appointments)
          .where(eq(schema.appointments.id, run.appointmentId))
          .limit(1)
      )[0] ?? null;
    if (appointment?.procedureId) {
      procedure =
        (
          await db
            .select()
            .from(schema.procedures)
            .where(eq(schema.procedures.id, appointment.procedureId))
            .limit(1)
        )[0] ?? null;
    }
    if (appointment) {
      professionalName =
        (
          await db
            .select({ name: schema.professionals.name })
            .from(schema.professionals)
            .where(eq(schema.professionals.id, appointment.professionalId))
            .limit(1)
        )[0]?.name ?? null;
    }
  }

  return { run, appointment, customer, clinic, procedure, professionalName, settings, definition, instance };
}

function apptVars(ctx: RunContext): Record<string, string> {
  const tz = ctx.clinic.timezone;
  const vars: Record<string, string> = {
    nome: ctx.customer.fullName.split(" ")[0] ?? ctx.customer.fullName,
    clinica: ctx.clinic.name,
    procedimento: ctx.procedure?.name ?? "seu atendimento",
    profissional: ctx.professionalName ?? "nossa equipe",
  };
  if (ctx.appointment) {
    const z = utcToZoned(new Date(ctx.appointment.startsAt), tz);
    const [y, m, d] = z.dateISO.split("-");
    vars.data = `${d}/${m}/${y}`;
    vars.hora = z.timeHHMM;
  }
  return vars;
}

/** Cria a mensagem (direto ou via Aprovações) + log + encerra a run. */
async function emit(
  ctx: RunContext,
  body: string,
  opts: { forceDirect?: boolean; approvalExpiresAt?: Date | null; contextLine?: string } = {},
): Promise<void> {
  const db = unsafeGlobalDb();
  const remoteJid = `${ctx.customer.phoneE164.replace("+", "")}@s.whatsapp.net`;
  const conversationId = await ensureConversationForAutomation(
    ctx.run.clinicId,
    ctx.instance!.id,
    remoteJid,
    ctx.customer.id,
  );

  const requiresApproval = !opts.forceDirect && (ctx.settings?.requiresApproval ?? true);
  const [message] = await db
    .insert(schema.messages)
    .values({
      clinicId: ctx.run.clinicId,
      conversationId,
      direction: "outbound",
      author: "automation",
      body,
      status: requiresApproval ? "pending_approval" : "queued",
      automationId: ctx.run.automationId,
      automationRunId: ctx.run.id,
      scheduledFor: new Date(Date.now() + 5_000 + Math.floor(Math.random() * 25_000)),
    })
    .returning({ id: schema.messages.id });
  if (!message) throw new Error("falha ao criar mensagem");

  if (requiresApproval) {
    await db.insert(schema.approvals).values({
      clinicId: ctx.run.clinicId,
      messageId: message.id,
      customerId: ctx.customer.id,
      automationId: ctx.run.automationId,
      runId: ctx.run.id,
      generatedBody: body,
      contextLine: opts.contextLine ?? null,
      expiresAt: opts.approvalExpiresAt ?? new Date(Date.now() + 48 * 3_600_000),
    });
    await log(ctx.run, "pending_approval", undefined, message.id);
  } else {
    await log(ctx.run, "queued", undefined, message.id);
  }
}

function template(ctx: RunContext): string {
  return ctx.settings?.messageTemplate ?? ctx.definition.defaultTemplate;
}

// ── Execução por tipo ────────────────────────────────────────────────

async function executeRun(run: Run, logger: Logger): Promise<void> {
  const loaded = await loadContext(run);
  if (loaded === null) return;
  if (loaded === "postpone") {
    logger.warn({ runId: run.id }, "instância desconectada — automação adiada 5min");
    return;
  }
  const ctx = loaded;
  const db = unsafeGlobalDb();

  const skip = async (reason: string) => {
    await finishRun(run.id, "skipped", reason);
    await log(run, "skipped", reason);
  };
  const cancel = async (reason: string) => {
    await finishRun(run.id, "cancelled", reason);
    await log(run, "cancelled", reason);
  };

  switch (run.automationId) {
    // ── Confirmação de agenda ────────────────────────────────────────
    case "reminder_24h":
    case "confirm_2h": {
      if (!ctx.appointment || !["scheduled", "confirmed"].includes(ctx.appointment.status)) {
        return cancel(`agendamento ${ctx.appointment?.status ?? "inexistente"}`);
      }
      if (ctx.appointment.status === "confirmed") {
        await finishRun(run.id, "goal_reached", "cliente já confirmou");
        return log(run, "goal_reached");
      }
      if (new Date(ctx.appointment.startsAt) <= new Date()) return skip("horário já passou");
      const vars = apptVars(ctx);
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        approvalExpiresAt: new Date(ctx.appointment.startsAt),
        contextLine: [vars.procedimento, `${vars.data} às ${vars.hora}`, vars.profissional].join(" · "),
      });
      return finishRun(run.id, "completed");
    }

    case "reminder_45min": {
      // Time-critical: envia mesmo confirmado e NUNCA passa por aprovação
      if (!ctx.appointment || !["scheduled", "confirmed"].includes(ctx.appointment.status)) {
        return cancel(`agendamento ${ctx.appointment?.status ?? "inexistente"}`);
      }
      const untilStart = new Date(ctx.appointment.startsAt).getTime() - Date.now();
      if (untilStart < 5 * 60_000) return skip("em cima da hora — não faz mais sentido");
      await emit(ctx, renderTemplate(template(ctx), apptVars(ctx), { html: false }), {
        forceDirect: true,
      });
      return finishRun(run.id, "completed");
    }

    case "pre_care": {
      if (!ctx.appointment || !["scheduled", "confirmed"].includes(ctx.appointment.status)) {
        return cancel(`agendamento ${ctx.appointment?.status ?? "inexistente"}`);
      }
      if (!ctx.procedure?.preCare) return skip("procedimento sem pré-cuidados");
      const vars: Record<string, string> = {
        ...apptVars(ctx),
        cuidados: ctx.procedure.preCare,
      };
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        approvalExpiresAt: new Date(ctx.appointment.startsAt),
        contextLine: `${vars.procedimento} · ${vars.data} às ${vars.hora}`,
      });
      return finishRun(run.id, "completed");
    }

    // ── Recuperação de faltas ────────────────────────────────────────
    case "no_show_message":
    case "no_show_followup": {
      if (!ctx.appointment || ctx.appointment.status !== "no_show") {
        return cancel(`agendamento não está mais como falta (${ctx.appointment?.status})`);
      }
      const future = (
        await db
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.customerId, run.customerId),
              inArray(schema.appointments.status, ["scheduled", "confirmed"]),
              gt(schema.appointments.startsAt, new Date()),
            ),
          )
          .limit(1)
      )[0];
      if (future) {
        await finishRun(run.id, "goal_reached", "cliente já remarcou");
        return log(run, "goal_reached", "cliente já remarcou");
      }
      const vars = apptVars(ctx);
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        contextLine: `Faltou: ${vars.procedimento} de ${vars.data} às ${vars.hora}`,
      });
      return finishRun(run.id, "completed");
    }

    // ── Pós-atendimento ──────────────────────────────────────────────
    case "post_visit": {
      if (!ctx.appointment || ctx.appointment.status !== "showed") {
        return cancel("atendimento não está mais como compareceu");
      }
      const vars: Record<string, string> = {
        ...apptVars(ctx),
        cuidados:
          ctx.procedure?.postCare ??
          "Qualquer dúvida sobre os cuidados de casa, é só me chamar!",
      };
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        contextLine: `Pós-atendimento · ${vars.procedimento} de hoje`,
      });
      return finishRun(run.id, "completed");
    }

    case "feedback_request": {
      if (!ctx.appointment || ctx.appointment.status !== "showed") {
        return cancel("atendimento não está mais como compareceu");
      }
      const vars = apptVars(ctx);
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        contextLine: `Feedback · ${vars.procedimento} de ${vars.data}`,
      });
      return finishRun(run.id, "completed");
    }

    case "touchup_offer": {
      if (!ctx.appointment || ctx.appointment.status !== "showed") {
        return cancel("atendimento base não é mais compareceu");
      }
      if (!ctx.procedure?.touchupDays) return skip("procedimento sem retoque");
      // Já tem horário futuro do mesmo procedimento? Objetivo alcançado.
      const future = (
        await db
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.customerId, run.customerId),
              eq(schema.appointments.procedureId, ctx.procedure.id),
              inArray(schema.appointments.status, ["scheduled", "confirmed"]),
              gt(schema.appointments.startsAt, new Date()),
            ),
          )
          .limit(1)
      )[0];
      if (future) {
        await finishRun(run.id, "goal_reached", "retoque já agendado");
        return log(run, "goal_reached");
      }
      const vars: Record<string, string> = {
        ...apptVars(ctx),
        dias: String(ctx.procedure.touchupDays),
      };
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        contextLine: `Retoque de ${vars.procedimento} (${vars.dias} dias)`,
      });
      return finishRun(run.id, "completed");
    }

    case "post_sale_cadence": {
      if (!ctx.appointment || ctx.appointment.status !== "showed") {
        return cancel("atendimento base não é mais compareceu");
      }
      const days = (ctx.procedure?.postSaleCadenceDays ?? []).slice().sort((a, b) => a - b);
      if (days.length === 0 || run.currentStep >= days.length) {
        return skip("sem passos de pós-venda");
      }
      // Refez o procedimento nesse meio-tempo? Cadência morre.
      const base = ctx.appointment.statusChangedAt ?? ctx.appointment.startsAt;
      const redone = ctx.procedure
        ? (
            await db
              .select({ id: schema.appointments.id })
              .from(schema.appointments)
              .where(
                and(
                  eq(schema.appointments.customerId, run.customerId),
                  eq(schema.appointments.procedureId, ctx.procedure.id),
                  inArray(schema.appointments.status, ["scheduled", "confirmed", "showed"]),
                  gt(schema.appointments.startsAt, new Date(base)),
                  // Nunca o próprio atendimento base (check-in antecipado é normal)
                  sql`${schema.appointments.id} <> ${ctx.appointment.id}`,
                ),
              )
              .limit(1)
          )[0]
        : undefined;
      if (redone) {
        await finishRun(run.id, "goal_reached", "cliente voltou/agendou de novo");
        return log(run, "goal_reached");
      }

      const vars = apptVars(ctx);
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        contextLine: `Pós-venda ${run.currentStep + 1}/${days.length} · ${vars.procedimento}`,
      });

      const nextStep = run.currentStep + 1;
      if (nextStep < days.length) {
        await db
          .update(schema.automationRuns)
          .set({
            status: "active",
            currentStep: nextStep,
            nextRunAt: new Date(new Date(base).getTime() + days[nextStep]! * 86_400_000),
          })
          .where(eq(schema.automationRuns.id, run.id));
        return;
      }
      return finishRun(run.id, "completed");
    }

    // ── Reativação (sequências longas; resposta pausa, agendou = objetivo) ─
    case "reactivation_smart":
    case "reactivation_generic": {
      const future = (
        await db
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.customerId, run.customerId),
              inArray(schema.appointments.status, ["scheduled", "confirmed"]),
              gt(schema.appointments.startsAt, new Date()),
            ),
          )
          .limit(1)
      )[0];
      if (future) {
        await finishRun(run.id, "goal_reached", "cliente agendou");
        return log(run, "goal_reached", "cliente agendou");
      }

      const config = mergedConfig(ctx.definition.defaultConfig, ctx.settings?.config);
      const steps = config.steps;
      if (steps.length === 0 || run.currentStep >= steps.length) {
        return skip("sequência sem passos");
      }

      // Passo 2+ sem NENHUMA mensagem anterior de fato liberada (tudo expirou na
      // aprovação)? "Passando de novo por aqui" como 1ª mensagem da vida não existe.
      if (run.currentStep > 0) {
        const delivered = (
          await db
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.automationRunId, run.id),
                inArray(schema.messages.status, ["queued", "sending", "sent", "delivered", "read"]),
              ),
            )
            .limit(1)
        )[0];
        if (!delivered) return cancel("nenhuma mensagem da sequência foi aprovada/enviada");
      }

      // Crash entre o emit e o avanço? O log diz se ESTE passo já foi emitido —
      // nunca manda o mesmo balão duas vezes (fingerprint de robô).
      const emitted = await db.execute(sql`
        SELECT count(*)::int AS n FROM automation_log
        WHERE run_id = ${run.id} AND result IN ('queued', 'pending_approval')
      `);
      const alreadyEmitted =
        Number((emitted.rows[0] as { n: number } | undefined)?.n ?? 0) > run.currentStep;

      if (!alreadyEmitted) {
        const vars: Record<string, string> = {
          nome: ctx.customer.fullName.split(" ")[0] ?? ctx.customer.fullName,
          clinica: ctx.clinic.name,
          procedimento: ctx.procedure?.name ?? "seu tratamento",
        };
        const step = steps[run.currentStep]!;
        await emit(ctx, renderTemplate(step.template, vars, { html: false }), {
          contextLine: `Reativação ${run.currentStep + 1}/${steps.length}${
            ctx.procedure ? ` · ${ctx.procedure.name}` : ""
          }`,
        });
      }

      const nextStep = run.currentStep + 1;
      if (nextStep < steps.length) {
        const gapDays = steps[nextStep]!.days - steps[run.currentStep]!.days;
        const nextAt = clampToSendWindow(
          new Date(Date.now() + Math.max(1, gapDays) * 86_400_000),
          ctx.clinic.timezone,
        );
        // Cliente respondeu DURANTE a execução? A pausa venceu: avança o passo
        // mas preserva o estado pausado (a retomada agenda o próximo envio).
        const advanced = await db
          .update(schema.automationRuns)
          .set({ status: "active", currentStep: nextStep, nextRunAt: nextAt })
          .where(
            and(eq(schema.automationRuns.id, run.id), eq(schema.automationRuns.status, "processing")),
          )
          .returning({ id: schema.automationRuns.id });
        if (advanced.length === 0) {
          await db
            .update(schema.automationRuns)
            .set({ currentStep: nextStep, nextRunAt: null })
            .where(
              and(eq(schema.automationRuns.id, run.id), eq(schema.automationRuns.status, "paused")),
            );
        }
        return;
      }
      return finishRun(run.id, "completed", "sequência concluída — despedida enviada");
    }

    // ── Crescimento: preenchimento de agenda e renovação de pacote ──
    case "smart_fill": {
      // Já marcou horário? Missão cumprida sem mensagem.
      const future = (
        await db
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.customerId, run.customerId),
              inArray(schema.appointments.status, ["scheduled", "confirmed"]),
              gt(schema.appointments.startsAt, new Date()),
            ),
          )
          .limit(1)
      )[0];
      if (future) {
        await finishRun(run.id, "goal_reached", "cliente já agendou");
        return log(run, "goal_reached");
      }
      if (!ctx.procedure) return skip("procedimento da oferta não existe mais");

      // Crash entre emit e finish? Nunca manda a mesma oferta duas vezes.
      const fillEmitted = await db.execute(sql`
        SELECT 1 FROM automation_log
        WHERE run_id = ${run.id} AND result IN ('queued', 'pending_approval')
        LIMIT 1
      `);
      if ((fillEmitted.rowCount ?? 0) > 0) return finishRun(run.id, "completed");

      // O slot é escolhido AGORA — nunca oferece horário que acabou de fechar.
      // Preferência pela profissional que já atendeu essa cliente nesse procedimento.
      const config = ((ctx.settings?.config ?? {}) as Record<string, unknown>);
      const defaults = (ctx.definition.defaultConfig ?? {}) as Record<string, unknown>;
      const windowHours = Number(config.window_hours ?? defaults.window_hours ?? 72);
      const slots = await findSlots(db, run.clinicId, ctx.clinic.timezone, ctx.procedure.durationMinutes, 6);
      const cutoff = Date.now() + windowHours * 3_600_000;
      const inWindow = slots.filter(
        (s) => zonedToUtc(s.dateISO, s.timeHHMM, ctx.clinic.timezone).getTime() <= cutoff,
      );
      if (inWindow.length === 0) return skip("sem buracos na agenda dentro da janela");
      const usualProfessional = (
        await db
          .select({ professionalId: schema.appointments.professionalId })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.customerId, run.customerId),
              eq(schema.appointments.procedureId, ctx.procedure.id),
              eq(schema.appointments.status, "showed"),
            ),
          )
          .orderBy(sql`starts_at DESC`)
          .limit(1)
      )[0];
      const slot =
        inWindow.find(
          (s) => s.slotId.split("|")[0] === usualProfessional?.professionalId,
        ) ?? inWindow[0]!;

      const vars: Record<string, string> = {
        nome: ctx.customer.fullName.split(" ")[0] ?? ctx.customer.fullName,
        clinica: ctx.clinic.name,
        procedimento: ctx.procedure.name,
        horario: slot.label,
      };
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        contextLine: `Preenchimento de agenda · ${slot.label}`,
        // Oferta de horário envelhece rápido: aprovação vale só até o próprio slot
        approvalExpiresAt: zonedToUtc(slot.dateISO, slot.timeHHMM, ctx.clinic.timezone),
      });
      return finishRun(run.id, "completed");
    }

    case "package_renewal_sessions":
    case "package_renewal_expiry": {
      const isSessions = run.automationId === "package_renewal_sessions";
      const config = ((ctx.settings?.config ?? {}) as Record<string, unknown>);
      const defaults = (ctx.definition.defaultConfig ?? {}) as Record<string, unknown>;
      const threshold = Number(config.sessions_left_threshold ?? defaults.sessions_left_threshold ?? 1);
      const expiryDays = Number(config.expiry_days ?? defaults.expiry_days ?? 7);

      // Crash entre emit e finish? Nunca manda o mesmo convite duas vezes.
      const renewalEmitted = await db.execute(sql`
        SELECT 1 FROM automation_log
        WHERE run_id = ${run.id} AND result IN ('queued', 'pending_approval')
        LIMIT 1
      `);
      if ((renewalEmitted.rowCount ?? 0) > 0) return finishRun(run.id, "completed");

      // Comprou pacote novo depois que o convite nasceu? Objetivo alcançado.
      const renewed = await db.execute(sql`
        SELECT 1 FROM customer_packages
        WHERE customer_id = ${run.customerId} AND created_at > ${run.startedAt}
        LIMIT 1
      `);
      if ((renewed.rowCount ?? 0) > 0) {
        await finishRun(run.id, "goal_reached", "cliente já renovou");
        return log(run, "goal_reached");
      }

      // Revalida o gatilho na hora do envio (pacote pode ter mudado)
      const pkg = await db.execute(sql`
        WITH ctx AS (SELECT (now() AT TIME ZONE ${ctx.clinic.timezone})::date AS today)
        SELECT pk.name, (cp.sessions_total - cp.sessions_used) AS sessions_left
        FROM customer_packages cp
        JOIN packages pk ON pk.id = cp.package_id
        CROSS JOIN ctx
        WHERE cp.customer_id = ${run.customerId} AND cp.clinic_id = ${run.clinicId}
          AND cp.status = 'active'
          AND (cp.expires_at IS NULL OR cp.expires_at >= ctx.today)
          AND ${
            isSessions
              ? sql`cp.sessions_used > 0 AND (cp.sessions_total - cp.sessions_used) <= ${threshold}`
              : sql`cp.expires_at IS NOT NULL
                    AND cp.expires_at <= ctx.today + make_interval(days => ${expiryDays})
                    AND cp.sessions_used < cp.sessions_total`
          }
        ORDER BY cp.expires_at ASC NULLS LAST
        LIMIT 1
      `);
      const pkgRow = pkg.rows[0] as { name: string; sessions_left: number } | undefined;
      if (!pkgRow) return skip("pacote não está mais no gatilho de renovação");

      const vars: Record<string, string> = {
        nome: ctx.customer.fullName.split(" ")[0] ?? ctx.customer.fullName,
        clinica: ctx.clinic.name,
        pacote: pkgRow.name,
        sessoes: String(pkgRow.sessions_left),
        procedimento: ctx.procedure?.name ?? "seu tratamento",
      };
      await emit(ctx, renderTemplate(template(ctx), vars, { html: false }), {
        contextLine: `Renovação · ${pkgRow.name} (${isSessions ? `${pkgRow.sessions_left} sessão(ões) restante(s)` : "vencendo em breve"})`,
      });
      return finishRun(run.id, "completed");
    }

    default:
      return skip(`tipo desconhecido: ${run.automationId}`);
  }
}

// ── Aniversários (sweep dedicado, dedupe por ano via automation_log) ─

export async function processBirthdays(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const hoje = todayISO("America/Sao_Paulo");
  const monthDay = hoje.slice(5); // MM-DD
  const year = hoje.slice(0, 4);

  const birthdays = await db.execute(sql`
    SELECT c.id AS customer_id, c.clinic_id, c.full_name, c.phone_e164
    FROM customers c
    JOIN automation_settings s ON s.clinic_id = c.clinic_id
      AND s.automation_id = 'birthday' AND s.enabled
    JOIN whatsapp_instances w ON w.clinic_id = c.clinic_id AND w.status = 'connected'
    WHERE c.deleted_at IS NULL AND NOT c.automations_blocked AND c.opted_out_at IS NULL
      AND c.birth_date IS NOT NULL
      AND to_char(c.birth_date, 'MM-DD') = ${monthDay}
      AND NOT EXISTS (
        SELECT 1 FROM automation_log al
        WHERE al.automation_id = 'birthday' AND al.customer_id = c.id
          AND al.created_at >= ${`${year}-01-01`}::date
      )
    LIMIT 20
  `);

  for (const row of birthdays.rows as {
    customer_id: string;
    clinic_id: string;
    full_name: string;
    phone_e164: string;
  }[]) {
    const fakeRun: Run = {
      id: crypto.randomUUID(),
      clinicId: row.clinic_id,
      automationId: "birthday",
      customerId: row.customer_id,
      appointmentId: null,
      procedureId: null,
      currentStep: 0,
      status: "processing",
      nextRunAt: null,
      pausedAt: null,
      stopReason: null,
      startedAt: new Date(),
      finishedAt: null,
    };
    // Cria a run real para rastreabilidade
    const [run] = await db
      .insert(schema.automationRuns)
      .values({
        clinicId: row.clinic_id,
        automationId: "birthday",
        customerId: row.customer_id,
        status: "processing",
      })
      .returning();
    const activeRun = run ?? fakeRun;

    try {
      const loaded = await loadContext(activeRun);
      if (loaded === null || loaded === "postpone") continue;
      const vars = {
        nome: loaded.customer.fullName.split(" ")[0] ?? loaded.customer.fullName,
        clinica: loaded.clinic.name,
      };
      await emit(loaded, renderTemplate(template(loaded), vars, { html: false }), {
        contextLine: "Aniversário de hoje 🎉",
      });
      await finishRun(activeRun.id, "completed");
      logger.info({ customerId: row.customer_id }, "parabéns de aniversário preparado");
    } catch (err) {
      await finishRun(activeRun.id, "error", err instanceof Error ? err.message : String(err));
    }
  }
}

// ── Compartilhado ────────────────────────────────────────────────────

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
    .returning({ messageId: schema.approvals.messageId });
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

