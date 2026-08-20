import { sql } from "drizzle-orm";
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { clinics, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [unique("pipeline_stages_clinic_name_uq").on(t.clinicId, t.name)],
);

export const deals = pgTable(
  "deals",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** NULL = primeira coluna do funil ("Novo contato"). */
    stageId: uuid("stage_id").references(() => pipelineStages.id),
    value: numeric("value", { precision: 12, scale: 2 }),
    source: text("source"),
    notes: text("notes"),
    status: text("status", { enum: ["open", "won", "lost"] }).notNull().default("open"),
    lostReason: text("lost_reason"),
    wonAt: timestamp("won_at", { withTimezone: true }),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("deals_clinic_status_idx").on(t.clinicId, t.status, t.createdAt)],
);
