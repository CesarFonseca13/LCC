import { bigserial, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinics } from "./tenancy";

/** Medição de uso da IA por clínica — controle de custo e kill-switch mensal. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_clinic_month_idx2").on(t.clinicId, t.createdAt)],
);
