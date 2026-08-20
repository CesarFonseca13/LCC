import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "./agenda";
import { procedures } from "./catalog";
import { clinics, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);

export const stockItems = pgTable(
  "stock_items",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("un"),
    minQuantity: numeric("min_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Custo unitário de reposição — base do CMV. */
    cost: numeric("cost", { precision: 12, scale: 2 }),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [unique("stock_items_clinic_name_uq").on(t.clinicId, t.name)],
);

/** Fonte da verdade do saldo: SUM(quantity). Positivo entra, negativo sai. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    clinicId: clinicId(),
    stockItemId: uuid("stock_item_id")
      .notNull()
      .references(() => stockItems.id),
    kind: text("kind", {
      enum: ["purchase", "sale", "procedure_use", "adjustment", "loss"],
    }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_movements_item_idx").on(t.clinicId, t.stockItemId, t.createdAt)],
);

export const procedureSupplies = pgTable(
  "procedure_supplies",
  {
    id: id(),
    clinicId: clinicId(),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id, { onDelete: "cascade" }),
    stockItemId: uuid("stock_item_id")
      .notNull()
      .references(() => stockItems.id, { onDelete: "cascade" }),
    quantityPerSession: numeric("quantity_per_session", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [unique("procedure_supplies_uq").on(t.procedureId, t.stockItemId)],
);
