import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { procedures } from "./catalog";
import { clinics, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const customers = pgTable(
  "customers",
  {
    id: id(),
    clinicId: clinicId(),
    fullName: text("full_name").notNull(),
    socialName: text("social_name"),
    cpf: text("cpf"),
    rg: text("rg"),
    birthDate: date("birth_date"),
    sex: text("sex", { enum: ["feminino", "masculino", "outro"] }),
    insuranceName: text("insurance_name"),
    insurancePlan: text("insurance_plan"),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    instagram: text("instagram"),
    occupation: text("occupation"),
    addressStreet: text("address_street"),
    addressNumber: text("address_number"),
    addressComplement: text("address_complement"),
    addressDistrict: text("address_district"),
    addressCity: text("address_city"),
    addressState: text("address_state"),
    addressZip: text("address_zip"),
    source: text("source"),
    status: text("status", { enum: ["lead", "active", "at_risk", "inactive"] })
      .notNull()
      .default("lead"),
    automationsBlocked: boolean("automations_blocked").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    photoConsent: boolean("photo_consent").notNull().default(false),
    lgpdConsentAt: timestamp("lgpd_consent_at", { withTimezone: true }),
    lgpdConsentSource: text("lgpd_consent_source"),
    whatsappValid: boolean("whatsapp_valid"),
    notes: text("notes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    mergedIntoId: uuid("merged_into_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("customers_clinic_status_idx2").on(t.clinicId, t.status)],
);

export const customerPhones = pgTable(
  "customer_phones",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    label: text("label"),
    createdAt: createdAt(),
  },
  (t) => [unique("customer_phones_customer_phone_uq").on(t.customerId, t.phoneE164)],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#78716c"),
  },
  (t) => [unique("tags_clinic_name_uq").on(t.clinicId, t.name)],
);

export const customerTags = pgTable(
  "customer_tags",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    clinicId: clinicId(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.tagId] })],
);

/** Atendimentos pré-sistema — alimentam score/reativação sem efeitos colaterais. */
export const customerHistoryEntries = pgTable(
  "customer_history_entries",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    occurredOn: date("occurred_on").notNull(),
    procedureId: uuid("procedure_id").references(() => procedures.id),
    procedureName: text("procedure_name"),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("customer_history_clinic_customer_idx2").on(
      t.clinicId,
      t.customerId,
      t.occurredOn,
    ),
  ],
);

export const anamnesisTemplates = pgTable("anamnesis_templates", {
  id: id(),
  clinicId: clinicId(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const anamnesisTemplateVersions = pgTable(
  "anamnesis_template_versions",
  {
    id: id(),
    clinicId: clinicId(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => anamnesisTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    schema: jsonb("schema").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("anamnesis_template_versions_uq").on(t.templateId, t.version)],
);

export const anamnesisResponses = pgTable(
  "anamnesis_responses",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    templateVersionId: uuid("template_version_id")
      .notNull()
      .references(() => anamnesisTemplateVersions.id),
    /** AES-256-GCM — dados de saúde nunca em claro no banco (LGPD art. 11). */
    answersEncrypted: text("answers_encrypted").notNull(),
    /** Rótulos de risco em claro para o alerta vermelho da ficha. */
    riskSummary: text("risk_summary"),
    filledByUserId: uuid("filled_by_user_id").references(() => users.id),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("anamnesis_responses_customer_idx2").on(t.clinicId, t.customerId, t.filledAt),
  ],
);
