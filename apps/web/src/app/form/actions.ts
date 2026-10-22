"use server";

import { headers } from "next/headers";
import {
  ONBOARDING_FORM_VERSION,
  missingRequired,
  onboardingSummary,
  sanitizeOnboardingAnswers,
} from "@clinicaos/core/onboarding-form";
import { schema, unsafeGlobalDb } from "@clinicaos/db";

export type SubmitResult = { ok: true; id: string } | { ok: false; error: string; missing?: string[] };

// Freio simples (por processo): a página é pública e sem login. Chave por /64 no IPv6
// (um cliente costuma ter o /64 inteiro) e por IP exato no IPv4, mais um teto global por
// hora para que rotação de endereços não ajude. O Caddy reescreve o X-Forwarded-For.
const recent = new Map<string, number[]>();
let globalHits: number[] = [];
const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 6;
const MAX_GLOBAL_PER_WINDOW = 60;
const MAX_KEYS = 5000;

function limiterKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map((x) => x.toLowerCase().padStart(4, "0")).join(":") + "::/64";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < WINDOW_MS);
  if (globalHits.length >= MAX_GLOBAL_PER_WINDOW) return true;
  const key = limiterKey(ip);
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return true;
  hits.push(now);
  globalHits.push(now);
  recent.delete(key);
  recent.set(key, hits); // reinserir = vai para o fim (ordem de inserção do Map)
  while (recent.size > MAX_KEYS) {
    const oldest = recent.keys().next().value;
    if (oldest === undefined) break;
    recent.delete(oldest);
  }
  return false;
}

/** Grava o formulário de implantação respondido (página pública /form). */
export async function submitOnboardingForm(raw: unknown, honeypot: string): Promise<SubmitResult> {
  if (honeypot) return { ok: true, id: "ok" }; // robô: finge que deu certo e descarta
  const h = await headers();
  const rawIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const ip = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+)$/.test(rawIp) ? rawIp : "";
  if (rateLimited(ip || "sem-ip")) return { ok: false, error: "Muitos envios seguidos. Aguarde alguns minutos e tente de novo." };

  const serialized = JSON.stringify(raw ?? {});
  if (serialized.length > 400_000) return { ok: false, error: "O formulário ficou grande demais. Reduza os textos e tente de novo." };

  const answers = sanitizeOnboardingAnswers(raw);
  const missing = missingRequired(answers);
  if (missing.length > 0) return { ok: false, error: "Faltam respostas obrigatórias.", missing };

  const s = onboardingSummary(answers);
  const [row] = await unsafeGlobalDb()
    .insert(schema.onboardingForms)
    .values({
      clinicName: s.clinicName,
      contactName: s.contactName || null,
      contactEmail: s.contactEmail || null,
      contactPhone: s.contactPhone || null,
      answers,
      formVersion: ONBOARDING_FORM_VERSION,
      ip: ip || null,
      userAgent: (h.get("user-agent") ?? "").slice(0, 300) || null,
    })
    .returning({ id: schema.onboardingForms.id });
  if (!row) return { ok: false, error: "Não consegui gravar agora. Tente de novo em instantes." };
  return { ok: true, id: row.id };
}
