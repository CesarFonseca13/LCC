/**
 * Máquina de estados do agendamento — ÚNICA porta de mutação de status.
 *
 * scheduled ─▶ confirmed ─▶ showed
 *     │            ├─▶ no_show
 *     │            └─▶ cancelled / rescheduled
 *     ├─▶ showed (confirmação implícita: cliente veio sem confirmar)
 *     ├─▶ no_show / cancelled / rescheduled
 * rescheduled: estado terminal — reagendar SEMPRE cria um novo appointment
 * ligado por rescheduled_to_id (decisão de consolidação nº 2).
 */
export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "showed"
  | "no_show"
  | "cancelled"
  | "rescheduled";

export type TransitionSource =
  | "user"
  | "customer_whatsapp"
  | "ai_agent"
  | "automation"
  | "system";

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ["confirmed", "showed", "no_show", "cancelled", "rescheduled"],
  confirmed: ["showed", "no_show", "cancelled", "rescheduled"],
  // Correções operacionais no mesmo dia (recepção marcou errado):
  showed: ["no_show"],
  no_show: ["showed", "rescheduled"],
  cancelled: [],
  rescheduled: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: AppointmentStatus,
    public readonly to: AppointmentStatus,
  ) {
    super(`Transição inválida de agendamento: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Efeitos colaterais que cada transição dispara (executados pela camada de serviço,
 * na MESMA transação da mudança de status; envios são enfileirados pós-commit).
 */
export type TransitionEffect =
  | "cancel_pending_confirmation_cadence"
  | "start_post_visit_flow"        // pós-atendimento, feedback, cadência pós-venda
  | "offer_touchup"                // se procedure.touchup_days
  | "consume_stock"                // procedure_supplies → stock_movements
  | "consume_package_session"      // se appointment de pacote (config no_show à parte)
  | "accrue_commission"
  | "create_receivable"
  | "start_no_show_recovery"
  | "send_cancellation_reply"
  | "reply_confirmation";

export function effectsOf(
  from: AppointmentStatus,
  to: AppointmentStatus,
): readonly TransitionEffect[] {
  assertTransition(from, to);
  switch (to) {
    case "confirmed":
      return ["reply_confirmation", "cancel_pending_confirmation_cadence"];
    case "showed":
      return [
        "cancel_pending_confirmation_cadence",
        "consume_stock",
        "consume_package_session",
        "accrue_commission",
        "create_receivable",
        "start_post_visit_flow",
        "offer_touchup",
      ];
    case "no_show":
      return ["cancel_pending_confirmation_cadence", "start_no_show_recovery"];
    case "cancelled":
      return ["cancel_pending_confirmation_cadence", "send_cancellation_reply"];
    case "rescheduled":
      // O novo appointment nasce com a própria cadência; aqui só se cancela a antiga.
      return ["cancel_pending_confirmation_cadence"];
    default:
      return [];
  }
}
