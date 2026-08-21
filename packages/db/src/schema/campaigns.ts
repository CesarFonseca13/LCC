import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
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

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    clinicId: clinicId(),
    name: text("name").notNull(),
    messageTemplate: text("message_template").notNull(),
    segment: jsonb("segment").notNull().default({}),
    status: text("status", { enum: ["draft", "running", "paused", "done", "cancelled"] })
      .notNull()
      .default("draft"),
    dailyCap: integer("daily_cap").notNull().default(30),
    recipientCount: integer("recipient_count"),
    /** Ritmo anti-ban: próximo envio só depois deste instante. */
    nextSendAt: timestamp("next_send_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("campaigns_clinic_status_idx").on(t.clinicId, t.status)],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: id(),
    clinicId: clinicId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "sent", "skipped"] })
      .notNull()
      .default("pending"),
    messageId: uuid("message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    skipReason: text("skip_reason"),
  },
  (t) => [unique("campaign_recipients_uq").on(t.campaignId, t.customerId)],
);
