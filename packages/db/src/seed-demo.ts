import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { closeDb, unsafeGlobalDb, withTenant } from "./client";
import { clinicMembers, clinics, professionals, rooms, users } from "./schema";

loadEnv({ path: "../../.env" });

/**
 * Seed de demonstração/desenvolvimento — idempotente.
 * Cria: Clínica Demo, dona (login dona@clinicademo.com.br / demo1234),
 * 2 profissionais e 2 salas. Usada em dev, CI e demos de venda.
 */
const OWNER_EMAIL = "dona@clinicademo.com.br";
const OWNER_PASSWORD = "demo1234";

async function main() {
  const db = unsafeGlobalDb();

  const existing = await db.select().from(users).where(eq(users.email, OWNER_EMAIL));
  if (existing.length > 0) {
    console.log(`Seed já aplicado (${OWNER_EMAIL} existe). Nada a fazer.`);
    return;
  }

  const passwordHash = await argon2.hash(OWNER_PASSWORD);
  const [owner] = await db
    .insert(users)
    .values({ name: "Fernanda Souza", email: OWNER_EMAIL, passwordHash })
    .returning();
  if (!owner) throw new Error("Falha ao criar usuária dona.");

  const clinicId = randomUUID();
  await withTenant(clinicId, async (tx) => {
    await tx.insert(clinics).values({
      id: clinicId,
      name: "Clínica Demo",
      phone: "+5511999990000",
      email: "contato@clinicademo.com.br",
      addressCity: "São Paulo",
      addressState: "SP",
      businessHours: {
        mon: [["08:00", "19:00"]],
        tue: [["08:00", "19:00"]],
        wed: [["08:00", "19:00"]],
        thu: [["08:00", "19:00"]],
        fri: [["08:00", "19:00"]],
        sat: [["09:00", "14:00"]],
      },
    });

    const [dra, esteticista] = await tx
      .insert(professionals)
      .values([
        {
          clinicId,
          name: "Dra. Paula Lima",
          specialty: "Biomedicina estética",
          calendarColor: "#0f766e",
        },
        {
          clinicId,
          name: "Carla Mendes",
          specialty: "Esteticista",
          calendarColor: "#7c3aed",
        },
      ])
      .returning();

    await tx.insert(rooms).values([
      { clinicId, name: "Sala 1" },
      { clinicId, name: "Sala 2" },
    ]);

    await tx.insert(clinicMembers).values({
      clinicId,
      userId: owner.id,
      role: "owner",
      professionalId: dra?.id,
    });

    void esteticista;
  });

  console.log("Seed aplicado:");
  console.log(`  Clínica: Clínica Demo (${clinicId})`);
  console.log(`  Login:   ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
