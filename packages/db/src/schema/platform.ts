import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { clinics, users } from "./tenancy";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    /** NULL = todos os usuários da clínica. */
    userId: uuid("user_id").references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    refTable: text("ref_table"),
    refId: uuid("ref_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_clinic_user_idx").on(t.clinicId, t.userId, t.readAt)],
);

/** LGPD: quem acessou/alterou o quê (dados sensíveis e exports). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    userId: uuid("user_id").references(() => users.id),
    action: text("action", {
      enum: ["create", "update", "delete", "view_sensitive", "export"],
    }).notNull(),
    tableName: text("table_name").notNull(),
    recordId: uuid("record_id"),
    changes: jsonb("changes"),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_clinic_created_idx").on(t.clinicId, t.createdAt),
    index("audit_log_record_idx").on(t.tableName, t.recordId),
  ],
);

export const emailLog = pgTable("email_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid("clinic_id").references(() => clinics.id),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  kind: text("kind").notNull(),
  status: text("status", { enum: ["queued", "sent", "failed"] })
    .notNull()
    .default("queued"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
