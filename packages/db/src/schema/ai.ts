import { bigserial, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinics } from "./tenancy";
import { whatsappInstances } from "./whatsapp";

/** Medição de uso da IA por clínica — controle de custo e limite mensal. */
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
    /** Custo estimado em reais no momento da chamada (tokens × preço × câmbio). */
    costBrl: numeric("cost_brl", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_clinic_month_idx2").on(t.clinicId, t.createdAt)],
);

/** Um registro por modelo (template) enviado pela API oficial da Meta — é o que a Meta cobra. */
export const whatsappUsage = pgTable(
  "whatsapp_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    instanceId: uuid("instance_id").references(() => whatsappInstances.id, { onDelete: "set null" }),
    messageId: uuid("message_id"),
    category: text("category").notNull(),
    templateName: text("template_name"),
    costBrl: numeric("cost_brl", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("whatsapp_usage_clinic_month_idx").on(t.clinicId, t.createdAt)],
);
