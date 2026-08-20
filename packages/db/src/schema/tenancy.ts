import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true });

export const clinics = pgTable("clinics", {
  id: id(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  cnpj: text("cnpj"),
  phone: text("phone"),
  email: text("email"),
  addressStreet: text("address_street"),
  addressNumber: text("address_number"),
  addressComplement: text("address_complement"),
  addressDistrict: text("address_district"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  logoPath: text("logo_path"),
  businessHours: jsonb("business_hours").notNull().default({}),
  bookingSlug: text("booking_slug").unique(),
  onlineBookingEnabled: boolean("online_booking_enabled").notNull().default(false),
  anticipatesReceivables: boolean("anticipates_receivables").notNull().default(false),
  googleReviewUrl: text("google_review_url"),
  settings: jsonb("settings").notNull().default({}),
  plan: text("plan").notNull().default("trial"),
  status: text("status", { enum: ["active", "suspended", "cancelled"] })
    .notNull()
    .default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** GLOBAL (sem clinic_id): um usuário pode pertencer a N clínicas. */
export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(), // citext no banco (migração SQL)
  passwordHash: text("password_hash"),
  avatarPath: text("avatar_path"),
  phone: text("phone"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Recurso de agenda — nem toda profissional tem login. */
export const professionals = pgTable(
  "professionals",
  {
    id: id(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    name: text("name").notNull(),
    specialty: text("specialty"),
    registrationNumber: text("registration_number"),
    calendarColor: text("calendar_color").notNull().default("#0f766e"),
    worksHours: jsonb("works_hours"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("professionals_clinic_active_idx").on(t.clinicId, t.active)],
);

export const clinicMembers = pgTable(
  "clinic_members",
  {
    id: id(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", {
      enum: ["owner", "manager", "professional", "reception"],
    }).notNull(),
    professionalId: uuid("professional_id").references(() => professionals.id),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("clinic_members_clinic_user_uq").on(t.clinicId, t.userId),
    index("clinic_members_user_idx").on(t.userId),
  ],
);

export const rooms = pgTable("rooms", {
  id: id(),
  clinicId: uuid("clinic_id")
    .notNull()
    .references(() => clinics.id),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Sessões opacas: PK é o sha256 do token (o token em claro nunca é persistido). */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    activeClinicId: uuid("active_clinic_id").references(() => clinics.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);
