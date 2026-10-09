/**
 * Seed de DEMONSTRAÇÃO COMPLETA — uma clínica "com 6 meses de casa".
 *
 * Diferente do `seed-demo.ts` (que garante só o mínimo para a clínica
 * funcionar), este script preenche a conta inteira como se ela estivesse
 * em operação real desde há meio ano: catálogo, equipe, estoque com
 * movimentação, 6 meses de agenda, financeiro fechado mês a mês,
 * comissões pagas, orçamentos, funil, campanhas, conversas de WhatsApp,
 * termos assinados, automações rodando e o modelo de IA já configurado.
 *
 * Serve para apresentar a plataforma ao cliente com a casa cheia.
 *
 *   pnpm --filter @clinicaos/db exec tsx src/seed-showcase.ts
 *
 * Variáveis (todas opcionais — sem alvo, o script LISTA as contas):
 *   SHOWCASE_CLINIC          nome (ou parte) da clínica alvo
 *   SHOWCASE_OWNER_EMAIL     e-mail da dona (alternativa ao nome)
 *   SHOWCASE_CREATE=1        cria a clínica se ela não existir
 *   SHOWCASE_OWNER_PASSWORD  senha da dona quando cria (default demo1234)
 *   SHOWCASE_RESET=1         limpa os dados da clínica antes de semear
 *   SHOWCASE_AI_FROM         nome/e-mail da clínica de onde COPIAR a
 *                            configuração de IA (a chave viaja cifrada —
 *                            o script nunca precisa dela em claro)
 *   SHOWCASE_OPENAI_KEY      alternativa: cola a chave da OpenAI direto
 *   SHOWCASE_AI_AGENT_MODEL / SHOWCASE_AI_CLASSIFIER_MODEL
 *   SHOWCASE_SEED            semente do gerador (default 20260828)
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  AESTHETIC_ANAMNESIS_V1,
  computeRiskSummary,
  type AnamnesisAnswers,
} from "@clinicaos/core/anamnesis";
import { encryptSensitive } from "@clinicaos/core/crypto";
import {
  DEFAULT_CONSENT_TEMPLATE,
  renderTermHtml,
  sha256Hex,
} from "@clinicaos/core/documents";
import { extractVariables } from "@clinicaos/core/template-render";
import { addDaysISO, todayISO, zonedToUtc } from "@clinicaos/core/timezone";
import argon2 from "argon2";
import { config as loadEnv } from "dotenv";
import { and, eq, sql as sqlRaw } from "drizzle-orm";
import { closeDb, unsafeGlobalDb, withContext, withTenant, type Tx } from "./client";
import { recomputeScores } from "./scoring";
import * as schema from "./schema";

loadEnv({ path: "../../.env" });
loadEnv({ path: "../../infra/.env" });

const TZ = "America/Sao_Paulo";
const DAYS_BACK = 183;
const DAYS_AHEAD = 24;

// ── Gerador determinístico ───────────────────────────────────────────
// Mesma semente = mesma demo. Poder repetir a apresentação com os mesmos
// números vale mais do que a variedade de um Math.random().
let rngState = Number(process.env.SHOWCASE_SEED || 20260828) >>> 0;
function rnd(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const chance = (p: number) => rnd() < p;
function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ── Datas (sempre no fuso da clínica) ────────────────────────────────
const TODAY = todayISO(TZ);
const daysAgo = (n: number) => addDaysISO(TODAY, -n);
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const monthOf = (iso: string) => iso.slice(0, 7);
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const money = (n: number) => n.toFixed(2);
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const token = () => randomBytes(24).toString("base64url");
const firstName = (n: string) => n.split(" ")[0]!;

/** Insere em lotes — Postgres tem teto de parâmetros por statement. */
// biome-ignore lint/suspicious/noExplicitAny: helper genérico de inserção
type AnyTable = any;
async function insertMany(
  tx: Tx,
  table: AnyTable,
  rows: readonly unknown[],
  size = 250,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await tx.insert(table).values(rows.slice(i, i + size) as never);
  }
}

const log = (msg: string) => console.log(`  ${msg}`);

// ═══════════════════════════════════════════════════════════════════
// 1. Alvo: em qual conta a demo vai entrar
// ═══════════════════════════════════════════════════════════════════

interface Account {
  clinicId: string;
  clinicName: string;
  userId: string;
  userName: string;
  email: string;
}

/** Contas dona/gestora visíveis — sem BYPASSRLS, resolvidas usuário a usuário. */
async function listAccounts(): Promise<Account[]> {
  const db = unsafeGlobalDb();
  const allUsers = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users);
  const out: Account[] = [];
  for (const u of allUsers) {
    const rows = await withContext({ userId: u.id }, (tx) =>
      tx
        .select({
          clinicId: schema.clinicMembers.clinicId,
          role: schema.clinicMembers.role,
          clinicName: schema.clinics.name,
        })
        .from(schema.clinicMembers)
        .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicMembers.clinicId))
        .where(
          and(eq(schema.clinicMembers.userId, u.id), eq(schema.clinicMembers.active, true)),
        ),
    );
    for (const r of rows) {
      if (r.role !== "owner" && r.role !== "manager") continue;
      out.push({
        clinicId: r.clinicId,
        clinicName: r.clinicName,
        userId: u.id,
        userName: u.name,
        email: u.email,
      });
    }
  }
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

function matchAccount(accounts: Account[], needle: string): Account | undefined {
  const n = norm(needle);
  return (
    accounts.find((a) => norm(a.email) === n) ??
    accounts.find((a) => norm(a.clinicName) === n) ??
    accounts.find((a) => norm(a.clinicName).includes(n)) ??
    accounts.find((a) => norm(a.email).includes(n))
  );
}

function printAccounts(accounts: Account[]): void {
  console.log("\nContas neste banco:\n");
  for (const a of accounts) {
    console.log(`  • ${a.clinicName}`);
    console.log(`    dona/gestora: ${a.userName} <${a.email}>`);
    console.log(`    clinic_id:    ${a.clinicId}\n`);
  }
  console.log("Rode de novo apontando o alvo. Exemplo:\n");
  console.log(`  SHOWCASE_CLINIC="${accounts[0]?.clinicName ?? "Nome da Clínica"}" \\`);
  console.log(`  SHOWCASE_AI_FROM="${accounts[1]?.clinicName ?? "Outra Clínica"}" \\`);
  console.log("  SHOWCASE_RESET=1 tsx src/seed-showcase.ts\n");
}

async function createAccount(): Promise<Account> {
  const name = process.env.SHOWCASE_CLINIC || "Clínica Demo";
  const email = process.env.SHOWCASE_OWNER_EMAIL || "demo@clinicaos.com.br";
  const password = process.env.SHOWCASE_OWNER_PASSWORD || "demo1234";
  const ownerName = process.env.SHOWCASE_OWNER_NAME || "Fernanda Souza";
  const db = unsafeGlobalDb();

  let user = (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
  if (!user) {
    user = (
      await db
        .insert(schema.users)
        .values({ name: ownerName, email, passwordHash: await argon2.hash(password) })
        .returning()
    )[0]!;
  }
  const clinicId = randomUUID();
  const userId = user.id;
  await withTenant(clinicId, async (tx) => {
    await tx.insert(schema.clinics).values({ id: clinicId, name });
    await tx.insert(schema.clinicMembers).values({ clinicId, userId, role: "owner" });
  });
  log(`Conta criada: ${name} — ${email} / ${password}`);
  return { clinicId, clinicName: name, userId, userName: user.name, email };
}

/**
 * Limpa os dados de tenant da clínica alvo (a clínica e os logins ficam).
 * Só roda com SHOWCASE_RESET=1 e sempre restrito a UMA clinic_id.
 */
async function resetClinic(clinicId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clinicId)) {
    throw new Error("clinic_id inválido — reset abortado.");
  }
  // Ordem = folhas antes das raízes; quem manda aqui é a FK.
  const tables = [
    "package_session_uses",
    "commission_entries",
    "commission_payments",
    "commission_rules",
    "receivables",
    "payables",
    "stock_movements",
    "procedure_supplies",
    "stock_items",
    "quote_items",
    "quotes",
    "clinic_counters",
    "campaign_recipients",
    "campaigns",
    "deals",
    "pipeline_stages",
    "document_audit_log",
    "document_signatures",
    "documents",
    "document_templates",
    "approvals",
    "automation_log",
    "automation_runs",
    "automation_settings",
    "messages",
    "conversations",
    "whatsapp_events",
    "whatsapp_instances",
    "customer_scores",
    "anamnesis_responses",
    "anamnesis_template_versions",
    "anamnesis_templates",
    "appointment_status_history",
    "appointments",
    "customer_packages",
    "package_items",
    "packages",
    "customer_history_entries",
    "customer_tags",
    "tags",
    "customer_phones",
    "customers",
    "procedures",
    "finance_categories",
    "schedule_blocks",
    "notifications",
    "audit_log",
    "ai_usage",
    "rooms",
  ];
  await withTenant(clinicId, async (tx) => {
    for (const t of tables) {
      await tx.execute(sqlRaw.raw(`DELETE FROM ${t} WHERE clinic_id = '${clinicId}'`));
    }
    await tx.execute(
      sqlRaw`UPDATE clinic_members SET professional_id = NULL WHERE clinic_id = ${clinicId}`,
    );
    await tx.execute(sqlRaw`DELETE FROM professionals WHERE clinic_id = ${clinicId}`);
  });
  log("Dados anteriores da clínica limpos.");
}

// ═══════════════════════════════════════════════════════════════════
// 2. Configuração de IA (copiada de outra conta ou colada)
// ═══════════════════════════════════════════════════════════════════

interface AiProviderBlock {
  mode: "custom";
  provider: "openai" | "anthropic";
  apiKeyEnc: string | null;
  keyHint: string | null;
  baseURL: string | null;
  agentModel: string | null;
  classifierModel: string | null;
}

/** Lê o bloco aiProvider de outra clínica — a chave continua cifrada. */
async function readAiProviderFrom(clinicId: string): Promise<AiProviderBlock | null> {
  const rows = await withTenant(clinicId, (tx) =>
    tx.execute(sqlRaw`SELECT settings -> 'aiProvider' AS p FROM clinics WHERE id = ${clinicId}`),
  );
  const raw = (rows.rows[0] as { p: unknown } | undefined)?.p as
    | Record<string, unknown>
    | null
    | undefined;
  if (!raw || typeof raw !== "object") return null;
  if (raw.mode !== "custom") return null;
  return {
    mode: "custom",
    provider: raw.provider === "anthropic" ? "anthropic" : "openai",
    apiKeyEnc: typeof raw.apiKeyEnc === "string" ? raw.apiKeyEnc : null,
    keyHint: typeof raw.keyHint === "string" ? raw.keyHint : null,
    baseURL: typeof raw.baseURL === "string" ? raw.baseURL : null,
    agentModel: typeof raw.agentModel === "string" ? raw.agentModel : null,
    classifierModel: typeof raw.classifierModel === "string" ? raw.classifierModel : null,
  };
}

