import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { packages, procedures } from "./catalog";
import { customers } from "./customers";
import { clinics, users } from "./tenancy";

export const clinicCounters = pgTable(
  "clinic_counters",
  {
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.key] })],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    number: integer("number").notNull(),
    status: text("status", {
      enum: ["sent", "viewed", "accepted", "rejected", "expired"],
    })
      .notNull()
      .default("sent"),
    validUntil: date("valid_until").notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    notes: text("notes"),
    publicToken: text("public_token").notNull().unique(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [
    unique("quotes_clinic_number_uq").on(t.clinicId, t.number),
    index("quotes_clinic_status_idx2").on(t.clinicId, t.status, t.createdAt),
  ],
);

export const quoteItems = pgTable(
  "quote_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["procedure", "package"] }).notNull(),
    procedureId: uuid("procedure_id").references(() => procedures.id),
    packageId: uuid("package_id").references(() => packages.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [index("quote_items_quote_idx2").on(t.quoteId)],
);
