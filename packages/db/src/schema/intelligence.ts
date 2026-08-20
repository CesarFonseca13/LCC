import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { clinics } from "./tenancy";

/** Snapshot materializado do score 0-100 — recalculado por job diário e sob demanda. */
export const customerScores = pgTable(
  "customer_scores",
  {
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    customerId: uuid("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    recencyScore: integer("recency_score").notNull(),
    frequencyScore: integer("frequency_score").notNull(),
    valueScore: integer("value_score").notNull(),
    engagementScore: integer("engagement_score").notNull(),
    classification: text("classification", { enum: ["quente", "morno", "frio"] }).notNull(),
    suggestedKind: text("suggested_kind").notNull().default("none"),
    suggestedAction: text("suggested_action"),
    metrics: jsonb("metrics").notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("customer_scores_clinic_score_idx").on(t.clinicId, t.score),
    index("customer_scores_clinic_kind_idx").on(t.clinicId, t.suggestedKind),
  ],
);
