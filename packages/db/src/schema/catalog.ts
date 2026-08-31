import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { clinics, professionals } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true });

export const procedures = pgTable(
  "procedures",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    category: text("category"),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    /** Prazo de retorno em dias — motor da reativação inteligente. */
    returnDays: integer("return_days"),
    /** Dias até o retoque — automação "Confirmação do Retoque". */
    touchupDays: integer("touchup_days"),
    preCare: text("pre_care"),
    preCareHoursBefore: integer("pre_care_hours_before").notNull().default(24),
    postCare: text("post_care"),
    postSaleCadenceDays: integer("post_sale_cadence_days").array(),
    commissionDefaultPct: numeric("commission_default_pct", { precision: 5, scale: 2 }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("procedures_clinic_active_idx").on(t.clinicId, t.active)],
);

export const packages = pgTable(
  "packages",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
    validityDays: integer("validity_days"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("packages_clinic_active_idx").on(t.clinicId, t.active)],
);

export const packageItems = pgTable(
  "package_items",
  {
    id: id(),
    clinicId: clinicId(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id),
    sessions: integer("sessions").notNull(),
  },
  (t) => [unique("package_items_package_procedure_uq").on(t.packageId, t.procedureId)],
);

/** Serviços que cada profissional realiza. SEM linhas = faz todos (padrão);
 *  COM linhas = somente os listados. Busca de horários respeita o vínculo. */
export const professionalProcedures = pgTable(
  "professional_procedures",
  {
    clinicId: clinicId(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("professional_procedures_pk").on(t.professionalId, t.procedureId),
    index("professional_procedures_clinic_idx2").on(t.clinicId),
  ],
);
