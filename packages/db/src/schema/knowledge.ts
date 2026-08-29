import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clinics, users } from "./tenancy";

/** Base de conhecimento: cards curtos e curados que a assistente consulta
 *  para responder perguntas factuais sem inventar. A coluna `search`
 *  (tsvector em português) é gerada pelo Postgres — não é escrita pelo app. */
export const kbEntries = pgTable(
  "kb_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    kind: text("kind", { enum: ["faq", "servico", "politica", "outro"] })
      .notNull()
      .default("faq"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("kb_entries_clinic_idx").on(t.clinicId, t.active)],
);