function aiProviderFromKey(key: string): AiProviderBlock {
  const sensitive = process.env.SENSITIVE_DATA_KEY;
  if (!sensitive) throw new Error("SENSITIVE_DATA_KEY não definida — não dá para cifrar a chave.");
  return {
    mode: "custom",
    provider: "openai",
    apiKeyEnc: encryptSensitive(key, sensitive),
    keyHint: key.slice(-4),
    baseURL: process.env.SHOWCASE_AI_BASE_URL || "https://api.openai.com/v1",
    agentModel: process.env.SHOWCASE_AI_AGENT_MODEL || "gpt-4o",
    classifierModel: process.env.SHOWCASE_AI_CLASSIFIER_MODEL || "gpt-4o-mini",
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Dados de catálogo, equipe e estoque
// ═══════════════════════════════════════════════════════════════════

const PROFESSIONALS = [
  {
    name: "Dra. Renata Alencar",
    specialty: "Biomedicina estética",
    registration: "CRBM 18.442",
    color: "#0f766e",
    commissionPct: 25,
  },
  {
    name: "Camila Duarte",
    specialty: "Esteticista facial",
    registration: null,
    color: "#7c3aed",
    commissionPct: 30,
  },
  {
    name: "Bruna Salles",
    specialty: "Terapeuta corporal",
    registration: null,
    color: "#be123c",
    commissionPct: 35,
  },
  {
    name: "Marina Prado",
    specialty: "Esteticista",
    registration: null,
    color: "#b45309",
    commissionPct: 30,
  },
] as const;

const ROOMS = ["Sala Jade", "Sala Âmbar", "Sala Coral", "Sala Ônix"] as const;

interface ProcSpec {
  name: string;
  category: string;
  durationMinutes: number;
  price: number;
  cost: number;
  returnDays: number;
  touchupDays?: number;
  commissionDefaultPct: number;
  preCare?: string;
  postCare?: string;
  postSaleCadenceDays?: number[];
  /** Índices em PROFESSIONALS que executam o procedimento. */
  pros: number[];
}

const PROCEDURES: ProcSpec[] = [
  {
    name: "Limpeza de Pele Profunda",
    category: "Facial",
    durationMinutes: 60,
    price: 220,
    cost: 38,
    returnDays: 30,
    commissionDefaultPct: 30,
    preCare: "Evite ácidos e esfoliantes nas 48h anteriores e venha sem maquiagem.",
    postCare: "Sem sol, academia e maquiagem por 24h. Protetor solar sempre que sair.",
    postSaleCadenceDays: [7, 25],
    pros: [1, 3],
  },
  {
    name: "Peeling de Diamante",
    category: "Facial",
    durationMinutes: 45,
    price: 190,
    cost: 30,
    returnDays: 30,
    commissionDefaultPct: 30,
    preCare: "Suspenda ácidos 5 dias antes.",
    postCare: "Hidratação reforçada e protetor solar FPS 50 por 7 dias.",
    pros: [1, 3],
  },
  {
    name: "Hidratação Facial Intensiva",
    category: "Facial",
    durationMinutes: 40,
    price: 160,
    cost: 26,
    returnDays: 30,
    commissionDefaultPct: 30,
    postCare: "Pode voltar à rotina normal. Beba bastante água hoje.",
    pros: [1, 3],
  },
  {
    name: "Microagulhamento Facial",
    category: "Facial",
    durationMinutes: 60,
    price: 450,
    cost: 95,
    returnDays: 45,
    commissionDefaultPct: 25,
    preCare: "Nada de ácidos por 7 dias e nenhuma exposição solar por 3 dias.",
    postCare: "Vermelhidão por 48h é esperada. Só água termal e protetor por 5 dias.",
    postSaleCadenceDays: [3, 20],
    pros: [0, 1],
  },
  {
    name: "Skinbooster",
    category: "Facial",
    durationMinutes: 50,
    price: 890,
    cost: 240,
    returnDays: 180,
    commissionDefaultPct: 20,
    preCare: "Evite anti-inflamatórios e álcool 24h antes.",
    postCare: "Pequenos pontinhos somem em 24-48h. Não massageie a região hoje.",
    pros: [0],
  },
  {
    name: "Toxina Botulínica",
    category: "Harmonização",
    durationMinutes: 40,
    price: 1290,
    cost: 320,
    returnDays: 150,
    touchupDays: 15,
    commissionDefaultPct: 20,
    preCare: "Sem álcool e sem anti-inflamatórios nas 24h anteriores.",
    postCare: "Não deite nem massageie a região por 4h. Sem academia hoje.",
    postSaleCadenceDays: [2, 15],
    pros: [0],
  },
  {
    name: "Preenchimento Labial",
    category: "Harmonização",
    durationMinutes: 60,
    price: 1690,
    cost: 430,
    returnDays: 300,
    touchupDays: 20,
    commissionDefaultPct: 20,
    preCare: "Evite álcool 24h antes. Avise se tiver histórico de herpes labial.",
    postCare: "Gelo intermitente por 24h. Inchaço nos 3 primeiros dias é normal.",
    postSaleCadenceDays: [3, 18],
    pros: [0],
  },
  {
    name: "Bioestimulador de Colágeno",
    category: "Harmonização",
    durationMinutes: 60,
    price: 2200,
    cost: 620,
    returnDays: 240,
    commissionDefaultPct: 18,
    preCare: "Hidrate-se bem no dia anterior e evite álcool.",
    postCare: "Massagem 5x ao dia por 5 dias, conforme orientação da profissional.",
    pros: [0],
  },
  {
    name: "Fios de PDO",
    category: "Harmonização",
    durationMinutes: 90,
    price: 2800,
    cost: 780,
    returnDays: 365,
    commissionDefaultPct: 18,
    preCare: "Suspenda anticoagulantes conforme orientação médica e evite álcool 48h antes.",
    postCare: "Durma de barriga para cima por 7 dias. Nada de mastigar alimentos duros.",
    pros: [0],
  },
  {
    name: "Drenagem Linfática",
    category: "Corporal",
    durationMinutes: 50,
    price: 170,
    cost: 18,
    returnDays: 15,
    commissionDefaultPct: 35,
    postCare: "Beba 2L de água hoje e evite sal em excesso.",
    pros: [2, 3],
  },
  {
    name: "Massagem Modeladora",
    category: "Corporal",
    durationMinutes: 60,
    price: 190,
    cost: 20,
    returnDays: 15,
    commissionDefaultPct: 35,
    postCare: "Hidrate-se bem. Pequenos hematomas podem aparecer e somem em dias.",
    pros: [2, 3],
  },
  {
    name: "Radiofrequência Corporal",
    category: "Corporal",
    durationMinutes: 50,
    price: 260,
    cost: 22,
    returnDays: 21,
    commissionDefaultPct: 30,
    postCare: "Beba bastante água nas 48h seguintes.",
    pros: [2, 3],
  },
  {
    name: "Criolipólise",
    category: "Corporal",
    durationMinutes: 90,
    price: 690,
    cost: 130,
    returnDays: 60,
    commissionDefaultPct: 25,
    preCare: "Faça uma refeição leve antes da sessão.",
    postCare: "Massageie a área por 5 minutos, 2x ao dia, na primeira semana.",
    postSaleCadenceDays: [10, 40],
    pros: [2],
  },
  {
    name: "Depilação a Laser — Axilas",
    category: "Corporal",
    durationMinutes: 20,
    price: 130,
    cost: 8,
    returnDays: 30,
    commissionDefaultPct: 30,
    preCare: "Venha com a área raspada e sem sol nos 15 dias anteriores.",
    postCare: "Sem sol, sauna e desodorante por 48h.",
    pros: [2, 3],
  },
  {
    name: "Microagulhamento Capilar",
    category: "Capilar",
    durationMinutes: 50,
    price: 390,
    cost: 85,
    returnDays: 30,
    commissionDefaultPct: 25,
    postCare: "Não lave o cabelo nas próximas 12h.",
    pros: [1],
  },
];

interface PkgSpec {
  name: string;
  price: number;
  validityDays: number;
  procIdx: number;
  sessions: number;
}

const PACKAGES: PkgSpec[] = [
  { name: "Drenagem — 10 sessões", price: 1450, validityDays: 180, procIdx: 9, sessions: 10 },
  { name: "Modeladora — 10 sessões", price: 1650, validityDays: 180, procIdx: 10, sessions: 10 },
  { name: "Limpeza de Pele — 6 sessões", price: 1150, validityDays: 240, procIdx: 0, sessions: 6 },
  { name: "Radiofrequência — 8 sessões", price: 1780, validityDays: 180, procIdx: 11, sessions: 8 },
  { name: "Laser Axilas — 8 sessões", price: 850, validityDays: 365, procIdx: 13, sessions: 8 },
];

interface StockSpec {
  name: string;
  unit: string;
  cost: number;
  minQuantity: number;
  /** Consumo por sessão, por índice de procedimento. */
  usedBy: Array<[procIdx: number, qty: number]>;
}

const STOCK: StockSpec[] = [
  { name: "Toxina botulínica 100U", unit: "frasco", cost: 780, minQuantity: 2, usedBy: [[5, 0.35]] },
  { name: "Ácido hialurônico 1ml", unit: "seringa", cost: 520, minQuantity: 3, usedBy: [[6, 1], [4, 1]] },
  { name: "Bioestimulador PLLA", unit: "frasco", cost: 890, minQuantity: 1, usedBy: [[7, 1]] },
  { name: "Fio de PDO", unit: "un", cost: 45, minQuantity: 20, usedBy: [[8, 8]] },
  { name: "Agulha 30G", unit: "un", cost: 1.2, minQuantity: 100, usedBy: [[5, 4], [6, 3], [7, 4], [4, 3]] },
  { name: "Luva nitrílica (caixa)", unit: "cx", cost: 38, minQuantity: 5, usedBy: [[0, 0.02], [3, 0.02], [5, 0.02], [6, 0.02], [7, 0.02], [8, 0.04], [12, 0.02]] },
  { name: "Gaze estéril (pacote)", unit: "pct", cost: 12, minQuantity: 20, usedBy: [[5, 0.2], [6, 0.3], [7, 0.3], [8, 0.5], [3, 0.3]] },
  { name: "Clorexidina 2%", unit: "frasco", cost: 24, minQuantity: 5, usedBy: [[5, 0.05], [6, 0.06], [7, 0.06], [8, 0.1], [3, 0.06]] },
  { name: "Anestésico tópico", unit: "bisnaga", cost: 68, minQuantity: 4, usedBy: [[3, 0.15], [6, 0.2], [8, 0.25], [14, 0.15]] },
  { name: "Sérum vitamina C", unit: "frasco", cost: 92, minQuantity: 5, usedBy: [[0, 0.08], [1, 0.06], [2, 0.1]] },
  { name: "Máscara calmante", unit: "un", cost: 18, minQuantity: 30, usedBy: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  { name: "Gel condutor", unit: "frasco", cost: 22, minQuantity: 6, usedBy: [[11, 0.1], [12, 0.2], [13, 0.05]] },
  { name: "Óleo de massagem", unit: "frasco", cost: 34, minQuantity: 8, usedBy: [[9, 0.08], [10, 0.1]] },
  { name: "Ponteira de diamante", unit: "un", cost: 55, minQuantity: 4, usedBy: [[1, 0.05]] },
  { name: "Manta descartável", unit: "un", cost: 9, minQuantity: 40, usedBy: [[9, 1], [10, 1], [11, 1], [12, 1]] },
  { name: "Solução de PDRN capilar", unit: "amp", cost: 74, minQuantity: 6, usedBy: [[14, 1]] },
];

const TAGS = [
  { name: "VIP", color: "#b45309" },
  { name: "Indicação", color: "#0f766e" },
  { name: "Instagram", color: "#be123c" },
  { name: "Harmonização", color: "#7c3aed" },
  { name: "Corporal", color: "#0369a1" },
  { name: "Pacote ativo", color: "#15803d" },
  { name: "Precisa de atenção", color: "#dc2626" },
  { name: "Aniversariante do mês", color: "#c026d3" },
];

const EXPENSE_CATEGORIES = [
  "Aluguel",
  "Folha de pagamento",
  "Insumos",
  "Marketing",
  "Energia e água",
  "Software e assinaturas",
  "Comissões",
  "Impostos",
  "Contabilidade",
];
const INCOME_CATEGORIES = ["Procedimentos", "Pacotes", "Produtos"];

// ── Clientes ─────────────────────────────────────────────────────────

type Profile = "vip" | "regular" | "ocasional" | "sumida" | "perdida" | "nova" | "lead";

/** Base de clientes de uma clínica com meio ano de casa. */
const CUSTOMER_COUNT = Number(process.env.SHOWCASE_CUSTOMERS || 340);

const FEMALE_NAMES = [
  "Ana Beatriz", "Camila", "Juliana", "Mariana", "Patrícia", "Renata", "Fernanda",
  "Carolina", "Larissa", "Vanessa", "Bianca", "Tatiane", "Gabriela", "Priscila",
  "Aline", "Débora", "Natália", "Michele", "Simone", "Letícia", "Rafaela",
  "Cristiane", "Adriana", "Luciana", "Sabrina", "Elaine", "Viviane", "Karina",
  "Amanda", "Thaís", "Isabela", "Jéssica", "Milena", "Paula", "Roberta", "Sandra",
  "Yasmin", "Beatriz", "Clara", "Daniela", "Eduarda", "Flávia", "Giovana",
  "Helena", "Ingrid", "Joana", "Kelly", "Lorena", "Marcela", "Nádia", "Olívia",
  "Poliana", "Rosana", "Silvia", "Talita", "Valéria", "Wanda", "Bruna", "Carla",
  "Denise", "Elisa", "Fabiana", "Graziela", "Heloísa", "Ivana", "Jaqueline",
  "Kamila", "Laís", "Manuela", "Nayara", "Verônica",
];
const MALE_NAMES = [
  "Bruno", "Diego", "Eduardo", "Rodrigo", "Marcos", "Felipe", "Gustavo",
  "Henrique", "Leandro", "Thiago", "André", "Rafael",
];
const SURNAMES = [
  "Ferreira", "Rocha", "Prado", "Teixeira", "Nogueira", "Vasconcelos", "Lima",
  "Bastos", "Moreira", "Andrade", "Cardoso", "Ribeiro", "Monteiro", "Duarte",
  "Barbosa", "Siqueira", "Freitas", "Antunes", "Carvalho", "Pires", "Gomes",
  "Melo", "Fonseca", "Bittencourt", "Coelho", "Tavares", "Peixoto", "Lacerda",
  "Rezende", "Bezerra", "Machado", "Nunes", "Braga", "Cintra", "Aguiar",
  "Moraes", "Campos", "Toledo", "Sampaio", "Assunção", "Fontes", "Vilela",
  "Marques", "Sales", "Quadros", "Salgado", "Amaral", "Xavier", "Pontes",
  "Cruz", "Rangel", "Vieira", "Trindade", "Ourique", "Zanetti", "Correia",
];

/** Nomes únicos e estáveis para a base — 12% masculinos. */
function customerNames(n: number): Array<{ name: string; male: boolean }> {
  const used = new Set<string>();
  const out: Array<{ name: string; male: boolean }> = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    const male = out.length % 8 === 7;
    const first = male ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
    const last = pick(SURNAMES);
    const full = `${first} ${last}`;
    if (used.has(full)) continue;
    used.add(full);
    out.push({ name: full, male });
  }
  return out;
}

/** Proporções de perfil — é isso que dá cara de base real à Inteligência. */
const PROFILE_MIX: Array<[Profile, number]> = [
  ["vip", 0.12],
  ["regular", 0.26],
  ["ocasional", 0.18],
  ["sumida", 0.13],
  ["perdida", 0.09],
  ["nova", 0.12],
  ["lead", 0.1],
];

const SOURCES = ["instagram", "indicação", "google", "whatsapp", "fachada", "campanha"];
const OCCUPATIONS = [
  "Advogada", "Professora", "Dentista", "Empresária", "Analista de sistemas",
  "Enfermeira", "Arquiteta", "Publicitária", "Nutricionista", "Corretora de imóveis",
  "Fisioterapeuta", "Servidora pública", "Designer", "Contadora", "Personal trainer",
];
const DISTRICTS = [
  "Jardins", "Moema", "Vila Mariana", "Pinheiros", "Itaim Bibi", "Perdizes",
  "Tatuapé", "Santana", "Brooklin", "Campo Belo", "Vila Madalena", "Higienópolis",
];
const STREETS = [
  "Rua das Acácias", "Alameda Santos", "Rua Joaquim Floriano", "Av. Ibirapuera",
  "Rua Pamplona", "Rua Cardeal Arcoverde", "Av. Rebouças", "Rua Vergueiro",
  "Rua Augusta", "Av. Brigadeiro Faria Lima", "Rua Bela Cintra", "Rua Turiassu",
];

interface CustomerPlan {
  id: string;
  name: string;
  male: boolean;
  phone: string;
  profile: Profile;
  favProc: number;
  altProcs: number[];
  packageIdx: number | null;
  packagePurchasedOn: string | null;
  visitDates: string[];
  birthDate: string | null;
  status: "lead" | "active" | "at_risk" | "inactive";
}

function cpfDigits(seq: number): string {
  const base = String(100000000 + seq * 7919).padStart(9, "0").slice(0, 9);
  return `${base.slice(0, 3)}.${base.slice(3, 6)}.${base.slice(6, 9)}-${String(
    (seq * 31) % 100,
  ).padStart(2, "0")}`;
}

/** Datas de visita por perfil — é daqui que sai a cara dos relatórios. */
function plannedVisitDates(profile: Profile): string[] {
  const out: string[] = [];
  let from: number;
  let until: number;
  let interval: [number, number];
  switch (profile) {
    case "vip":
      from = int(168, DAYS_BACK);
      until = int(0, 10);
      interval = [16, 25];
      break;
    case "regular":
      from = int(140, 178);
      until = int(4, 26);
      interval = [21, 33];
      break;
    case "ocasional":
      from = int(150, DAYS_BACK);
      until = int(18, 55);
      interval = [40, 68];
      break;
    case "sumida":
      from = int(165, DAYS_BACK);
      until = int(96, 142);
      interval = [26, 44];
      break;
    case "perdida":
      from = int(172, DAYS_BACK);
      until = int(150, 170);
      interval = [22, 34];
      break;
    case "nova":
      from = int(8, 42);
      until = int(0, 6);
      interval = [22, 34];
      break;
    default:
      return [];
  }
  for (let d = from; d >= until; d -= int(interval[0], interval[1])) {
    out.push(daysAgo(d));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 4. Agenda: alocador de horários (sem sobreposição por profissional)
// ═══════════════════════════════════════════════════════════════════

/** Expediente em minutos, no fuso da clínica. Domingo fechado. */
function openHours(dateISO: string): [number, number] | null {
  const d = dow(dateISO);
  if (d === 0) return null;
  if (d === 6) return [540, 840]; // sáb 09:00-14:00
  return [480, 1140]; // seg-sex 08:00-19:00
}

/** Feriados/recessos — viram bloqueios de agenda de verdade. */
const HOLIDAYS = new Set<string>();

class Booker {
  private taken = new Map<string, Array<[number, number]>>();

  /** Primeiro horário livre do dia para a profissional, ou null. */
  place(dateISO: string, profId: string, duration: number): number | null {
    if (HOLIDAYS.has(dateISO)) return null;
    const hours = openHours(dateISO);
    if (!hours) return null;
    const [open, close] = hours;
    const key = `${dateISO}|${profId}`;
    const slots = this.taken.get(key) ?? [];
    for (let start = open; start + duration <= close; start += 15) {
      // Reserva o almoço nos dias longos
      if (close > 900 && start < 780 && start + duration > 720) continue;
      const conflict = slots.some(([s, e]) => start < e && s < start + duration);
      if (!conflict) {
        slots.push([start, start + duration]);
        this.taken.set(key, slots);
        return start;
      }
    }
    return null;
  }
}

interface AppointmentPlan {
  id: string;
  customerIdx: number;
  professionalIdx: number;
  procIdx: number;
  dateISO: string;
  startMin: number;
  status: "scheduled" | "confirmed" | "showed" | "no_show" | "cancelled" | "rescheduled";
  origin: "manual" | "online_booking" | "automation" | "ai_agent" | "reschedule";
  customerPackageId: string | null;
  price: number;
  isTouchup: boolean;
  rescheduledToId: string | null;
  parentAppointmentId: string | null;
  cancelReason: string | null;
}

const CANCEL_REASONS = [
  "Cliente pediu para desmarcar (imprevisto no trabalho)",
  "Reagendou por telefone",
  "Ficou doente",
  "Viagem de última hora",
  "Profissional precisou remanejar a agenda",
];

// ═══════════════════════════════════════════════════════════════════
// 5. Conversas de WhatsApp
// ═══════════════════════════════════════════════════════════════════

type Turn = [author: "customer" | "ai" | "human" | "automation", body: string];

const CONVERSATION_SCRIPTS: Array<{ mode: "ai" | "human" | "waiting_human"; turns: Turn[] }> = [
  {
    mode: "ai",
    turns: [
      ["customer", "oi, boa tarde! vcs tem horário pra limpeza de pele essa semana?"],
      ["ai", "Oi, boa tarde! 😊 Tenho sim! Quinta às 15h ou sexta às 10h30, qual fica melhor pra você?"],
      ["customer", "quinta as 15 pode ser"],
      ["ai", "Perfeito! Só pra eu deixar certinho na ficha: me confirma seu nome completo, por favor?"],
      ["customer", "{{NOME}}"],
      ["ai", "Prontinho, {{PRIMEIRO}}! Agendei sua Limpeza de Pele Profunda na quinta às 15h com a Camila 💛 Te mando um lembrete um dia antes."],
      ["customer", "obrigada!!"],
    ],
  },
  {
    mode: "ai",
    turns: [
      ["customer", "bom dia, quanto está o botox?"],
      ["ai", "Bom dia! A aplicação de toxina botulínica está R$ 1.290, incluindo o retorno de retoque em 15 dias 💛 Quer que eu veja um horário de avaliação pra você?"],
      ["customer", "quero sim, tem sabado?"],
      ["ai", "Tenho! Sábado às 10h com a Dra. Renata. Posso reservar?"],
      ["customer", "pode!"],
      ["ai", "Reservado, {{PRIMEIRO}}! Sábado 10h com a Dra. Renata. Qualquer coisa é só me chamar por aqui 😊"],
    ],
  },
  {
    mode: "ai",
    turns: [
      ["automation", "Oi {{PRIMEIRO}}! Tudo bem? 😊 Passando pra lembrar do seu horário amanhã às 14h com a Bruna. Posso confirmar sua presença?"],
      ["customer", "confirmado!"],
      ["ai", "Maravilha, {{PRIMEIRO}}! Te espero amanhã às 14h 💛"],
    ],
  },
  {
    mode: "ai",
    turns: [
      ["customer", "preciso remarcar o de amanhã, deu um problema aqui"],
      ["ai", "Sem problema nenhum, {{PRIMEIRO}}! Tenho quarta às 16h ou sexta às 11h. Alguma dessas serve?"],
      ["customer", "sexta as 11 é melhor"],
      ["ai", "Feito! Passei você para sexta às 11h. O horário de amanhã já liberei 😊"],
    ],
  },
  {
    mode: "waiting_human",
    turns: [
      ["customer", "oi! fiz preenchimento ontem e tá bem inchado, é normal?"],
      ["ai", "Oi, {{PRIMEIRO}}! Vou chamar alguém da equipe pra te responder com calma agora, tá bom? Um minutinho 💛"],
    ],
  },
  {
    mode: "human",
    turns: [
      ["customer", "boa tarde, vcs parcelam o bioestimulador?"],
      ["ai", "Boa tarde! Parcelamos sim, em até 3x sem juros no cartão 💛"],
      ["customer", "e em 6x?"],
      ["ai", "Deixa eu chamar a Fernanda pra te falar certinho sobre condições especiais, um momentinho 😊"],
      ["human", "Oi {{PRIMEIRO}}, aqui é a Fernanda! Consigo fazer 6x com um pequeno acréscimo, ou 3x sem juros. Quer que eu te mande o orçamento fechado?"],
      ["customer", "manda por favor"],
      ["human", "Mandei agora no seu WhatsApp 💛"],
    ],
  },
  {
    mode: "ai",
    turns: [
      ["automation", "{{PRIMEIRO}}, obrigada pela visita de hoje! 💛 Lembrando os cuidados: sem sol, academia e maquiagem por 24h."],
      ["customer", "obrigada, adorei o atendimento!"],
      ["ai", "Que alegria ler isso, {{PRIMEIRO}}! 🥰 Se puder deixar sua avaliação no Google, ajuda demais a gente."],
      ["customer", "já deixei ⭐⭐⭐⭐⭐"],
    ],
  },
  {
    mode: "ai",
    turns: [
      ["customer", "vcs atendem no sabado?"],
      ["ai", "Atendemos sim, das 9h às 14h 😊 Quer que eu veja um horário pra você?"],
      ["customer", "por enquanto só queria saber, obrigada"],
      ["ai", "Imagina! Qualquer coisa é só chamar aqui 💛"],
    ],
  },
  {
    mode: "ai",
    turns: [
      ["automation", "Oi {{PRIMEIRO}}! Faz um tempinho que a gente não se vê por aqui 💛 Sua última Drenagem foi em março. Que tal retomar? Tenho horários essa semana."],
      ["customer", "oi! to querendo voltar sim, qual valor da sessão avulsa?"],
      ["ai", "A sessão avulsa está R$ 170 😊 E tenho o pacote de 10 sessões por R$ 1.450, que sai R$ 145 cada. Quer que eu reserve um horário?"],
      ["customer", "vou ver com meu marido e te falo"],
      ["ai", "Claro, {{PRIMEIRO}}! Fico por aqui 💛"],
    ],
  },
  {
    mode: "waiting_human",
    turns: [
      ["customer", "quero cancelar meu pacote e pedir reembolso"],
      ["ai", "Entendi, {{PRIMEIRO}}. Vou chamar a Fernanda pra cuidar disso com você agora 💛"],
    ],
  },
  {
    mode: "ai",
    turns: [
      ["customer", "oi, vi no instagram a promoção de criolipólise"],
      ["ai", "Oi! Que bom que viu 😍 A sessão de Criolipólise está R$ 690 e a avaliação é gratuita. Quer marcar a avaliação?"],
      ["customer", "quero"],
      ["ai", "Me confirma seu nome completo pra eu abrir sua ficha?"],
      ["customer", "{{NOME}}"],
      ["ai", "Obrigada, {{PRIMEIRO}}! Marquei sua avaliação para terça às 9h com a Bruna 💛"],
    ],
  },
  {
    mode: "human",
    turns: [
      ["customer", "esqueci minha pulseira aí na sala ontem 😩"],
      ["human", "Oi {{PRIMEIRO}}! Achamos sim, tá guardadinha aqui na recepção 💛 Pode passar quando quiser."],
      ["customer", "aaah que alívio, obrigada!!"],
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// 6. Execução
// ═══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("\n═══ Seed de demonstração ClinicaOS ═══\n");

  // ── Alvo ────────────────────────────────────────────────────────
  const accounts = await listAccounts();
  const needle = process.env.SHOWCASE_CLINIC || process.env.SHOWCASE_OWNER_EMAIL || "";
  let account = needle ? matchAccount(accounts, needle) : undefined;

  if (!account && needle && process.env.SHOWCASE_CREATE === "1") {
    account = await createAccount();
  }
  if (!account) {
    if (needle) console.log(`Nenhuma conta bate com "${needle}".`);
    else console.log("Nenhum alvo informado (SHOWCASE_CLINIC ou SHOWCASE_OWNER_EMAIL).");
    printAccounts(accounts);
    console.log("Para criar uma conta nova, acrescente SHOWCASE_CREATE=1.\n");
    return;
  }

  const clinicId = account.clinicId;
  const ownerId = account.userId;
  console.log(`Alvo: ${account.clinicName}  <${account.email}>`);
  console.log(`clinic_id: ${clinicId}\n`);

  // ── Configuração de IA ──────────────────────────────────────────
  let aiProvider: AiProviderBlock | null = null;
  if (process.env.SHOWCASE_OPENAI_KEY) {
    aiProvider = aiProviderFromKey(process.env.SHOWCASE_OPENAI_KEY);
    log(`IA: chave da OpenAI aplicada (termina em ${aiProvider.keyHint}).`);
  } else if (process.env.SHOWCASE_AI_FROM) {
    const src = matchAccount(accounts, process.env.SHOWCASE_AI_FROM);
    if (!src) {
      console.log(`\nERRO: não achei a conta "${process.env.SHOWCASE_AI_FROM}" para copiar a IA.`);
      printAccounts(accounts);
      return;
    }
    aiProvider = await readAiProviderFrom(src.clinicId);
    if (!aiProvider) {
      console.log(
        `\nERRO: a conta "${src.clinicName}" não tem modelo de IA próprio configurado ` +
          "(está no padrão do sistema). Use SHOWCASE_OPENAI_KEY.",
      );
      return;
    }
    if (process.env.SHOWCASE_AI_AGENT_MODEL) aiProvider.agentModel = process.env.SHOWCASE_AI_AGENT_MODEL;
    if (process.env.SHOWCASE_AI_CLASSIFIER_MODEL) {
      aiProvider.classifierModel = process.env.SHOWCASE_AI_CLASSIFIER_MODEL;
    }
    log(
      `IA: copiada de "${src.clinicName}" — ${aiProvider.provider}/${aiProvider.agentModel}` +
        (aiProvider.keyHint ? ` (chave …${aiProvider.keyHint})` : ""),
    );
  } else {
    log("IA: nenhuma chave informada — a clínica fica no modelo padrão do sistema.");
  }

  // ── Reset ───────────────────────────────────────────────────────
  // Conta o que já existe — inclusive de uma execução que morreu no meio,
  // senão o reset não dispara e o seed bate em chave duplicada
  const hasData = await withTenant(clinicId, async (tx) => {
    const r = await tx.execute(sqlRaw`
      SELECT (SELECT count(*) FROM appointments WHERE clinic_id = ${clinicId})
           + (SELECT count(*) FROM customers    WHERE clinic_id = ${clinicId})
           + (SELECT count(*) FROM procedures   WHERE clinic_id = ${clinicId})
           + (SELECT count(*) FROM professionals WHERE clinic_id = ${clinicId}) AS n
    `);
    return Number((r.rows[0] as { n: string | number }).n);
  });
  if (hasData > 0) {
    if (process.env.SHOWCASE_RESET !== "1") {
      console.log(
        `\nA clínica já tem ${hasData} registros (clientes, serviços ou atendimentos). ` +
          "Para reescrever a demo do zero, rode de novo com SHOWCASE_RESET=1.\n",
      );
      return;
    }
    await resetClinic(clinicId);
  }

  // ═════════════════════════════════════════════════════════════════
  console.log("\n▸ Clínica, equipe e salas");
  // ═════════════════════════════════════════════════════════════════
  const bookingSlug = `${norm(account.clinicName).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${clinicId.slice(0, 4)}`;

  const professionalIds: string[] = [];
  const roomIds: string[] = [];
  await withTenant(clinicId, async (tx) => {
    await tx
      .update(schema.clinics)
      .set({
        legalName: `${account!.clinicName} Serviços Estéticos Ltda`,
        cnpj: "42.318.907/0001-56",
        phone: "+551139872200",
        email: `contato@${norm(account!.clinicName).replace(/[^a-z0-9]+/g, "")}.com.br`,
        addressStreet: "Alameda Lorena",
        addressNumber: "1204",
        addressComplement: "Conjunto 82",
        addressDistrict: "Jardins",
        addressCity: "São Paulo",
        addressState: "SP",
        addressZip: "01424-005",
        timezone: TZ,
        businessHours: {
          mon: [["08:00", "19:00"]],
          tue: [["08:00", "19:00"]],
          wed: [["08:00", "19:00"]],
          thu: [["08:00", "19:00"]],
          fri: [["08:00", "19:00"]],
          sat: [["09:00", "14:00"]],
        },
        bookingSlug,
        onlineBookingEnabled: true,
        anticipatesReceivables: false,
        googleReviewUrl: "https://g.page/r/clinica-demo/review",
        plan: "pro",
        status: "active",
      })
      .where(eq(schema.clinics.id, clinicId));

    // settings: onboarding concluído + persona da IA + provedor
    const settings: Record<string, unknown> = {
      onboarding_done: true,
      ai: { enabled: true, assistantName: "Ana", tone: "acolhedora" },
    };
    if (aiProvider) settings.aiProvider = aiProvider;
    await tx.execute(sqlRaw`
      UPDATE clinics SET settings = settings || ${JSON.stringify(settings)}::jsonb
      WHERE id = ${clinicId}
    `);

    for (const p of PROFESSIONALS) {
      const [row] = await tx
        .insert(schema.professionals)
        .values({
          clinicId,
          name: p.name,
          specialty: p.specialty,
          registrationNumber: p.registration,
          calendarColor: p.color,
        })
        .returning({ id: schema.professionals.id });
      professionalIds.push(row!.id);
    }
    for (const r of ROOMS) {
      const [row] = await tx
        .insert(schema.rooms)
        .values({ clinicId, name: r })
        .returning({ id: schema.rooms.id });
      roomIds.push(row!.id);
    }
    // A dona também atende: vira recurso de agenda
    await tx
      .update(schema.clinicMembers)
      .set({ professionalId: professionalIds[0] })
      .where(
        and(
          eq(schema.clinicMembers.clinicId, clinicId),
          eq(schema.clinicMembers.userId, ownerId),
        ),
      );
  });
  log(`${PROFESSIONALS.length} profissionais e ${ROOMS.length} salas.`);

  // Logins da equipe (recepção e profissionais)
  const teamLogins: Array<{ name: string; email: string; role: "manager" | "reception" | "professional"; professionalIdx: number | null }> = [
    { name: "Thaís Moreira", email: `recepcao.${clinicId.slice(0, 6)}@clinicaos.demo`, role: "reception", professionalIdx: null },
    { name: "Camila Duarte", email: `camila.${clinicId.slice(0, 6)}@clinicaos.demo`, role: "professional", professionalIdx: 1 },
    { name: "Bruna Salles", email: `bruna.${clinicId.slice(0, 6)}@clinicaos.demo`, role: "professional", professionalIdx: 2 },
  ];
  {
    const db = unsafeGlobalDb();
    const hash = await argon2.hash(process.env.SHOWCASE_TEAM_PASSWORD || "demo1234");
    for (const t of teamLogins) {
      let u = (await db.select().from(schema.users).where(eq(schema.users.email, t.email)))[0];
      if (!u) {
        u = (
          await db
            .insert(schema.users)
            .values({ name: t.name, email: t.email, passwordHash: hash })
            .returning()
        )[0]!;
      }
      const uid = u.id;
      await withTenant(clinicId, async (tx) => {
        await tx
          .insert(schema.clinicMembers)
          .values({
            clinicId,
            userId: uid,
            role: t.role,
            professionalId: t.professionalIdx === null ? null : professionalIds[t.professionalIdx],
          })
          .onConflictDoNothing();
      });
    }
  }
  log(`${teamLogins.length} logins de equipe (senha demo1234).`);

  // ═════════════════════════════════════════════════════════════════
  console.log("▸ Serviços, pacotes e estoque");
  // ═════════════════════════════════════════════════════════════════
  const procedureIds: string[] = [];
  const packageIds: string[] = [];
  const stockItemIds: string[] = [];
  await withTenant(clinicId, async (tx) => {
    for (const p of PROCEDURES) {
      const [row] = await tx
        .insert(schema.procedures)
        .values({
          clinicId,
          name: p.name,
          category: p.category,
          durationMinutes: p.durationMinutes,
          price: money(p.price),
          cost: money(p.cost),
          returnDays: p.returnDays,
          touchupDays: p.touchupDays ?? null,
          preCare: p.preCare ?? null,
          postCare: p.postCare ?? null,
          postSaleCadenceDays: p.postSaleCadenceDays ?? null,
          commissionDefaultPct: money(p.commissionDefaultPct),
        })
        .returning({ id: schema.procedures.id });
      procedureIds.push(row!.id);
    }
    for (const p of PACKAGES) {
      const [row] = await tx
        .insert(schema.packages)
        .values({
          clinicId,
          name: p.name,
          price: money(p.price),
          validityDays: p.validityDays,
        })
        .returning({ id: schema.packages.id });
      packageIds.push(row!.id);
      await tx.insert(schema.packageItems).values({
        clinicId,
        packageId: row!.id,
        procedureId: procedureIds[p.procIdx]!,
        sessions: p.sessions,
      });
    }
    for (const s of STOCK) {
      const [row] = await tx
        .insert(schema.stockItems)
        .values({
          clinicId,
          name: s.name,
          unit: s.unit,
          cost: money(s.cost),
          minQuantity: money(s.minQuantity),
          createdBy: ownerId,
        })
        .returning({ id: schema.stockItems.id });
      stockItemIds.push(row!.id);
    }
    const supplies = STOCK.flatMap((s, si) =>
      s.usedBy.map(([procIdx, qty]) => ({
        clinicId,
        procedureId: procedureIds[procIdx]!,
        stockItemId: stockItemIds[si]!,
        quantityPerSession: money(qty),
      })),
    );
    await insertMany(tx, schema.procedureSupplies, supplies);

    // Regras de comissão: geral por profissional + uma específica
    for (let i = 0; i < PROFESSIONALS.length; i++) {
      await tx.insert(schema.commissionRules).values({
        clinicId,
        professionalId: professionalIds[i]!,
        procedureId: null,
        kind: "pct",
        value: money(PROFESSIONALS[i]!.commissionPct),
        createdBy: ownerId,
      });
    }
    await tx.insert(schema.commissionRules).values({
      clinicId,
      professionalId: professionalIds[0]!,
      procedureId: procedureIds[8]!, // Fios de PDO
      kind: "fixed",
      value: money(600),
      createdBy: ownerId,
    });
  });
  log(
    `${PROCEDURES.length} serviços, ${PACKAGES.length} pacotes, ${STOCK.length} itens de estoque, ` +
      "regras de comissão.",
  );

  // ── Categorias financeiras e tags ───────────────────────────────
  const incomeCatIds = new Map<string, string>();
  const expenseCatIds = new Map<string, string>();
  const tagIds = new Map<string, string>();
  await withTenant(clinicId, async (tx) => {
    for (const name of INCOME_CATEGORIES) {
      const [row] = await tx
        .insert(schema.financeCategories)
        .values({ clinicId, name, kind: "income", color: "#0f766e" })
        .returning({ id: schema.financeCategories.id });
      incomeCatIds.set(name, row!.id);
    }
    for (const name of EXPENSE_CATEGORIES) {
      const [row] = await tx
        .insert(schema.financeCategories)
        .values({ clinicId, name, kind: "expense", color: "#b45309" })
        .returning({ id: schema.financeCategories.id });
      expenseCatIds.set(name, row!.id);
    }
    for (const t of TAGS) {
      const [row] = await tx
        .insert(schema.tags)
        .values({ clinicId, name: t.name, color: t.color })
        .returning({ id: schema.tags.id });
      tagIds.set(t.name, row!.id);
    }
  });

  // ═════════════════════════════════════════════════════════════════
  console.log("▸ Clientes, fichas e anamneses");
  // ═════════════════════════════════════════════════════════════════
  const profiles: Profile[] = [];
  for (const [p, share] of PROFILE_MIX) {
    for (let i = 0; i < Math.round(CUSTOMER_COUNT * share); i++) profiles.push(p);
  }
  const shuffledProfiles = shuffle(profiles);
  const names = customerNames(shuffledProfiles.length);

  const customers: CustomerPlan[] = names.map(({ name, male }, i) => {
    const profile = shuffledProfiles[i]!;
    const category = pick([
      "Facial",
      "Facial",
      "Facial",
      "Harmonização",
      "Harmonização",
      "Corporal",
      "Corporal",
      "Corporal",
      "Capilar",
    ]);
    const inCategory = PROCEDURES.map((p, idx) => ({ p, idx })).filter(
      (x) => x.p.category === category,
    );
    const fav = pick(inCategory).idx;
    const alts = shuffle(inCategory.map((x) => x.idx)).slice(0, 2);
    // Clínica em crescimento: quanto mais antigo o mês, menos volume.
    // É o que faz o gráfico de faturamento subir ao longo dos 6 meses.
    const visitDates = plannedVisitDates(profile).filter((d) =>
      chance(0.55 + 0.45 * (1 - diffDays(TODAY, d) / DAYS_BACK)),
    );
    const status: CustomerPlan["status"] =
      profile === "lead"
        ? "lead"
        : profile === "sumida"
          ? "at_risk"
          : profile === "perdida"
            ? "inactive"
            : "active";
    // Aniversário: alguns caem nos próximos dias (para a automação aparecer)
    const bDay = new Date(`${TODAY}T12:00:00Z`);
    bDay.setUTCDate(bDay.getUTCDate() + int(-3, 12));
    const birthDate =
      i % 5 === 0
        ? `${int(1974, 2003)}-${String(bDay.getUTCMonth() + 1).padStart(2, "0")}-${String(bDay.getUTCDate()).padStart(2, "0")}`
        : `${int(1972, 2004)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
    return {
      id: randomUUID(),
      name,
      male,
      phone: `+55119${String(80000000 + i * 137 + 11).padStart(8, "0")}`,
      profile,
      favProc: fav,
      altProcs: alts,
      packageIdx: null,
      packagePurchasedOn: null,
      visitDates,
      birthDate,
      status,
    };
  });

  // Quem tem pacote: clientes cujo procedimento favorito está num pacote
  const procToPackage = new Map<number, number>();
  PACKAGES.forEach((p, i) => procToPackage.set(p.procIdx, i));
  const PACKAGE_TARGET = Math.round(CUSTOMER_COUNT * 0.18);
  let packagesSold = 0;
  for (const c of customers) {
    if (packagesSold >= PACKAGE_TARGET) break;
    const pkgIdx = procToPackage.get(c.favProc);
    if (pkgIdx === undefined) continue;
    if (c.visitDates.length < 4) continue;
    if (!chance(0.75)) continue;
    c.packageIdx = pkgIdx;
    c.packagePurchasedOn = addDaysISO(c.visitDates[0]!, -1);
    packagesSold++;
  }

  const anamnesisTemplateVersionId = await withTenant(clinicId, async (tx) => {
    const [tpl] = await tx
      .insert(schema.anamnesisTemplates)
      .values({ clinicId, name: "Anamnese — Estética", createdBy: ownerId })
      .returning({ id: schema.anamnesisTemplates.id });
    const [ver] = await tx
      .insert(schema.anamnesisTemplateVersions)
      .values({
        clinicId,
        templateId: tpl!.id,
        version: 1,
        schema: AESTHETIC_ANAMNESIS_V1,
      })
      .returning({ id: schema.anamnesisTemplateVersions.id });
    return ver!.id;
  });

  await withTenant(clinicId, async (tx) => {
    const rows = customers.map((c, i) => {
      const firstVisit = c.visitDates.at(0);
      const createdOn = firstVisit ? addDaysISO(firstVisit, -int(0, 4)) : daysAgo(int(1, 40));
      return {
        id: c.id,
        clinicId,
        fullName: c.name,
        cpf: cpfDigits(i + 1),
        birthDate: c.birthDate,
        sex: c.male ? ("masculino" as const) : ("feminino" as const),
        phoneE164: c.phone,
        email: `${norm(firstName(c.name))}.${norm(c.name.split(" ").at(-1)!)}@email.com.br`,
        instagram: chance(0.6) ? `@${norm(firstName(c.name))}${int(10, 99)}` : null,
        occupation: pick(OCCUPATIONS),
        addressStreet: pick(STREETS),
        addressNumber: String(int(20, 2400)),
        addressDistrict: pick(DISTRICTS),
        addressCity: "São Paulo",
        addressState: "SP",
        addressZip: `0${int(1000, 5999)}-${int(100, 999)}`,
        source: pick(SOURCES),
        status: c.status,
        photoConsent: chance(0.7),
        lgpdConsentAt: new Date(`${createdOn}T13:00:00Z`),
        lgpdConsentSource: "ficha de cadastro",
        whatsappValid: true,
        notes: chance(0.25) ? pick([
          "Prefere horários no fim da tarde.",
          "Sempre vem acompanhada da irmã.",
          "Pele sensível — reagiu a ácido glicólico em 2025.",
          "Indicou 3 clientes novas. Tratar como VIP.",
          "Estaciona no prédio ao lado, avisar quando atrasar.",
        ]) : null,
        createdAt: new Date(`${createdOn}T13:00:00Z`),
      };
    });
    await insertMany(tx, schema.customers, rows);

    // Tags
    const links: Array<{ clinicId: string; customerId: string; tagId: string }> = [];
    for (const c of customers) {
      const add = (name: string) => {
        const id = tagIds.get(name);
        if (id) links.push({ clinicId, customerId: c.id, tagId: id });
      };
      if (c.profile === "vip") add("VIP");
      if (c.profile === "sumida" || c.profile === "perdida") add("Precisa de atenção");
      if (c.packageIdx !== null) add("Pacote ativo");
      const cat = PROCEDURES[c.favProc]!.category;
      if (cat === "Harmonização") add("Harmonização");
      if (cat === "Corporal") add("Corporal");
      if (chance(0.3)) add(pick(["Indicação", "Instagram"]));
      if (c.birthDate?.slice(5, 7) === TODAY.slice(5, 7)) add("Aniversariante do mês");
    }
    await insertMany(tx, schema.customerTags, links);

    // Anamneses (cifradas) — só quem já foi atendida
    const key = process.env.SENSITIVE_DATA_KEY;
    if (key) {
      const responses = customers
        .filter((c) => c.visitDates.length > 0)
        .map((c) => {
          const answers: AnamnesisAnswers = {
            alergias: chance(0.25)
              ? pick(["Dipirona", "Penicilina", "Lidocaína (leve)", "Níquel", "Frutos do mar"])
              : "",
            medicamentos: chance(0.35)
              ? pick(["Anticoncepcional", "Losartana 50mg", "Levotiroxina", "Sertralina 50mg"])
              : "",
            doencas_cronicas: chance(0.18)
              ? pick(["Hipertensão controlada", "Hipotireoidismo", "Diabetes tipo 2"])
              : "",
            gestante: chance(0.03),
            lactante: chance(0.04),
            marcapasso: false,
            tabagismo: chance(0.12),
            etilismo: chance(0.2),
            exposicao_solar: chance(0.4),
            protetor_solar: chance(0.8),
            uso_acidos: chance(0.35),
            problemas_pele: chance(0.3)
              ? pick(["Melasma", "Acne leve", "Rosácea", "Oleosidade na zona T"])
              : "",
            historico_cirurgico: chance(0.2)
              ? pick(["Cesárea 2019", "Rinoplastia 2021", "Apendicectomia 2015"])
              : "",
          };
          const filledOn = c.visitDates.at(0) ?? daysAgo(30);
          return {
            clinicId,
            customerId: c.id,
            templateVersionId: anamnesisTemplateVersionId,
            answersEncrypted: encryptSensitive(JSON.stringify(answers), key),
            riskSummary: computeRiskSummary(AESTHETIC_ANAMNESIS_V1, answers),
            filledByUserId: ownerId,
            filledAt: new Date(`${filledOn}T13:30:00Z`),
          };
        });
      await insertMany(tx, schema.anamnesisResponses, responses);
      log(`${responses.length} anamneses preenchidas (cifradas).`);
    } else {
      log("SENSITIVE_DATA_KEY ausente — anamneses não foram geradas.");
    }
  });
  log(`${customers.length} clientes (${packagesSold} com pacote ativo).`);

  // ── Pacotes vendidos ────────────────────────────────────────────
  const customerPackages = new Map<
    string,
    { id: string; procIdx: number; total: number; used: number; expiresAt: string; pricePaid: number }
  >();
  await withTenant(clinicId, async (tx) => {
    const rows: unknown[] = [];
    for (const c of customers) {
      if (c.packageIdx === null || !c.packagePurchasedOn) continue;
      const spec = PACKAGES[c.packageIdx]!;
      const id = randomUUID();
      const expiresAt = addDaysISO(c.packagePurchasedOn, spec.validityDays);
      customerPackages.set(c.id, {
        id,
        procIdx: spec.procIdx,
        total: spec.sessions,
        used: 0,
        expiresAt,
        pricePaid: spec.price,
      });
      rows.push({
        id,
        clinicId,
        customerId: c.id,
        packageId: packageIds[c.packageIdx]!,
        procedureId: procedureIds[spec.procIdx]!,
        sessionsTotal: spec.sessions,
        sessionsUsed: 0,
        pricePaid: money(spec.price),
        purchasedAt: c.packagePurchasedOn,
        expiresAt,
        status: "active" as const,
        createdBy: ownerId,
        createdAt: new Date(`${c.packagePurchasedOn}T14:00:00Z`),
      });
    }
    await insertMany(tx, schema.customerPackages, rows);
  });

  // ═════════════════════════════════════════════════════════════════
  console.log("▸ 6 meses de agenda");
  // ═════════════════════════════════════════════════════════════════
  // Feriados/recessos do período
  for (const d of [12, 47, 88, 131, 166]) HOLIDAYS.add(daysAgo(d));

  const booker = new Booker();
  const appointments: AppointmentPlan[] = [];

  // Visitas planejadas, em ordem cronológica
  const planned: Array<{ customerIdx: number; dateISO: string; procIdx: number }> = [];
  customers.forEach((c, ci) => {
    c.visitDates.forEach((d, vi) => {
      // Alterna entre o favorito e um alternativo da mesma área
      const procIdx = vi > 0 && chance(0.28) ? pick(c.altProcs) : c.favProc;
      planned.push({ customerIdx: ci, dateISO: d, procIdx });
    });
  });
  planned.sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  for (const v of planned) {
    const spec = PROCEDURES[v.procIdx]!;
    const cust = customers[v.customerIdx]!;
    let placed = false;
    for (let shift = 0; shift < 8 && !placed; shift++) {
      const dateISO = addDaysISO(v.dateISO, shift);
      if (diffDays(dateISO, TODAY) > DAYS_AHEAD) break;
      for (const profIdx of shuffle(spec.pros)) {
        const start = booker.place(dateISO, professionalIds[profIdx]!, spec.durationMinutes);
        if (start === null) continue;

        // Pacote cobre a sessão?
        const pkg = customerPackages.get(cust.id);
        const covered =
          pkg !== undefined &&
          pkg.procIdx === v.procIdx &&
          pkg.used < pkg.total &&
          dateISO <= pkg.expiresAt;

        const past = dateISO < TODAY;
        const today = dateISO === TODAY;
        let status: AppointmentPlan["status"];
        if (past) {
          const r = rnd();
          status = r < 0.845 ? "showed" : r < 0.905 ? "no_show" : r < 0.975 ? "cancelled" : "rescheduled";
        } else if (today) {
          status = start < 780 ? "showed" : chance(0.7) ? "confirmed" : "scheduled";
        } else {
          status = chance(0.55) ? "confirmed" : "scheduled";
        }

        if (status === "showed" && covered && pkg) pkg.used++;

        const originRoll = rnd();
        const origin: AppointmentPlan["origin"] =
          originRoll < 0.5
            ? "manual"
            : originRoll < 0.78
              ? "ai_agent"
              : originRoll < 0.92
                ? "online_booking"
                : "automation";

        appointments.push({
          id: randomUUID(),
          customerIdx: v.customerIdx,
          professionalIdx: profIdx,
          procIdx: v.procIdx,
          dateISO,
          startMin: start,
          status,
          origin,
          customerPackageId: covered && status === "showed" ? pkg!.id : covered ? pkg!.id : null,
          price: spec.price,
          isTouchup: false,
          rescheduledToId: null,
          parentAppointmentId: null,
          cancelReason: null,
        });
        placed = true;
        break;
      }
    }
  }

  // Retoques (toxina/preenchimento) — nascem de atendimentos realizados
  const touchups: AppointmentPlan[] = [];
  for (const a of appointments) {
    const spec = PROCEDURES[a.procIdx]!;
    if (!spec.touchupDays || a.status !== "showed") continue;
    if (!chance(0.45)) continue;
    const dateISO = addDaysISO(a.dateISO, spec.touchupDays);
    if (diffDays(dateISO, TODAY) > DAYS_AHEAD) continue;
    const start = booker.place(dateISO, professionalIds[a.professionalIdx]!, 30);
    if (start === null) continue;
    touchups.push({
      ...a,
      id: randomUUID(),
      dateISO,
      startMin: start,
      price: 0,
      isTouchup: true,
      parentAppointmentId: a.id,
      customerPackageId: null,
      origin: "automation",
      status:
        dateISO < TODAY ? (chance(0.9) ? "showed" : "no_show") : chance(0.6) ? "confirmed" : "scheduled",
    });
  }
  appointments.push(...touchups);

  // Reagendamentos: o cancelado aponta para o novo
  for (const a of appointments) {
    if (a.status !== "rescheduled") continue;
    const spec = PROCEDURES[a.procIdx]!;
    for (let shift = 2; shift < 12; shift++) {
      const dateISO = addDaysISO(a.dateISO, shift);
      if (diffDays(dateISO, TODAY) > DAYS_AHEAD) break;
      const start = booker.place(dateISO, professionalIds[a.professionalIdx]!, spec.durationMinutes);
      if (start === null) continue;
      const novo: AppointmentPlan = {
        ...a,
        id: randomUUID(),
        dateISO,
        startMin: start,
        origin: "reschedule",
        rescheduledToId: null,
        parentAppointmentId: a.id,
        cancelReason: null,
        status: dateISO < TODAY ? (chance(0.9) ? "showed" : "no_show") : "confirmed",
      };
      a.rescheduledToId = novo.id;
      appointments.push(novo);
      break;
    }
  }
  // Agenda cheia daqui para a frente. As visitas planejadas acima quase todas
  // caem no passado — sem este passo, a tela mais importante da demo (a agenda
  // de hoje e das próximas semanas) abre vazia.
  {
    const activePool = customers
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.profile === "vip" || x.c.profile === "regular" || x.c.profile === "ocasional" || x.c.profile === "nova");
    const procsByPro = professionalIds.map((_, pi) =>
      PROCEDURES.map((p, idx) => ({ p, idx })).filter((x) => x.p.pros.includes(pi)),
    );
    for (let d = 0; d <= DAYS_AHEAD; d++) {
      const dateISO = addDaysISO(TODAY, d);
      if (!openHours(dateISO) || HOLIDAYS.has(dateISO)) continue;
      // Perto de hoje a agenda está cheia; as semanas seguintes ainda enchendo
      const load = d <= 7 ? int(2, 4) : d <= 14 ? int(1, 3) : int(1, 2);
      for (let pi = 0; pi < professionalIds.length; pi++) {
        for (let k = 0; k < load; k++) {
          const opt = pick(procsByPro[pi]!);
          const start = booker.place(dateISO, professionalIds[pi]!, opt.p.durationMinutes);
          if (start === null) break;
          const target = pick(activePool);
          const pkg = customerPackages.get(target.c.id);
          const covered =
            pkg !== undefined && pkg.procIdx === opt.idx && pkg.used < pkg.total && dateISO <= pkg.expiresAt;
          // Os horários de hoje que já passaram foram atendidos
          const past = d === 0 && start < 780;
          if (past && covered && pkg) pkg.used++;
          const originRoll = rnd();
          appointments.push({
            id: randomUUID(),
            customerIdx: target.i,
            professionalIdx: pi,
            procIdx: opt.idx,
            dateISO,
            startMin: start,
            status: past ? "showed" : chance(0.6) ? "confirmed" : "scheduled",
            origin:
              originRoll < 0.42 ? "manual" : originRoll < 0.74 ? "ai_agent" : originRoll < 0.93 ? "online_booking" : "automation",
            customerPackageId: covered ? pkg!.id : null,
            price: opt.p.price,
            isTouchup: false,
            rescheduledToId: null,
            parentAppointmentId: null,
            cancelReason: null,
          });
        }
      }
    }
  }

  for (const a of appointments) {
    if (a.status === "cancelled") a.cancelReason = pick(CANCEL_REASONS);
  }

  appointments.sort((a, b) =>
    a.dateISO === b.dateISO ? a.startMin - b.startMin : a.dateISO.localeCompare(b.dateISO),
  );

  const apptStartsAt = (a: AppointmentPlan) => zonedToUtc(a.dateISO, hhmm(a.startMin), TZ);

  await withTenant(clinicId, async (tx) => {
    const rows = appointments.map((a) => {
      const spec = PROCEDURES[a.procIdx]!;
      const startsAt = apptStartsAt(a);
      const duration = a.isTouchup ? 30 : spec.durationMinutes;
      return {
        id: a.id,
        clinicId,
        customerId: customers[a.customerIdx]!.id,
        professionalId: professionalIds[a.professionalIdx]!,
        roomId: roomIds[a.professionalIdx % roomIds.length]!,
        procedureId: procedureIds[a.procIdx]!,
        startsAt,
        endsAt: new Date(startsAt.getTime() + duration * 60_000),
        status: a.status,
        price: money(a.price),
        isTouchup: a.isTouchup,
        // Os vínculos entre atendimentos entram depois: rescheduled_to_id
        // aponta para FRENTE e a FK não aceita a linha que ainda não existe.
        parentAppointmentId: null,
        rescheduledToId: null,
        origin: a.origin,
        customerPackageId: a.customerPackageId,
        cancelReason: a.cancelReason,
        statusChangedAt: startsAt,
        createdBy: a.origin === "manual" ? ownerId : null,
        createdAt: new Date(startsAt.getTime() - int(2, 20) * 86_400_000),
      };
    });
    await insertMany(tx, schema.appointments, rows);

    // Agora que todas as linhas existem, amarra retoques e reagendamentos
    for (const a of appointments) {
      if (a.parentAppointmentId) {
        await tx.execute(sqlRaw`
          UPDATE appointments SET parent_appointment_id = ${a.parentAppointmentId}
          WHERE id = ${a.id} AND clinic_id = ${clinicId}
        `);
      }
      if (a.rescheduledToId) {
        await tx.execute(sqlRaw`
          UPDATE appointments SET rescheduled_to_id = ${a.rescheduledToId}
          WHERE id = ${a.id} AND clinic_id = ${clinicId}
        `);
      }
    }

    // Trilha de status — é o que dá credibilidade ao histórico
    const history: unknown[] = [];
    for (const a of appointments) {
      const startsAt = apptStartsAt(a);
      const created = new Date(startsAt.getTime() - int(2, 20) * 86_400_000);
      history.push({
        clinicId,
        appointmentId: a.id,
        fromStatus: null,
        toStatus: "scheduled",
        source: a.origin === "ai_agent" ? "ai_agent" : a.origin === "online_booking" ? "customer_whatsapp" : "user",
        changedByUserId: a.origin === "manual" ? ownerId : null,
        createdAt: created,
      });
      if (a.status !== "scheduled") {
        history.push({
          clinicId,
          appointmentId: a.id,
          fromStatus: "scheduled",
          toStatus: "confirmed",
          source: "customer_whatsapp",
          createdAt: new Date(startsAt.getTime() - 20 * 3_600_000),
        });
      }
      if (a.status !== "scheduled" && a.status !== "confirmed") {
        history.push({
          clinicId,
          appointmentId: a.id,
          fromStatus: "confirmed",
          toStatus: a.status,
          source: a.status === "showed" ? "user" : a.status === "no_show" ? "system" : "user",
          changedByUserId: a.status === "showed" ? ownerId : null,
          reason: a.cancelReason,
          createdAt: new Date(startsAt.getTime() + 30 * 60_000),
        });
      }
    }
    await insertMany(tx, schema.appointmentStatusHistory, history);
  });

  const showed = appointments.filter((a) => a.status === "showed");
  log(
    `${appointments.length} atendimentos (${showed.length} realizados, ` +
      `${appointments.filter((a) => a.status === "no_show").length} faltas, ` +
      `${appointments.filter((a) => a.dateISO >= TODAY).length} futuros).`,
  );

  // ═════════════════════════════════════════════════════════════════
  console.log("▸ Financeiro, comissões e estoque movimentado");
  // ═════════════════════════════════════════════════════════════════
  // Consumo de estoque a partir dos atendimentos realizados
  const consumption = new Map<number, number>(); // stockIdx -> total consumido
  await withTenant(clinicId, async (tx) => {
    const movements: unknown[] = [];
    for (const a of showed) {
      const startsAt = apptStartsAt(a);
      STOCK.forEach((s, si) => {
        const use = s.usedBy.find(([p]) => p === a.procIdx);
        if (!use) return;
        consumption.set(si, (consumption.get(si) ?? 0) + use[1]);
        movements.push({
          clinicId,
          stockItemId: stockItemIds[si]!,
          kind: "procedure_use" as const,
          quantity: money(-use[1]),
          appointmentId: a.id,
          createdAt: startsAt,
        });
      });
    }
    await insertMany(tx, schema.stockMovements, movements);
  });

  // Compras mensais de insumos — cobrem o consumo com folga, menos 2 itens
  // deixados de propósito abaixo do mínimo (o alerta de estoque baixo tem
  // que aparecer na demo)
  const LOW_STOCK = new Set([0, 8]); // Toxina e Anestésico ficam baixos
  /**
   * Folga de compra: item caro (injetável) se compra quase justo — ninguém
   * deixa R$ 800 a seringa parados na geladeira. Descartável se compra com
   * folga. Sem isso o CMV da demo fica maior que a folha de pagamento.
   */
  const buffer = (si: number) =>
    LOW_STOCK.has(si) ? 1 : STOCK[si]!.cost >= 300 ? 1.08 : 1.35;
  /** Sobra final: os itens "baixos" ficam sob o mínimo, mas nunca negativos. */
  const leftover = (si: number) =>
    LOW_STOCK.has(si) ? STOCK[si]!.minQuantity * 0.4 : STOCK[si]!.minQuantity * 1.5;
  const purchaseMonths: string[] = [];
  for (let m = 5; m >= 0; m--) {
    const d = new Date(`${TODAY}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - m, 3);
    purchaseMonths.push(d.toISOString().slice(0, 10));
  }
  const supplyPayables: unknown[] = [];
  await withTenant(clinicId, async (tx) => {
    const purchases: unknown[] = [];
    STOCK.forEach((s, si) => {
      const total = consumption.get(si) ?? 0;
      const target = total * buffer(si) + leftover(si);
      const perMonth = target / purchaseMonths.length;
      purchaseMonths.forEach((date, mi) => {
        const qty = Math.max(
          s.unit === "un" || s.unit === "pct" ? Math.ceil(perMonth) : Number(perMonth.toFixed(2)),
          0,
        );
        if (qty <= 0) return;
        purchases.push({
          clinicId,
          stockItemId: stockItemIds[si]!,
          kind: "purchase" as const,
          quantity: money(qty),
          unitCost: money(s.cost),
          notes: mi === 0 ? "Compra inicial de implantação" : "Reposição mensal",
          createdBy: ownerId,
          createdAt: new Date(`${date}T12:00:00Z`),
        });
      });
    });
    // Perdas e ajustes — inventário de verdade tem os dois
    purchases.push(
      {
        clinicId,
        stockItemId: stockItemIds[6]!,
        kind: "loss" as const,
        quantity: money(-3),
        notes: "Pacotes violados no transporte",
        createdBy: ownerId,
        createdAt: new Date(`${daysAgo(72)}T14:00:00Z`),
      },
      {
        clinicId,
        stockItemId: stockItemIds[10]!,
        kind: "adjustment" as const,
        quantity: money(-6),
        notes: "Acerto de inventário do mês",
        createdBy: ownerId,
        createdAt: new Date(`${daysAgo(31)}T18:00:00Z`),
      },
      {
        clinicId,
        stockItemId: stockItemIds[1]!,
        kind: "loss" as const,
        quantity: money(-1),
        notes: "Seringa perdeu a validade",
        createdBy: ownerId,
        createdAt: new Date(`${daysAgo(15)}T11:00:00Z`),
      },
    );
    await insertMany(tx, schema.stockMovements, purchases);

    // Cada compra mensal também é uma conta a pagar de insumos
    purchaseMonths.forEach((date, mi) => {
      let total = 0;
      STOCK.forEach((s, si) => {
        const consumed = consumption.get(si) ?? 0;
        const target = consumed * buffer(si) + leftover(si);
        total += (target / purchaseMonths.length) * s.cost;
      });
      const paid = date < daysAgo(3);
      supplyPayables.push({
        clinicId,
        description: `Insumos — compra de ${monthOf(date)}`,
        supplier: pick(["Distribuidora Dermare", "MedSupply Brasil", "Estética Prime"]),
        categoryId: expenseCatIds.get("Insumos")!,
        amount: money(Math.round(total * 100) / 100),
        dueDate: addDaysISO(date, 7),
        paidAt: paid ? addDaysISO(date, 7) : null,
        status: paid ? ("paid" as const) : ("pending" as const),
        createdBy: ownerId,
        createdAt: new Date(`${date}T12:00:00Z`),
      });
      void mi;
    });
  });

  // ── Contas a receber ────────────────────────────────────────────
  const PAYMENT_METHODS = [
    { m: "pix" as const, w: 0.36, fee: 0 },
    { m: "credit" as const, w: 0.3, fee: 0.0309 },
    { m: "debit" as const, w: 0.17, fee: 0.0149 },
    { m: "cash" as const, w: 0.12, fee: 0 },
    { m: "transfer" as const, w: 0.05, fee: 0 },
  ];
  function paymentMethod() {
    let r = rnd();
    for (const p of PAYMENT_METHODS) {
      if (r < p.w) return p;
      r -= p.w;
    }
    return PAYMENT_METHODS[0]!;
  }

  await withTenant(clinicId, async (tx) => {
    const rows: unknown[] = [];

    // 1) Atendimentos realizados que NÃO são de pacote
    for (const a of showed) {
      if (a.customerPackageId) continue;
      if (a.price <= 0) continue;
      const c = customers[a.customerIdx]!;
      const spec = PROCEDURES[a.procIdx]!;
      const pm = paymentMethod();
      const parcelas = pm.m === "credit" && a.price >= 900 ? (a.price >= 2000 ? 6 : 3) : 1;
      const valorParcela = Math.round((a.price / parcelas) * 100) / 100;
      for (let n = 1; n <= parcelas; n++) {
        const dueDate = addDaysISO(a.dateISO, (n - 1) * 30);
        const received = dueDate <= TODAY && chance(0.97);
        const fee = Math.round(valorParcela * pm.fee * 100) / 100;
        rows.push({
          clinicId,
          customerId: c.id,
          appointmentId: n === 1 ? a.id : null,
          categoryId: incomeCatIds.get("Procedimentos")!,
          description:
            `${spec.name} — ${c.name}` + (parcelas > 1 ? ` (${n}/${parcelas})` : ""),
          grossAmount: money(valorParcela),
          feeAmount: money(fee),
          netAmount: money(Math.round((valorParcela - fee) * 100) / 100),
          method: pm.m,
          installmentNumber: n,
          installmentTotal: parcelas,
          dueDate,
          receivedAt: received ? dueDate : null,
          status: received ? ("received" as const) : ("pending" as const),
          createdAt: new Date(`${a.dateISO}T${hhmm(a.startMin)}:00Z`),
        });
      }
    }

    // 2) Venda dos pacotes
    for (const c of customers) {
      const pkg = customerPackages.get(c.id);
      if (!pkg || !c.packagePurchasedOn) continue;
      const pm = chance(0.65)
        ? { m: "credit" as const, fee: 0.0309 }
        : { m: "pix" as const, fee: 0 };
      const parcelas = pm.m === "credit" ? 3 : 1;
      const valorParcela = Math.round((pkg.pricePaid / parcelas) * 100) / 100;
      for (let n = 1; n <= parcelas; n++) {
        const dueDate = addDaysISO(c.packagePurchasedOn, (n - 1) * 30);
        const received = dueDate <= TODAY;
        const fee = Math.round(valorParcela * pm.fee * 100) / 100;
        rows.push({
          clinicId,
          customerId: c.id,
          customerPackageId: pkg.id,
          categoryId: incomeCatIds.get("Pacotes")!,
          description:
            `${PACKAGES[c.packageIdx!]!.name} — ${c.name}` +
            (parcelas > 1 ? ` (${n}/${parcelas})` : ""),
          grossAmount: money(valorParcela),
          feeAmount: money(fee),
          netAmount: money(Math.round((valorParcela - fee) * 100) / 100),
          method: pm.m,
          installmentNumber: n,
          installmentTotal: parcelas,
          dueDate,
          receivedAt: received ? dueDate : null,
          status: received ? ("received" as const) : ("pending" as const),
          createdAt: new Date(`${c.packagePurchasedOn}T14:00:00Z`),
        });
      }
    }

    // 3) Venda de produtos no balcão (dermocosméticos)
    const PRODUCTS = [
      ["Protetor solar facial FPS 60", 149],
      ["Sérum de vitamina C 30ml", 219],
      ["Hidratante corporal ureia 10%", 89],
      ["Ácido hialurônico tópico", 189],
      ["Kit pós-procedimento", 129],
    ] as const;
    const buyers = customers.filter((x) => x.visitDates.length > 0);
    for (let i = 0; i < 180; i++) {
      const c = pick(buyers);
      const [name, price] = pick(PRODUCTS);
      const date = daysAgo(int(0, DAYS_BACK));
      const pm = paymentMethod();
      const fee = Math.round(price * pm.fee * 100) / 100;
      rows.push({
        clinicId,
        customerId: c.id,
        categoryId: incomeCatIds.get("Produtos")!,
        description: `${name} — ${c.name}`,
        grossAmount: money(price),
        feeAmount: money(fee),
        netAmount: money(Math.round((price - fee) * 100) / 100),
        method: pm.m,
        dueDate: date,
        receivedAt: date,
        status: "received" as const,
        createdAt: new Date(`${date}T16:00:00Z`),
      });
    }
    await insertMany(tx, schema.receivables, rows);
    log(`${rows.length} lançamentos em contas a receber.`);
  });

  // ── Sessões de pacote consumidas ────────────────────────────────
  await withTenant(clinicId, async (tx) => {
    const uses: unknown[] = [];
    const counters = new Map<string, number>();
    for (const a of showed) {
      if (!a.customerPackageId) continue;
      const c = customers[a.customerIdx]!;
      const pkg = customerPackages.get(c.id);
      if (!pkg) continue;
      const used = counters.get(pkg.id) ?? 0;
      if (used >= pkg.total) continue;
      counters.set(pkg.id, used + 1);
      uses.push({
        clinicId,
        customerPackageId: pkg.id,
        appointmentId: a.id,
        usedAt: apptStartsAt(a),
      });
    }
    await insertMany(tx, schema.packageSessionUses, uses);
    for (const [pkgId, used] of counters) {
      const pkg = [...customerPackages.values()].find((p) => p.id === pkgId)!;
      await tx
        .update(schema.customerPackages)
        .set({
          sessionsUsed: used,
          status: used >= pkg.total ? "completed" : "active",
          updatedAt: new Date(),
        })
        .where(eq(schema.customerPackages.id, pkgId));
    }
    log(`${uses.length} sessões de pacote debitadas.`);
  });

  // ── Comissões ───────────────────────────────────────────────────
  await withTenant(clinicId, async (tx) => {
    const entries: Array<{ row: Record<string, unknown>; profIdx: number; dateISO: string; amount: number }> = [];
    for (const a of showed) {
      const spec = PROCEDURES[a.procIdx]!;
      const c = customers[a.customerIdx]!;
      const pkg = a.customerPackageId ? customerPackages.get(c.id) : undefined;
      const base = pkg ? pkg.pricePaid / pkg.total : a.price;
      if (base <= 0) continue;
      let amount: number;
      let source: string;
      if (a.procIdx === 8 && a.professionalIdx === 0) {
        amount = 600;
        source = "regra específica";
      } else {
        amount = (base * PROFESSIONALS[a.professionalIdx]!.commissionPct) / 100;
        source = "regra geral";
      }
      amount = Math.round(amount * 100) / 100;
      if (amount <= 0) continue;
      entries.push({
        profIdx: a.professionalIdx,
        dateISO: a.dateISO,
        amount,
        row: {
          clinicId,
          professionalId: professionalIds[a.professionalIdx]!,
          appointmentId: a.id,
          customerId: c.id,
          procedureId: procedureIds[a.procIdx]!,
          baseAmount: money(base),
          commissionAmount: money(amount),
          ruleSource: source,
          status: "pending",
          createdAt: apptStartsAt(a),
        },
      });
    }

    // Meses fechados viram pagamento (com a despesa correspondente)
    const closedMonths = new Set<string>();
    for (let m = 5; m >= 1; m--) {
      const d = new Date(`${TODAY}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - m, 1);
      closedMonths.add(d.toISOString().slice(0, 7));
    }
    const groups = new Map<string, { profIdx: number; month: string; total: number; count: number }>();
    for (const e of entries) {
      const month = monthOf(e.dateISO);
      if (!closedMonths.has(month)) continue;
      const key = `${e.profIdx}|${month}`;
      const g = groups.get(key) ?? { profIdx: e.profIdx, month, total: 0, count: 0 };
      g.total += e.amount;
      g.count++;
      groups.set(key, g);
    }

    const paymentIdByKey = new Map<string, string>();
    const payments: unknown[] = [];
    const commissionPayables: unknown[] = [];
    for (const [key, g] of groups) {
      const paymentId = randomUUID();
      const payableId = randomUUID();
      paymentIdByKey.set(key, paymentId);
      const paidOn = `${g.month}-28`;
      payments.push({
        id: paymentId,
        clinicId,
        professionalId: professionalIds[g.profIdx]!,
        totalAmount: money(Math.round(g.total * 100) / 100),
        entryCount: g.count,
        payableId,
        paidAt: paidOn,
        createdBy: ownerId,
        createdAt: new Date(`${paidOn}T18:00:00Z`),
      });
      commissionPayables.push({
        id: payableId,
        clinicId,
        description: `Comissões ${PROFESSIONALS[g.profIdx]!.name} — ${g.month}`,
        supplier: PROFESSIONALS[g.profIdx]!.name,
        categoryId: expenseCatIds.get("Comissões")!,
        amount: money(Math.round(g.total * 100) / 100),
        dueDate: paidOn,
        paidAt: paidOn,
        status: "paid" as const,
        createdBy: ownerId,
        createdAt: new Date(`${paidOn}T18:00:00Z`),
      });
    }
    await insertMany(tx, schema.payables, commissionPayables);
    await insertMany(tx, schema.commissionPayments, payments);

    const rows = entries.map((e) => {
      const key = `${e.profIdx}|${monthOf(e.dateISO)}`;
      const paymentId = paymentIdByKey.get(key);
      return { ...e.row, status: paymentId ? "paid" : "pending", paymentId: paymentId ?? null };
    });
    await insertMany(tx, schema.commissionEntries, rows);
    log(`${rows.length} comissões apuradas (${payments.length} fechamentos pagos).`);
  });

  // ── Contas a pagar fixas ────────────────────────────────────────
  await withTenant(clinicId, async (tx) => {
    const rows: unknown[] = [...supplyPayables];
    const FIXED: Array<[string, string, number, number, string | null]> = [
      // descrição, categoria, valor, dia do vencimento, fornecedor
      ["Aluguel da sala comercial", "Aluguel", 6800, 5, "Adm. Predial Lorena"],
      // As profissionais ganham por comissão; a folha é recepção + auxiliar
      ["Folha de pagamento", "Folha de pagamento", 9800, 5, null],
      ["Energia elétrica", "Energia e água", 0, 12, "Enel SP"],
      ["Internet e telefonia", "Software e assinaturas", 320, 15, "Vivo Empresas"],
      ["Assinatura ClinicaOS", "Software e assinaturas", 397, 10, "ClinicaOS"],
      ["Tráfego pago (Meta Ads)", "Marketing", 2500, 20, "Meta Platforms"],
      ["Honorários contábeis", "Contabilidade", 690, 10, "Contabilize Assessoria"],
      ["Simples Nacional (DAS)", "Impostos", 0, 20, "Receita Federal"],
    ];
    // Vai até o mês QUE VEM: a tela de contas a pagar precisa ter conta em
    // aberto, senão a demo abre com o financeiro zerado
    for (let m = 5; m >= -1; m--) {
      const ref = new Date(`${TODAY}T12:00:00Z`);
      ref.setUTCMonth(ref.getUTCMonth() - m, 1);
      const month = ref.toISOString().slice(0, 7);
      // Faturamento do mês para dimensionar imposto
      const monthRevenue = showed
        .filter((a) => monthOf(a.dateISO) === month && !a.customerPackageId)
        .reduce((s, a) => s + a.price, 0);
      for (const [desc, cat, base, day, supplier] of FIXED) {
        let amount = base;
        if (desc === "Energia elétrica") amount = 720 + int(0, 380);
        if (desc === "Simples Nacional (DAS)") amount = Math.round(monthRevenue * 0.06);
        if (amount <= 0) continue;
        const dueDate = `${month}-${String(day).padStart(2, "0")}`;
        const paid = dueDate < daysAgo(2);
        rows.push({
          clinicId,
          description: `${desc} — ${month}`,
          supplier,
          categoryId: expenseCatIds.get(cat)!,
          amount: money(amount),
          dueDate,
          paidAt: paid ? dueDate : null,
          status: paid ? ("paid" as const) : ("pending" as const),
          createdBy: ownerId,
          createdAt: new Date(`${month}-01T12:00:00Z`),
        });
      }
    }
    await insertMany(tx, schema.payables, rows);
    log(`${rows.length} contas a pagar (6 meses de custos fixos e insumos).`);
  });

  // ═════════════════════════════════════════════════════════════════
  console.log("▸ Orçamentos, funil e campanhas");
  // ═════════════════════════════════════════════════════════════════
  await withTenant(clinicId, async (tx) => {
    const QUOTES: Array<{
      customerIdx: number;
      items: Array<{ kind: "procedure" | "package"; idx: number; qty: number }>;
      status: "sent" | "viewed" | "accepted" | "rejected" | "expired";
      daysAgoSent: number;
      discountPct: number;
      notes: string | null;
    }> = [];
    const withVisits = customers.map((c, i) => ({ c, i })).filter((x) => x.c.profile !== "lead");
    const leads = customers.map((c, i) => ({ c, i })).filter((x) => x.c.profile === "lead");
    const plan: Array<[(typeof QUOTES)[number]["status"], number]> = [
      ["accepted", 14],
      ["viewed", 7],
      ["sent", 6],
      ["rejected", 6],
      ["expired", 4],
    ];
    for (const [status, n] of plan) {
      for (let i = 0; i < n; i++) {
        const target = chance(0.35) && leads.length ? pick(leads) : pick(withVisits);
        const items: Array<{ kind: "procedure" | "package"; idx: number; qty: number }> = [];
        if (chance(0.45)) {
          items.push({ kind: "package", idx: int(0, PACKAGES.length - 1), qty: 1 });
        }
        const nProc = int(1, 3);
        for (let k = 0; k < nProc; k++) {
          items.push({ kind: "procedure", idx: int(0, PROCEDURES.length - 1), qty: int(1, 2) });
        }
        QUOTES.push({
          customerIdx: target.i,
          items,
          status,
          daysAgoSent: status === "expired" ? int(45, 120) : int(1, 40),
          discountPct: chance(0.5) ? pick([5, 8, 10, 12]) : 0,
          notes: chance(0.5)
            ? pick([
                "Condições válidas para pagamento à vista ou em até 3x sem juros.",
                "Protocolo montado na avaliação do dia — inclui retorno de acompanhamento.",
                "Valores promocionais de aniversário da clínica.",
                null,
              ])
            : null,
        });
      }
    }
    QUOTES.sort((a, b) => b.daysAgoSent - a.daysAgoSent);

    let quoteNumber = 0;
    const quoteRows: unknown[] = [];
    const itemRows: unknown[] = [];
    for (const q of QUOTES) {
      quoteNumber++;
      const quoteId = randomUUID();
      const c = customers[q.customerIdx]!;
      let subtotal = 0;
      for (const it of q.items) {
        const unit = it.kind === "package" ? PACKAGES[it.idx]!.price : PROCEDURES[it.idx]!.price;
        const total = unit * it.qty;
        subtotal += total;
        itemRows.push({
          clinicId,
          quoteId,
          kind: it.kind,
          procedureId: it.kind === "procedure" ? procedureIds[it.idx]! : null,
          packageId: it.kind === "package" ? packageIds[it.idx]! : null,
          description: it.kind === "package" ? PACKAGES[it.idx]!.name : PROCEDURES[it.idx]!.name,
          quantity: it.qty,
          unitPrice: money(unit),
          total: money(total),
        });
      }
      const discount = Math.round(subtotal * (q.discountPct / 100) * 100) / 100;
      const sentOn = daysAgo(q.daysAgoSent);
      const sentAt = new Date(`${sentOn}T15:00:00Z`);
      quoteRows.push({
        id: quoteId,
        clinicId,
        customerId: c.id,
        number: quoteNumber,
        status: q.status,
        validUntil: addDaysISO(sentOn, 15),
        subtotal: money(subtotal),
        discountAmount: money(discount),
        total: money(Math.round((subtotal - discount) * 100) / 100),
        notes: q.notes,
        publicToken: token(),
        sentAt,
        viewedAt:
          q.status === "sent" ? null : new Date(sentAt.getTime() + int(1, 40) * 3_600_000),
        acceptedAt:
          q.status === "accepted" ? new Date(sentAt.getTime() + int(4, 72) * 3_600_000) : null,
        convertedAt:
          q.status === "accepted" && chance(0.7)
            ? new Date(sentAt.getTime() + int(24, 96) * 3_600_000)
            : null,
        createdBy: ownerId,
        createdAt: sentAt,
      });
    }
    await insertMany(tx, schema.quotes, quoteRows);
    await insertMany(tx, schema.quoteItems, itemRows);
    await tx.execute(sqlRaw`
      INSERT INTO clinic_counters (clinic_id, key, value) VALUES (${clinicId}, 'quote', ${quoteNumber})
      ON CONFLICT (clinic_id, key) DO UPDATE SET value = ${quoteNumber}
    `);
    log(`${quoteRows.length} orçamentos com ${itemRows.length} itens.`);
  });

  // ── Funil ───────────────────────────────────────────────────────
  await withTenant(clinicId, async (tx) => {
    const stageNames = ["Novo contato", "Conversando", "Proposta enviada", "Agendou avaliação"];
    const stageIds: string[] = [];
    for (let i = 0; i < stageNames.length; i++) {
      const [row] = await tx
        .insert(schema.pipelineStages)
        .values({ clinicId, name: stageNames[i]!, sort: i * 10 })
        .returning({ id: schema.pipelineStages.id });
      stageIds.push(row!.id);
    }
    const rows: unknown[] = [];
    const pool = shuffle(customers.map((c, i) => ({ c, i })));
    // Abertos, espalhados pelas colunas
    for (let i = 0; i < 22; i++) {
      const { c } = pool[i]!;
      const createdOn = daysAgo(int(1, 45));
      rows.push({
        clinicId,
        customerId: c.id,
        stageId: stageIds[int(0, 3)]!,
        value: money(pick([690, 890, 1290, 1450, 1690, 2200, 2800])),
        source: pick(SOURCES),
        notes: chance(0.5)
          ? pick([
              "Veio pelo anúncio de harmonização.",
              "Quer começar depois do casamento da irmã.",
              "Pediu orçamento de pacote corporal.",
              "Já é cliente antiga, quer retomar.",
            ])
          : null,
        status: "open" as const,
        createdBy: ownerId,
        createdAt: new Date(`${createdOn}T10:00:00Z`),
      });
    }
    // Ganhos e perdidos, para o funil ter taxa de conversão
    for (let i = 22; i < 46; i++) {
      const { c } = pool[i]!;
      const createdOn = daysAgo(int(20, 120));
      const won = chance(0.55);
      rows.push({
        clinicId,
        customerId: c.id,
        stageId: stageIds[3]!,
        value: money(pick([690, 1290, 1450, 1690, 2200])),
        source: pick(SOURCES),
        status: won ? ("won" as const) : ("lost" as const),
        lostReason: won
          ? null
          : pick(["Preço acima do orçamento", "Foi para a concorrência", "Sumiu / parou de responder", "Adiou para o próximo semestre"]),
        wonAt: won ? new Date(`${addDaysISO(createdOn, int(2, 14))}T16:00:00Z`) : null,
        lostAt: won ? null : new Date(`${addDaysISO(createdOn, int(5, 25))}T16:00:00Z`),
        createdBy: ownerId,
        createdAt: new Date(`${createdOn}T10:00:00Z`),
      });
    }
    await insertMany(tx, schema.deals, rows);
    log(`${rows.length} negociações no funil.`);
  });

  // ═════════════════════════════════════════════════════════════════
  console.log("▸ WhatsApp: números, conversas e automações");
  // ═════════════════════════════════════════════════════════════════
  const instanceIds: string[] = [];
  await withTenant(clinicId, async (tx) => {
    const defs = [
      { label: "Principal (recepção)", phone: "+5511987654321", isPrimary: true },
      { label: "Campanhas e reativação", phone: "+5511987654322", isPrimary: false },
    ];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i]!;
      const [row] = await tx
        .insert(schema.whatsappInstances)
        .values({
          clinicId,
          evolutionInstanceName: `clinic-${clinicId.slice(0, 8)}-${i + 1}`,
          label: d.label,
          phoneE164: d.phone,
          isPrimary: d.isPrimary,
          status: "connected",
          webhookToken: token(),
          lastSeenAt: new Date(),
          createdAt: new Date(`${daysAgo(DAYS_BACK)}T12:00:00Z`),
        })
        .returning({ id: schema.whatsappInstances.id });
      instanceIds.push(row!.id);
    }
  });

  const conversationTargets = shuffle(
    customers.map((c, i) => ({ c, i })).filter((x) => x.c.profile !== "perdida"),
  ).slice(0, 42);
  /** Já têm conversa: não podem ganhar outra no mesmo número (jid é único). */
  const inConversation = new Set(conversationTargets.map((t) => t.c.id));

  await withTenant(clinicId, async (tx) => {
    const convRows: unknown[] = [];
    const msgRows: Array<Record<string, unknown>> = [];
    const approvalSeed: Array<{ messageId: string; customerId: string; body: string; automationId: string; context: string }> = [];

    conversationTargets.forEach((t, idx) => {
      const script = CONVERSATION_SCRIPTS[idx % CONVERSATION_SCRIPTS.length]!;
      const conversationId = randomUUID();
      const lastDaysAgo = idx < 6 ? 0 : idx < 12 ? int(1, 3) : int(4, 40);
      const baseTime = new Date(
        Date.parse(`${daysAgo(lastDaysAgo)}T${String(int(9, 18)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}:00Z`),
      );
      let cursor = new Date(baseTime.getTime() - script.turns.length * 4 * 60_000);
      let lastInbound: Date | null = null;

      for (const [author, raw] of script.turns) {
        cursor = new Date(cursor.getTime() + int(60, 320) * 1000);
        const body = raw
          .replaceAll("{{NOME}}", t.c.name)
          .replaceAll("{{PRIMEIRO}}", firstName(t.c.name));
        const inbound = author === "customer";
        if (inbound) lastInbound = cursor;
        msgRows.push({
          id: randomUUID(),
          clinicId,
          conversationId,
          direction: inbound ? "inbound" : "outbound",
          author,
          waMessageId: `demo_${randomBytes(8).toString("hex")}`,
          type: "text",
          body,
          status: inbound ? "received" : chance(0.85) ? "read" : "delivered",
          automationId: author === "automation" ? "reminder_24h" : null,
          sentAt: inbound ? null : cursor,
          createdAt: cursor,
        });
      }

      const unread = script.mode === "waiting_human" ? int(1, 2) : idx < 4 && chance(0.5) ? 1 : 0;
      convRows.push({
        id: conversationId,
        clinicId,
        instanceId: instanceIds[idx % 2 === 0 ? 0 : idx % 7 === 0 ? 1 : 0]!,
        remoteJid: `${t.c.phone.replace("+", "")}@s.whatsapp.net`,
        customerId: t.c.id,
        mode: script.mode,
        assignedUserId: script.mode === "human" ? ownerId : null,
        status: lastDaysAgo > 20 ? "closed" : "open",
        unreadCount: unread,
        lastMessageAt: cursor,
        lastInboundAt: lastInbound,
        aiContextSummary:
          script.mode === "waiting_human"
            ? "Cliente com dúvida clínica pós-procedimento — aguardando resposta humana."
            : null,
        createdAt: new Date(baseTime.getTime() - 3 * 3_600_000),
      });
    });

    await insertMany(tx, schema.conversations, convRows);
    await insertMany(tx, schema.messages, msgRows);
    log(`${convRows.length} conversas com ${msgRows.length} mensagens.`);

    // Mensagens à espera de aprovação (tela Aprovações)
    const pendingTargets = shuffle(
      customers
        .map((c, i) => ({ c, i }))
        .filter((x) => x.c.profile === "sumida" && !inConversation.has(x.c.id)),
    ).slice(0, 6);
    for (const t of pendingTargets) {
      const conversationId = randomUUID();
      const proc = PROCEDURES[t.c.favProc]!;
      const body =
        `Oi ${firstName(t.c.name)}! Faz um tempinho que a gente não se vê 💛 ` +
        `Seu último ${proc.name} foi há um tempo e já está na hora de renovar. ` +
        "Tenho horários essa semana — quer que eu reserve um pra você?";
      const messageId = randomUUID();
      await tx.insert(schema.conversations).values({
        id: conversationId,
        clinicId,
        instanceId: instanceIds[1]!,
        remoteJid: `${t.c.phone.replace("+", "")}@s.whatsapp.net`,
        customerId: t.c.id,
        mode: "ai",
        status: "open",
        unreadCount: 0,
        lastMessageAt: new Date(),
        createdAt: new Date(),
      });
      await tx.insert(schema.messages).values({
        id: messageId,
        clinicId,
        conversationId,
        direction: "outbound",
        author: "automation",
        type: "text",
        body,
        status: "pending_approval",
        automationId: "reactivation_smart",
        scheduledFor: new Date(Date.now() + 3_600_000),
        createdAt: new Date(Date.now() - int(1, 20) * 3_600_000),
      });
      approvalSeed.push({
        messageId,
        customerId: t.c.id,
        body,
        automationId: "reactivation_smart",
        context: `Última visita há ${diffDays(TODAY, t.c.visitDates.at(-1) ?? daysAgo(120))} dias · ${proc.name}`,
      });
    }
    await insertMany(
      tx,
      schema.approvals,
      approvalSeed.map((a) => ({
        clinicId,
        messageId: a.messageId,
        customerId: a.customerId,
        automationId: a.automationId,
        generatedBody: a.body,
        contextLine: a.context,
        status: "pending" as const,
        expiresAt: new Date(Date.now() + 48 * 3_600_000),
        createdAt: new Date(Date.now() - int(1, 20) * 3_600_000),
      })),
    );
    log(`${approvalSeed.length} mensagens aguardando aprovação.`);
  });

  // ── Campanhas ───────────────────────────────────────────────────
  await withTenant(clinicId, async (tx) => {
    const defs = [
      {
        name: "Reativação — clientes de 90+ dias",
        template:
          "Oi {{nome}}! Sentimos sua falta 💛 Preparamos uma condição especial de retorno: 20% off no seu próximo {{procedimento}}. Quer que eu reserve um horário?",
        status: "done" as const,
        daysAgoStart: 38,
        dailyCap: 25,
        pool: customers.filter((c) => c.profile === "sumida" || c.profile === "perdida"),
      },
      {
        name: "Mês da mulher — pacote corporal",
        template:
          "{{nome}}, o pacote de 10 sessões de Drenagem está por R$ 1.290 até o fim do mês 😍 Quer garantir o seu?",
        status: "running" as const,
        daysAgoStart: 4,
        dailyCap: 30,
        pool: customers.filter((c) => PROCEDURES[c.favProc]!.category === "Corporal"),
      },
      {
        name: "Aniversário da clínica — 6 meses",
        template:
          "{{nome}}, a clínica faz 6 meses e quem comemora é você 🎉 Toxina botulínica com condição especial nesta semana. Posso te contar mais?",
        status: "draft" as const,
        daysAgoStart: 0,
        dailyCap: 20,
        pool: customers.filter((c) => c.profile === "vip" || c.profile === "regular"),
      },
    ];
    for (const d of defs) {
      const recipients = shuffle(d.pool).slice(0, Math.min(d.pool.length, 30));
      const startedAt =
        d.status === "draft" ? null : new Date(`${daysAgo(d.daysAgoStart)}T09:00:00Z`);
      const [camp] = await tx
        .insert(schema.campaigns)
        .values({
          clinicId,
          name: d.name,
          messageTemplate: d.template,
          segment: { origem: "seed-showcase" },
          status: d.status,
          dailyCap: d.dailyCap,
          recipientCount: recipients.length,
          nextSendAt: d.status === "running" ? new Date(Date.now() + 90_000) : null,
          startedAt,
          finishedAt:
            d.status === "done" ? new Date(`${daysAgo(d.daysAgoStart - 3)}T18:00:00Z`) : null,
          createdBy: ownerId,
          createdAt: new Date(`${daysAgo(d.daysAgoStart + 1)}T15:00:00Z`),
        })
        .returning({ id: schema.campaigns.id });

      const rows = recipients.map((c, i) => {
        const sent =
          d.status === "done" ? !chance(0.08) : d.status === "running" ? i < recipients.length * 0.4 : false;
        return {
          clinicId,
          campaignId: camp!.id,
          customerId: c.id,
          status: sent ? ("sent" as const) : d.status === "done" ? ("skipped" as const) : ("pending" as const),
          sentAt: sent && startedAt ? new Date(startedAt.getTime() + i * 130_000) : null,
          skipReason: !sent && d.status === "done" ? "Cliente pediu para não receber campanhas" : null,
        };
      });
      await insertMany(tx, schema.campaignRecipients, rows);
    }
    log(`${defs.length} campanhas (1 concluída, 1 rodando, 1 rascunho).`);
  });

  // ── Automações: tudo ligado, o essencial já sem aprovação ───────
  await withTenant(clinicId, async (tx) => {
    // 6 meses de casa: a dona já confia — só o que fala de dinheiro/reativação
    // continua passando por revisão
    const REQUIRES_APPROVAL = new Set([
      "reactivation_smart",
      "reactivation_generic",
      "package_renewal_expiry",
      "package_renewal_sessions",
    ]);
    const defs = await tx.execute(sqlRaw`SELECT id FROM automation_definitions`);
    const ids = defs.rows.map((r) => (r as { id: string }).id);
    for (const automationId of ids) {
      await tx.execute(sqlRaw`
        INSERT INTO automation_settings (clinic_id, automation_id, enabled, requires_approval, updated_by, updated_at)
        VALUES (${clinicId}, ${automationId}, true, ${REQUIRES_APPROVAL.has(automationId)}, ${ownerId}, now())
        ON CONFLICT (clinic_id, automation_id)
        DO UPDATE SET enabled = true, requires_approval = EXCLUDED.requires_approval
      `);
    }

    // Histórico de disparos — a tela de automações precisa contar uma história
    const logRows: unknown[] = [];
    const sample = shuffle(showed).slice(0, Math.min(showed.length, 260));
    for (const a of sample) {
      const c = customers[a.customerIdx]!;
      const startsAt = apptStartsAt(a);
      logRows.push({
        clinicId,
        automationId: "reminder_24h",
        customerId: c.id,
        appointmentId: a.id,
        result: "sent" as const,
        detail: "Lembrete enviado 24h antes",
        createdAt: new Date(startsAt.getTime() - 24 * 3_600_000),
      });
      if (chance(0.75)) {
        logRows.push({
          clinicId,
          automationId: "post_visit",
          customerId: c.id,
          appointmentId: a.id,
          result: "sent" as const,
          detail: "Pós-atendimento com cuidados enviados",
          createdAt: new Date(startsAt.getTime() + 2 * 3_600_000),
        });
      }
      if (chance(0.35)) {
        logRows.push({
          clinicId,
          automationId: "feedback_request",
          customerId: c.id,
          appointmentId: a.id,
          result: chance(0.85) ? ("sent" as const) : ("skipped" as const),
          detail: "Pedido de avaliação no Google",
          createdAt: new Date(startsAt.getTime() + 26 * 3_600_000),
        });
      }
    }
    for (const a of appointments.filter((x) => x.status === "no_show")) {
      const c = customers[a.customerIdx]!;
      const startsAt = apptStartsAt(a);
      logRows.push({
        clinicId,
        automationId: "no_show_message",
        customerId: c.id,
        appointmentId: a.id,
        result: "sent" as const,
        detail: "Mensagem de falta enviada",
        createdAt: new Date(startsAt.getTime() + 40 * 60_000),
      });
      if (chance(0.5)) {
        logRows.push({
          clinicId,
          automationId: "no_show_followup",
          customerId: c.id,
          appointmentId: a.id,
          result: chance(0.4) ? ("goal_reached" as const) : ("sent" as const),
          detail: "Follow-up de reagendamento",
          createdAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        });
      }
    }
    await insertMany(tx, schema.automationLog, logRows);

    // Cadências ativas para os atendimentos futuros
    const future = appointments.filter((a) => a.dateISO > TODAY);
    const runs = future.slice(0, 60).map((a) => {
      const startsAt = apptStartsAt(a);
      return {
        clinicId,
        automationId: "reminder_24h",
        customerId: customers[a.customerIdx]!.id,
        appointmentId: a.id,
        currentStep: 0,
        status: "active" as const,
        nextRunAt: new Date(startsAt.getTime() - 24 * 3_600_000),
        startedAt: new Date(),
      };
    });
    await insertMany(tx, schema.automationRuns, runs);
    log(`${ids.length} automações ligadas, ${logRows.length} disparos no histórico.`);
  });

  // ═════════════════════════════════════════════════════════════════
  console.log("▸ Termos assinados, uso de IA e avisos");
  // ═════════════════════════════════════════════════════════════════
  await withTenant(clinicId, async (tx) => {
    const variables = extractVariables(DEFAULT_CONSENT_TEMPLATE.bodyText);
    const [tpl] = await tx
      .insert(schema.documentTemplates)
      .values({
        clinicId,
        name: DEFAULT_CONSENT_TEMPLATE.name,
        kind: "consent",
        bodyText: DEFAULT_CONSENT_TEMPLATE.bodyText,
        variables,
        createdBy: ownerId,
      })
      .returning({ id: schema.documentTemplates.id });

    // Termo para todo procedimento injetável realizado (amostra)
    const injectables = showed.filter((a) => [4, 5, 6, 7, 8].includes(a.procIdx));
    const chosen = shuffle(injectables).slice(0, Math.min(injectables.length, 60));
    const docRows: unknown[] = [];
    const sigRows: unknown[] = [];
    const auditRows: unknown[] = [];
    for (const a of chosen) {
      const c = customers[a.customerIdx]!;
      const spec = PROCEDURES[a.procIdx]!;
      const startsAt = apptStartsAt(a);
      const values = {
        nome: c.name,
        cpf: cpfDigits(a.customerIdx + 1),
        telefone: c.phone,
        endereco: "São Paulo/SP",
        clinica: account!.clinicName,
        procedimento: spec.name,
        valor: money(spec.price),
        data: a.dateISO.split("-").reverse().join("/"),
      };
      const html = renderTermHtml(DEFAULT_CONSENT_TEMPLATE.bodyText, values);
      const hash = sha256Hex(html);
      const docId = randomUUID();
      const signed = chance(0.87);
      const sentAt = new Date(startsAt.getTime() - 3 * 3_600_000);
      const signedAt = new Date(startsAt.getTime() - 40 * 60_000);
      docRows.push({
        id: docId,
        clinicId,
        customerId: c.id,
        templateId: tpl!.id,
        procedureId: procedureIds[a.procIdx]!,
        appointmentId: a.id,
        title: `${DEFAULT_CONSENT_TEMPLATE.name} — ${spec.name}`,
        bodyHtmlRendered: html,
        variablesSnapshot: values,
        contentSha256: hash,
        status: signed ? ("signed" as const) : ("viewed" as const),
        signToken: token(),
        tokenExpiresAt: new Date(startsAt.getTime() + 30 * 86_400_000),
        sentAt,
        viewedAt: new Date(sentAt.getTime() + 20 * 60_000),
        signedAt: signed ? signedAt : null,
        createdBy: ownerId,
        createdAt: sentAt,
      });
      auditRows.push(
        { clinicId, documentId: docId, event: "created" as const, createdAt: sentAt },
        { clinicId, documentId: docId, event: "sent" as const, createdAt: sentAt },
        {
          clinicId,
          documentId: docId,
          event: "link_opened" as const,
          ip: "191.180.22.14",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)",
          createdAt: new Date(sentAt.getTime() + 20 * 60_000),
        },
      );
      if (signed) {
        auditRows.push({
          clinicId,
          documentId: docId,
          event: "signed" as const,
          ip: "191.180.22.14",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)",
          createdAt: signedAt,
        });
        sigRows.push({
          clinicId,
          documentId: docId,
          signerName: c.name,
          signerCpf: values.cpf,
          signatureKind: chance(0.7) ? ("drawn" as const) : ("typed" as const),
          signatureImage: null,
          signedAt,
          ip: "191.180.22.14",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)",
          contentSha256: hash,
          evidence: { origem: "link público", versao_termo: 1 },
        });
      }
    }
    await insertMany(tx, schema.documents, docRows);
    await insertMany(tx, schema.documentSignatures, sigRows);
    await insertMany(tx, schema.documentAuditLog, auditRows);
    log(`${docRows.length} termos (${sigRows.length} assinados).`);
  });

  // ── Uso de IA (custo por mês na tela de configurações) ──────────
  await withTenant(clinicId, async (tx) => {
    const agentModel = aiProvider?.agentModel ?? "gpt-4o";
    const classifierModel = aiProvider?.classifierModel ?? "gpt-4o-mini";
    const rows: unknown[] = [];
    for (let d = DAYS_BACK; d >= 0; d--) {
      const date = daysAgo(d);
      if (dow(date) === 0) continue;
      const turns = int(4, 26);
      for (let i = 0; i < turns; i++) {
        rows.push({
          clinicId,
          purpose: "agent",
          model: agentModel,
          inputTokens: int(900, 3400),
          outputTokens: int(60, 320),
          createdAt: new Date(`${date}T${String(int(8, 19)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}:00Z`),
        });
      }
      for (let i = 0; i < int(3, 14); i++) {
        rows.push({
          clinicId,
          purpose: "classify",
          model: classifierModel,
          inputTokens: int(180, 520),
          outputTokens: int(8, 40),
          createdAt: new Date(`${date}T${String(int(8, 19)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}:00Z`),
        });
      }
    }
    await insertMany(tx, schema.aiUsage, rows, 500);
    log(`${rows.length} registros de uso de IA (${agentModel} / ${classifierModel}).`);
  });

  // ── Bloqueios de agenda, avisos e scores ────────────────────────
  await withTenant(clinicId, async (tx) => {
    const blocks: unknown[] = [];
    for (const h of HOLIDAYS) {
      blocks.push({
        clinicId,
        professionalId: null,
        startsAt: zonedToUtc(h, "00:00", TZ),
        endsAt: zonedToUtc(h, "23:59", TZ),
        reason: "Feriado — clínica fechada",
        createdBy: ownerId,
      });
    }
    // Férias da Bruna, já passadas
    blocks.push({
      clinicId,
      professionalId: professionalIds[2]!,
      startsAt: zonedToUtc(daysAgo(58), "08:00", TZ),
      endsAt: zonedToUtc(daysAgo(51), "20:00", TZ),
      reason: "Férias",
      createdBy: ownerId,
    });
    // Congresso da Dra. Renata, na semana que vem
    blocks.push({
      clinicId,
      professionalId: professionalIds[0]!,
      startsAt: zonedToUtc(addDaysISO(TODAY, 9), "08:00", TZ),
      endsAt: zonedToUtc(addDaysISO(TODAY, 10), "20:00", TZ),
      reason: "Congresso de harmonização facial",
      createdBy: ownerId,
    });
    await insertMany(tx, schema.scheduleBlocks, blocks);

    await insertMany(tx, schema.notifications, [
      {
        clinicId,
        userId: null,
        type: "conversation_needs_human",
        title: "Conversa esperando atendimento humano",
        body: "Uma cliente com dúvida pós-procedimento pediu para falar com a equipe.",
        createdAt: new Date(Date.now() - 40 * 60_000),
      },
      {
        clinicId,
        userId: null,
        type: "stock_low",
        title: "Estoque baixo",
        body: "Toxina botulínica 100U e Anestésico tópico estão abaixo do mínimo.",
        createdAt: new Date(Date.now() - 5 * 3_600_000),
      },
      {
        clinicId,
        userId: null,
        type: "approvals_pending",
        title: "5 mensagens aguardando sua revisão",
        body: "Campanha de reativação pronta para enviar.",
        createdAt: new Date(Date.now() - 9 * 3_600_000),
      },
    ]);

    const n = await recomputeScores(tx, clinicId, TZ);
    log(`Scores recalculados para ${n} clientes.`);
  });

  // ── Resumo ──────────────────────────────────────────────────────
  const totals = await withTenant(clinicId, async (tx) => {
    const r = await tx.execute(sqlRaw`
      SELECT
        (SELECT count(*) FROM customers WHERE clinic_id = ${clinicId} AND deleted_at IS NULL) AS clientes,
        (SELECT count(*) FROM appointments WHERE clinic_id = ${clinicId}) AS atendimentos,
        (SELECT coalesce(sum(net_amount),0) FROM receivables
          WHERE clinic_id = ${clinicId} AND status = 'received') AS recebido,
        (SELECT coalesce(sum(amount),0) FROM payables
          WHERE clinic_id = ${clinicId} AND status = 'paid') AS pago,
        (SELECT count(*) FROM quotes WHERE clinic_id = ${clinicId}) AS orcamentos,
        (SELECT count(*) FROM messages WHERE clinic_id = ${clinicId}) AS mensagens
    `);
    return r.rows[0] as Record<string, string | number>;
  });

  const brl = (v: string | number) =>
    Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  console.log("\n═══ Demo pronta ═══\n");
  console.log(`  Clínica ......... ${account.clinicName}`);
  console.log(`  Login ........... ${account.email}`);
  console.log(`  Clientes ........ ${totals.clientes}`);
  console.log(`  Atendimentos .... ${totals.atendimentos} (6 meses + 3 semanas à frente)`);
  console.log(`  Recebido ........ ${brl(totals.recebido!)}`);
  console.log(`  Pago ............ ${brl(totals.pago!)}`);
  console.log(`  Orçamentos ...... ${totals.orcamentos}`);
  console.log(`  Mensagens ....... ${totals.mensagens}`);
  console.log(`  Agendamento on-line: /agendar/${bookingSlug}`);
  console.log(
    `  IA .............. ${aiProvider ? `${aiProvider.provider} · ${aiProvider.agentModel}` : "padrão do sistema"}\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
