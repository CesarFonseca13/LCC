import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "./agenda";
import { packages, procedures } from "./catalog";
import { customers } from "./customers";
import { clinics, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const financeCategories = pgTable(
  "finance_categories",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["income", "expense"] }).notNull(),
    color: text("color").notNull().default("#78716c"),
  },
  (t) => [unique("finance_categories_clinic_kind_name_uq").on(t.clinicId, t.kind, t.name)],
);

export const customerPackages = pgTable(
  "customer_packages",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    procedureId: uuid("procedure_id").references(() => procedures.id),
    sessionsTotal: integer("sessions_total").notNull(),
    sessionsUsed: integer("sessions_used").notNull().default(0),
    pricePaid: numeric("price_paid", { precision: 12, scale: 2 }).notNull(),
    purchasedAt: date("purchased_at").notNull().default(sql`current_date`),
    expiresAt: date("expires_at"),
    status: text("status", { enum: ["active", "completed", "expired", "cancelled"] })
      .notNull()
      .default("active"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("customer_packages_clinic_customer_idx2").on(t.clinicId, t.customerId)],
);

export const packageSessionUses = pgTable(
  "package_session_uses",
  {
    id: id(),
    clinicId: clinicId(),
    customerPackageId: uuid("customer_package_id")
      .notNull()
      .references(() => customerPackages.id),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
  },
  (t) => [index("package_session_uses_pkg_idx2").on(t.customerPackageId)],
);

export const receivables = pgTable(
  "receivables",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id").references(() => customers.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    customerPackageId: uuid("customer_package_id").references(() => customerPackages.id),
    categoryId: uuid("category_id").references(() => financeCategories.id),
    description: text("description").notNull(),
    grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull(),
    feeAmount: numeric("fee_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
    method: text("method", {
      enum: ["cash", "pix", "debit", "credit", "transfer", "boleto"],
    }),
    installmentNumber: integer("installment_number").notNull().default(1),
    installmentTotal: integer("installment_total").notNull().default(1),
    dueDate: date("due_date").notNull(),
    receivedAt: date("received_at"),
    status: text("status", { enum: ["pending", "received", "cancelled"] })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("receivables_clinic_status_due_idx2").on(t.clinicId, t.status, t.dueDate)],
);

export const payables = pgTable(
  "payables",
  {
    id: id(),
    clinicId: clinicId(),
    description: text("description").notNull(),
    supplier: text("supplier"),
    categoryId: uuid("category_id").references(() => financeCategories.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    dueDate: date("due_date").notNull(),
    paidAt: date("paid_at"),
    status: text("status", { enum: ["pending", "paid", "cancelled"] })
      .notNull()
      .default("pending"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("payables_clinic_status_due_idx2").on(t.clinicId, t.status, t.dueDate)],
);
