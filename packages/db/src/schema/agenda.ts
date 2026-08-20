import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { procedures } from "./catalog";
import { customers } from "./customers";
import { clinics, professionals, rooms, users } from "./tenancy";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const clinicId = () =>
  uuid("clinic_id")
    .notNull()
    .references(() => clinics.id);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id),
    roomId: uuid("room_id").references(() => rooms.id),
    procedureId: uuid("procedure_id").references(() => procedures.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status", {
      enum: ["scheduled", "confirmed", "showed", "no_show", "cancelled", "rescheduled"],
    })
      .notNull()
      .default("scheduled"),
    price: numeric("price", { precision: 12, scale: 2 }),
    isTouchup: boolean("is_touchup").notNull().default(false),
    parentAppointmentId: uuid("parent_appointment_id"),
    rescheduledToId: uuid("rescheduled_to_id"),
    origin: text("origin", {
      enum: ["manual", "online_booking", "automation", "ai_agent", "reschedule"],
    })
      .notNull()
      .default("manual"),
    /** Sessão coberta por pacote (sem conta a receber; debita sessão no Compareceu). */
    customerPackageId: uuid("customer_package_id"),
    allowOverlap: boolean("allow_overlap").notNull().default(false),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [
    index("appointments_clinic_starts_idx2").on(t.clinicId, t.startsAt),
    index("appointments_clinic_customer_idx2").on(t.clinicId, t.customerId, t.startsAt),
  ],
);

export const appointmentStatusHistory = pgTable(
  "appointment_status_history",
  {
    id: id(),
    clinicId: clinicId(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    source: text("source", {
      enum: ["user", "customer_whatsapp", "ai_agent", "automation", "system"],
    })
      .notNull()
      .default("user"),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("appointment_status_history_appt_idx2").on(t.appointmentId)],
);

export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: id(),
    clinicId: clinicId(),
    /** NULL = clínica inteira. */
    professionalId: uuid("professional_id").references(() => professionals.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("schedule_blocks_clinic_starts_idx2").on(t.clinicId, t.startsAt)],
);
