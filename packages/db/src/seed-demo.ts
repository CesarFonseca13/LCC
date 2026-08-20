import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { closeDb, unsafeGlobalDb, withContext, withTenant } from "./client";
import {
  clinicMembers,
  clinics,
  packageItems,
  packages,
  procedures,
  professionals,
  rooms,
  users,
} from "./schema";

loadEnv({ path: "../../.env" });

/**
 * Seed de demonstração/desenvolvimento — idempotente por entidade (pode rodar sempre).
 * Cria/garante: Clínica Demo, dona (dona@clinicademo.com.br / demo1234),
 * profissionais, salas e um catálogo que exercita as automações
 * (procedimento com retorno, com retoque e pacote de sessões).
 */
const OWNER_EMAIL = "dona@clinicademo.com.br";
const OWNER_PASSWORD = "demo1234";

async function main() {
  const db = unsafeGlobalDb();

  // ── Usuária dona ──────────────────────────────────────────────────
  let owner = (await db.select().from(users).where(eq(users.email, OWNER_EMAIL)))[0];
  if (!owner) {
    const passwordHash = await argon2.hash(OWNER_PASSWORD);
    owner = (
      await db
        .insert(users)
        .values({ name: "Fernanda Souza", email: OWNER_EMAIL, passwordHash })
        .returning()
    )[0];
    console.log("Criada usuária dona.");
  }
  if (!owner) throw new Error("Falha ao garantir usuária dona.");
  const ownerId = owner.id;

  // ── Clínica + vínculo ─────────────────────────────────────────────
  const membership = await withContext({ userId: ownerId }, (tx) =>
    tx
      .select({ clinicId: clinicMembers.clinicId })
      .from(clinicMembers)
      .where(and(eq(clinicMembers.userId, ownerId), eq(clinicMembers.active, true)))
      .limit(1),
  );

  let clinicId = membership[0]?.clinicId;
  if (!clinicId) {
    clinicId = randomUUID();
    const newClinicId = clinicId;
    await withTenant(newClinicId, async (tx) => {
      await tx.insert(clinics).values({
        id: newClinicId,
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
      const [dra] = await tx
        .insert(professionals)
        .values([
          {
            clinicId: newClinicId,
            name: "Dra. Paula Lima",
            specialty: "Biomedicina estética",
            calendarColor: "#0f766e",
          },
          {
            clinicId: newClinicId,
            name: "Carla Mendes",
            specialty: "Esteticista",
            calendarColor: "#7c3aed",
          },
        ])
        .returning();
      await tx.insert(rooms).values([
        { clinicId: newClinicId, name: "Sala 1" },
        { clinicId: newClinicId, name: "Sala 2" },
      ]);
      await tx.insert(clinicMembers).values({
        clinicId: newClinicId,
        userId: ownerId,
        role: "owner",
        professionalId: dra?.id,
      });
    });
    console.log("Criada Clínica Demo com profissionais e salas.");
  }

  // ── Catálogo (exercita as automações) ─────────────────────────────
  const finalClinicId = clinicId;
  await withTenant(finalClinicId, async (tx) => {
    const wanted = [
      {
        name: "Limpeza de Pele",
        category: "Facial",
        durationMinutes: 60,
        price: "180.00",
        returnDays: 30,
        preCare: "Evite ácidos na pele nas 48h anteriores.",
        postCare: "Evite sol e maquiagem nas próximas 24h.",
        commissionDefaultPct: "30.00",
      },
      {
        name: "Botox",
        category: "Harmonização",
        durationMinutes: 30,
        price: "1200.00",
        returnDays: 120,
        touchupDays: 15,
        preCare: "Evite álcool e anti-inflamatórios 24h antes.",
        postCare: "Não deite nem massageie a região nas próximas 4h.",
        commissionDefaultPct: "20.00",
      },
      {
        name: "Drenagem Linfática",
        category: "Corporal",
        durationMinutes: 50,
        price: "150.00",
        returnDays: 15,
        commissionDefaultPct: "35.00",
      },
    ];

    const existing = await tx
      .select({ id: procedures.id, name: procedures.name })
      .from(procedures);
    const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));

    for (const proc of wanted) {
      if (!byName.has(proc.name.toLowerCase())) {
        const [created] = await tx
          .insert(procedures)
          .values({ clinicId: finalClinicId, ...proc })
          .returning({ id: procedures.id });
        if (created) byName.set(proc.name.toLowerCase(), created.id);
        console.log(`Criado procedimento: ${proc.name}`);
      }
    }

    const pkgName = "Drenagem — 12 sessões";
    const pkgExists = await tx
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.name, pkgName))
      .limit(1);
    const drenagemId = byName.get("drenagem linfática");
    if (pkgExists.length === 0 && drenagemId) {
      const [pkg] = await tx
        .insert(packages)
        .values({
          clinicId: finalClinicId,
          name: pkgName,
          price: "1500.00",
          validityDays: 180,
        })
        .returning({ id: packages.id });
      if (pkg) {
        await tx.insert(packageItems).values({
          clinicId: finalClinicId,
          packageId: pkg.id,
          procedureId: drenagemId,
          sessions: 12,
        });
        console.log(`Criado pacote: ${pkgName}`);
      }
    }
  });

  console.log("Seed em dia:");
  console.log(`  Clínica: ${finalClinicId}`);
  console.log(`  Login:   ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
