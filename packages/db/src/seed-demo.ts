import { randomUUID } from "node:crypto";
import { AESTHETIC_ANAMNESIS_V1 } from "@clinicaos/core/anamnesis";
import { addDaysISO, todayISO, zonedToUtc } from "@clinicaos/core/timezone";
import argon2 from "argon2";
import { config as loadEnv } from "dotenv";
import { and, eq, sql as sqlRaw } from "drizzle-orm";
import { closeDb, unsafeGlobalDb, withContext, withTenant } from "./client";
import {
  anamnesisTemplates,
  anamnesisTemplateVersions,
  appointments,
  clinicMembers,
  clinics,
  customerHistoryEntries,
  customers,
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

  // ── Anamnese: modelo seed ─────────────────────────────────────────
  await withTenant(finalClinicId, async (tx) => {
    const templateName = "Clínica de Estética";
    const existing = await tx
      .select({ id: anamnesisTemplates.id })
      .from(anamnesisTemplates)
      .where(eq(anamnesisTemplates.name, templateName))
      .limit(1);
    if (existing.length === 0) {
      const [template] = await tx
        .insert(anamnesisTemplates)
        .values({ clinicId: finalClinicId, name: templateName })
        .returning({ id: anamnesisTemplates.id });
      if (template) {
        await tx.insert(anamnesisTemplateVersions).values({
          clinicId: finalClinicId,
          templateId: template.id,
          version: 1,
          schema: AESTHETIC_ANAMNESIS_V1,
        });
        console.log(`Criado modelo de anamnese: ${templateName} (v1)`);
      }
    }
  });

  // ── Clientes demo (exercitam filtros, histórico e reativação) ─────
  await withTenant(finalClinicId, async (tx) => {
    const procs = await tx
      .select({ id: procedures.id, name: procedures.name })
      .from(procedures);
    const procId = (name: string) => procs.find((p) => p.name === name)?.id ?? null;

    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };

    const demoCustomers: {
      fullName: string;
      phone: string;
      birthDate?: string;
      status: "lead" | "active";
      history: { daysAgo: number; procedure: string; amount: string }[];
    }[] = [
      {
        fullName: "Maria Silva",
        phone: "+5511988620001",
        birthDate: "1990-05-10",
        status: "active",
        history: [
          { daysAgo: 20, procedure: "Limpeza de Pele", amount: "180.00" },
          { daysAgo: 50, procedure: "Limpeza de Pele", amount: "180.00" },
        ],
      },
      {
        fullName: "Edson Neto",
        phone: "+5511988620002",
        birthDate: "1985-11-22",
        status: "active",
        history: [
          { daysAgo: 130, procedure: "Botox", amount: "1200.00" },
          { daysAgo: 260, procedure: "Botox", amount: "1200.00" },
        ],
      },
      {
        fullName: "Juliana Costa",
        phone: "+5511988620003",
        status: "lead",
        history: [],
      },
    ];

    for (const demo of demoCustomers) {
      const exists = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.phoneE164, demo.phone))
        .limit(1);
      if (exists.length > 0) continue;

      const [created] = await tx
        .insert(customers)
        .values({
          clinicId: finalClinicId,
          fullName: demo.fullName,
          phoneE164: demo.phone,
          birthDate: demo.birthDate,
          status: demo.status,
          source: "seed",
        })
        .returning({ id: customers.id });
      if (!created) continue;

      for (const h of demo.history) {
        await tx.insert(customerHistoryEntries).values({
          clinicId: finalClinicId,
          customerId: created.id,
          occurredOn: daysAgo(h.daysAgo),
          procedureId: procId(h.procedure),
          procedureName: procId(h.procedure) ? null : h.procedure,
          amount: h.amount,
          createdBy: ownerId,
        });
      }
      console.log(`Criada cliente demo: ${demo.fullName}`);
    }
  });

  // ── Agendamentos demo (hoje e amanhã, no fuso da clínica) ─────────
  await withTenant(finalClinicId, async (tx) => {
    const existing = await tx.select({ id: appointments.id }).from(appointments).limit(1);
    if (existing.length > 0) return;

    const tz = "America/Sao_Paulo";
    const hoje = todayISO(tz);
    const amanha = addDaysISO(hoje, 1);

    const custs = await tx
      .select({ id: customers.id, name: customers.fullName })
      .from(customers);
    const profs = await tx
      .select({ id: professionals.id, name: professionals.name })
      .from(professionals);
    const procs = await tx
      .select({
        id: procedures.id,
        name: procedures.name,
        duration: procedures.durationMinutes,
        price: procedures.price,
      })
      .from(procedures);

    const byName = <T extends { name: string }>(arr: T[], name: string) =>
      arr.find((x) => x.name.includes(name));

    const maria = byName(custs, "Maria");
    const edson = byName(custs, "Edson");
    const paula = byName(profs, "Paula");
    const carla = byName(profs, "Carla");
    const limpeza = byName(procs, "Limpeza");
    const botox = byName(procs, "Botox");
    const drenagem = byName(procs, "Drenagem");
    if (!maria || !edson || !paula || !carla || !limpeza || !botox || !drenagem) return;

    const mk = (
      customerId: string,
      professionalId: string,
      proc: { id: string; duration: number; price: string },
      dateISO: string,
      time: string,
      status: "scheduled" | "confirmed",
    ) => {
      const startsAt = zonedToUtc(dateISO, time, tz);
      return {
        clinicId: finalClinicId,
        customerId,
        professionalId,
        procedureId: proc.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + proc.duration * 60_000),
        price: proc.price,
        status,
      };
    };

    await tx.insert(appointments).values([
      mk(edson.id, paula.id, botox, hoje, "10:00", "confirmed"),
      mk(maria.id, paula.id, limpeza, hoje, "14:00", "scheduled"),
      mk(maria.id, carla.id, drenagem, amanha, "11:00", "scheduled"),
    ]);
    console.log("Criados agendamentos demo (hoje 10h/14h, amanhã 11h).");
  });

  // ── Automações: liga as cadências de confirmação (modo supervisionado) ──
  await withTenant(finalClinicId, async (tx) => {
    for (const automationId of ["reminder_24h", "confirm_2h"]) {
      await tx.execute(sqlRaw`
        INSERT INTO automation_settings (clinic_id, automation_id, enabled, requires_approval)
        VALUES (${finalClinicId}, ${automationId}, true, true)
        ON CONFLICT (clinic_id, automation_id) DO NOTHING
      `);
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
