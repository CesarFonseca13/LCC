import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "./agenda";
import { customers } from "./customers";
import { messages } from "./whatsapp";
import { clinics, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);

/** Catálogo GLOBAL — parte do produto, seed via migração. */
export const automationDefinitions = pgTable("automation_definitions", {
  id: text("id").primaryKey(),
  phase: text("phase", {
    enum: [
      "confirmation",
      "auto_reply",
      "no_show_recovery",
      "post_visit",
      "reactivation",
      "growth",
    ],
  }).notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  defaultTemplate: text("default_template").notNull(),
  defaultConfig: jsonb("default_config").notNull().default({}),
  sort: integer("sort").notNull().default(0),
});

export const automationSettings = pgTable(
  "automation_settings",
  {
    id: id(),
    clinicId: clinicId(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automationDefinitions.id),
    enabled: boolean("enabled").notNull().default(false),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    messageTemplate: text("message_template"),
    config: jsonb("config").notNull().default({}),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [unique("automation_settings_clinic_automation_uq").on(t.clinicId, t.automationId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    clinicId: clinicId(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automationDefinitions.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "cascade",
    }),
    currentStep: integer("current_step").notNull().default(0),
    status: text("status", {
      enum: [
        "active",
        "processing",
        "completed",
        "goal_reached",
        "cancelled",
        "skipped",
        "error",
      ],
    })
      .notNull()
      .default("active"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    stopReason: text("stop_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("automation_runs_appt_idx2").on(t.appointmentId)],
);

export const automationLog = pgTable(
  "automation_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clinicId: clinicId(),
    automationId: text("automation_id").notNull(),
    runId: uuid("run_id"),
    customerId: uuid("customer_id"),
    appointmentId: uuid("appointment_id"),
    result: text("result", {
      enum: [
        "queued",
        "pending_approval",
        "sent",
        "skipped",
        "goal_reached",
        "cancelled",
        "expired",
        "error",
      ],
    }).notNull(),
    detail: text("detail"),
    messageId: uuid("message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("automation_log_clinic_idx2").on(t.clinicId, t.createdAt)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    clinicId: clinicId(),
    messageId: uuid("message_id")
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    automationId: text("automation_id"),
    runId: uuid("run_id"),
    generatedBody: text("generated_body").notNull(),
    editedBody: text("edited_body"),
    contextLine: text("context_line"),
    status: text("status", {
      enum: ["pending", "approved", "edited_approved", "rejected", "expired"],
    })
      .notNull()
      .default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_clinic_idx2").on(t.clinicId, t.status, t.createdAt)],
);
