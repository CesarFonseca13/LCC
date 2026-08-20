import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { appointments } from "./agenda";
import { procedures } from "./catalog";
import { customers } from "./customers";
import { clinics, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const documentTemplates = pgTable(
  "document_templates",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["consent", "contract", "other"] })
      .notNull()
      .default("consent"),
    bodyText: text("body_text").notNull(),
    variables: text("variables").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("document_templates_clinic_idx2").on(t.clinicId, t.active)],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    templateId: uuid("template_id").references(() => documentTemplates.id),
    procedureId: uuid("procedure_id").references(() => procedures.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    title: text("title").notNull(),
    bodyHtmlRendered: text("body_html_rendered").notNull(),
    variablesSnapshot: jsonb("variables_snapshot").notNull().default({}),
    contentSha256: text("content_sha256").notNull(),
    pdfPath: text("pdf_path"),
    pdfSha256: text("pdf_sha256"),
    status: text("status", {
      enum: ["sent", "viewed", "signed", "declined", "expired"],
    })
      .notNull()
      .default("sent"),
    signToken: text("sign_token").notNull().unique(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("documents_clinic_status_idx2").on(t.clinicId, t.status, t.createdAt)],
);

export const documentSignatures = pgTable("document_signatures", {
  id: id(),
  clinicId: clinicId(),
  documentId: uuid("document_id")
    .notNull()
    .unique()
    .references(() => documents.id, { onDelete: "cascade" }),
  signerName: text("signer_name").notNull(),
  signerCpf: text("signer_cpf"),
  signatureKind: text("signature_kind", { enum: ["drawn", "typed"] }).notNull(),
  signatureImage: text("signature_image"),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  ip: inet("ip").notNull(),
  userAgent: text("user_agent").notNull(),
  contentSha256: text("content_sha256").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
});

export const documentAuditLog = pgTable(
  "document_audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clinicId: clinicId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    event: text("event", {
      enum: [
        "created",
        "sent",
        "link_opened",
        "signed",
        "declined",
        "pdf_generated",
        "resent",
        "expired",
      ],
    }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (t) => [index("document_audit_doc_idx2").on(t.documentId, t.createdAt)],
);
