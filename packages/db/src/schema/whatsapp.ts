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
import { customers } from "./customers";
import { clinics, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);

export const whatsappInstances = pgTable(
  "whatsapp_instances",
  {
    id: id(),
    clinicId: clinicId(),
    evolutionInstanceName: text("evolution_instance_name").notNull().unique(),
    label: text("label"),
    phoneE164: text("phone_e164"),
    isPrimary: boolean("is_primary").notNull().default(true),
    status: text("status", {
      enum: ["created", "qr_pending", "connecting", "connected", "disconnected", "banned"],
    })
      .notNull()
      .default("disconnected"),
    webhookToken: text("webhook_token").notNull(),
    qrCode: text("qr_code"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastDisconnectAt: timestamp("last_disconnect_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("whatsapp_instances_clinic_idx2").on(t.clinicId)],
);

export const whatsappEvents = pgTable(
  "whatsapp_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => whatsappInstances.id, { onDelete: "cascade" }),
    clinicId: clinicId(),
    eventType: text("event_type").notNull(),
    waMessageId: text("wa_message_id"),
    payload: jsonb("payload").notNull(),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    clinicId: clinicId(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => whatsappInstances.id),
    remoteJid: text("remote_jid").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    mode: text("mode", { enum: ["ai", "human", "waiting_human"] })
      .notNull()
      .default("ai"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    aiContextSummary: text("ai_context_summary"),
    /** Debounce da IA: turno processa quando now() >= ai_turn_after (Postgres é a verdade). */
    aiTurnAfter: timestamp("ai_turn_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [
    unique("conversations_instance_jid_uq").on(t.instanceId, t.remoteJid),
    index("conversations_clinic_last_idx2").on(t.clinicId, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    clinicId: clinicId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    author: text("author", { enum: ["customer", "ai", "human", "automation"] }).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id),
    waMessageId: text("wa_message_id"),
    type: text("type", {
      enum: ["text", "image", "audio", "video", "document", "sticker", "location", "other"],
    })
      .notNull()
      .default("text"),
    body: text("body"),
    mediaPath: text("media_path"),
    status: text("status", {
      enum: [
        "received",
        "queued",
        "pending_approval",
        "sending",
        "sent",
        "delivered",
        "read",
        "failed",
        "rejected",
        "expired",
      ],
    }).notNull(),
    automationId: text("automation_id"),
    automationRunId: uuid("automation_run_id"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx2").on(t.clinicId, t.conversationId, t.createdAt)],
);
