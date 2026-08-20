import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "./agenda";
import { procedures } from "./catalog";
import { customers } from "./customers";
import { clinics, professionals, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);

/** Regra profissional×procedimento; a mais específica vence. */
export const commissionRules = pgTable("commission_rules", {
  id: id(),
  clinicId: clinicId(),
  professionalId: uuid("professional_id")
    .notNull()
    .references(() => professionals.id, { onDelete: "cascade" }),
  /** NULL = vale para todos os procedimentos da profissional. */
  procedureId: uuid("procedure_id").references(() => procedures.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["pct", "fixed"] }).notNull().default("pct"),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Nasce no Compareceu — regime "atendimentos realizados no período". */
export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: id(),
    clinicId: clinicId(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id),
    appointmentId: uuid("appointment_id")
      .notNull()
      .unique()
      .references(() => appointments.id),
    customerId: uuid("customer_id").references(() => customers.id),
    procedureId: uuid("procedure_id").references(() => procedures.id),
    baseAmount: numeric("base_amount", { precision: 12, scale: 2 }).notNull(),
    commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 }).notNull(),
    ruleSource: text("rule_source").notNull(),
    status: text("status", { enum: ["pending", "paid"] }).notNull().default("pending"),
    paymentId: uuid("payment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commission_entries_clinic_prof_idx").on(t.clinicId, t.professionalId, t.createdAt),
  ],
);

/** "Marcar como pago" agrupa as pendentes e vira despesa no financeiro. */
export const commissionPayments = pgTable("commission_payments", {
  id: id(),
  clinicId: clinicId(),
  professionalId: uuid("professional_id")
    .notNull()
    .references(() => professionals.id),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  entryCount: integer("entry_count").notNull(),
  payableId: uuid("payable_id"),
  paidAt: date("paid_at").notNull().default(sql`current_date`),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
