"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createLlmClient, resolveClinicAiConfig } from "@clinicaos/ai/provider";
import { schema, type Tx } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface KbSaveResult {
  ok: boolean;
  error?: string;
  /** Possíveis contradições encontradas — o dono decide se salva mesmo assim. */
  warnings?: string[];
  entryId?: string;
}

// ── Ficha da clínica (vai INTEIRA no prompt da assistente) ───────────

const factsSchema = z.object({
  comoChegar: z.string().trim().max(600).default(""),
  estacionamento: z.string().trim().max(600).default(""),
  pagamento: z.string().trim().max(600).default(""),
  convenios: z.string().trim().max(600).default(""),
  cancelamento: z.string().trim().max(600).default(""),
  observacoes: z.string().trim().max(1200).default(""),
});

export const saveKnowledgeFacts = authAction({
  permission: "settings.manage",
  schema: factsSchema,
  handler: async (input, { auth, tx }): Promise<KbSaveResult> => {
    await tx.execute(sql`
      UPDATE clinics SET settings = settings || jsonb_build_object('knowledge', jsonb_build_object(
        'comoChegar', ${input.comoChegar}::text,
        'estacionamento', ${input.estacionamento}::text,
        'pagamento', ${input.pagamento}::text,
        'convenios', ${input.convenios}::text,
        'cancelamento', ${input.cancelamento}::text,
        'observacoes', ${input.observacoes}::text
      ))
      WHERE id = ${auth.clinicId}
    `);
    revalidatePath("/conhecimento");
    return { ok: true };
  },
});

// ── Cards de conhecimento ────────────────────────────────────────────

const entrySchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["faq", "servico", "politica", "outro"]).default("faq"),
  title: z.string().trim().min(3).max(120),
  content: z.string().trim().min(10).max(2000),
  active: z.boolean().default(true),
  /** true = o dono viu os avisos de contradição e mandou salvar mesmo assim. */
  force: z.boolean().default(false),
});

function parsePrecosBR(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)) {
    const n = Number(m[1]!.replaceAll(".", "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Checagens mecânicas: preço/duração divergente do catálogo, horário
 *  duplicado, card parecido já existente. Rápidas e determinísticas. */
async function checagemMecanica(
  tx: Tx,
  clinicId: string,
  entry: { id?: string; title: string; content: string },
): Promise<string[]> {
  const warnings: string[] = [];
  const texto = `${entry.title}\n${entry.content}`;
  const textoNorm = semAcento(texto);

  const procedures = await tx
    .select({
      name: schema.procedures.name,
      price: schema.procedures.price,
      durationMinutes: schema.procedures.durationMinutes,
    })
    .from(schema.procedures)
    .where(and(eq(schema.procedures.clinicId, clinicId), eq(schema.procedures.active, true)));

  const precosNoTexto = parsePrecosBR(texto);
  const duracoesNoTexto = [...texto.matchAll(/(\d+)\s*(?:min|minutos)\b/gi)].map((m) =>
    Number(m[1]),
  );

  for (const p of procedures) {
    if (!textoNorm.includes(semAcento(p.name))) continue;
    const precoCatalogo = Number(p.price);
    if (
      precosNoTexto.length > 0 &&
      !precosNoTexto.some((v) => Math.abs(v - precoCatalogo) < 0.01)
    ) {
      warnings.push(
        `O card menciona ${p.name} com preço diferente do catálogo (Serviços diz R$ ${precoCatalogo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}). A assistente responde pelos DOIS lugares — deixe um só valendo.`,
      );
    }
    if (duracoesNoTexto.length > 0 && !duracoesNoTexto.includes(p.durationMinutes)) {
      warnings.push(
        `O card cita uma duração para ${p.name} diferente do catálogo (Serviços diz ${p.durationMinutes} min).`,
      );
    }
  }

  if (/hor[aá]rio de (funcionamento|atendimento)|abrimos|fechamos|atendemos (de|das)/i.test(texto)) {
    warnings.push(
      "Horário de funcionamento já é definido nas Configurações e a assistente já o conhece — repetir num card cria duas fontes que podem divergir.",
    );
  }

  const similares = await tx
    .select({ title: schema.kbEntries.title })
    .from(schema.kbEntries)
    .where(
      and(
        eq(schema.kbEntries.clinicId, clinicId),
        eq(schema.kbEntries.active, true),
        entry.id ? ne(schema.kbEntries.id, entry.id) : undefined,
        sql`(${schema.kbEntries.title} % ${entry.title}
             OR to_tsvector('portuguese', ${schema.kbEntries.title}) @@ plainto_tsquery('portuguese', ${entry.title}))`,
      ),
    )
    .limit(2);
  for (const s of similares) {
    warnings.push(
      `Já existe um card parecido: "${s.title}". Confira se os dois não dizem coisas diferentes sobre o mesmo assunto.`,
    );
  }

  return warnings;
}

/** Checagem semântica: o próprio modelo da clínica compara o card novo com
 *  as fontes oficiais e aponta contradições que regex não pega. */
async function checagemSemantica(
  tx: Tx,
  clinicId: string,
  entry: { id?: string; title: string; content: string },
): Promise<string[]> {
  const clinic = (
    await tx
      .select({ settings: schema.clinics.settings })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1)
  )[0];
  const config = resolveClinicAiConfig(clinic?.settings, process.env);
  if (!config) return []; // sem IA configurada: fica só a checagem mecânica

  const procedures = await tx
    .select({
      name: schema.procedures.name,
      price: schema.procedures.price,
      durationMinutes: schema.procedures.durationMinutes,
    })
    .from(schema.procedures)
    .where(and(eq(schema.procedures.clinicId, clinicId), eq(schema.procedures.active, true)));
  const outros = await tx
    .select({ title: schema.kbEntries.title, content: schema.kbEntries.content })
    .from(schema.kbEntries)
    .where(
      and(
        eq(schema.kbEntries.clinicId, clinicId),
        eq(schema.kbEntries.active, true),
        entry.id ? ne(schema.kbEntries.id, entry.id) : undefined,
      ),
    )
    .limit(40);

  const fontes = [
    "CATÁLOGO OFICIAL (Serviços):",
    ...procedures.map(
      (p) => `- ${p.name}: R$ ${Number(p.price).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, ${p.durationMinutes} min`,
    ),
    "",
    "CARDS JÁ EXISTENTES:",
    ...(outros.length > 0
      ? outros.map((o) => `- ${o.title}: ${o.content.slice(0, 300)}`)
      : ["(nenhum)"]),
  ].join("\n");

  try {
    const client = createLlmClient(config);
    const res = await client.chat({
      model: config.classifierModel,
      maxTokens: 400,
      system: [
        'Você audita a base de conhecimento de uma clínica. Compare o NOVO CARD com as fontes oficiais e aponte SOMENTE contradições reais (valores, durações, regras ou informações que se opõem) e duplicações do mesmo assunto. Divergência de estilo não é problema. Responda APENAS JSON no formato {"problemas":[{"detalhe":"..."}]} — lista vazia se estiver tudo coerente. Cada detalhe em uma frase curta em português.',
      ],
      messages: [
        {
          role: "user",
          text: `${fontes}\n\nNOVO CARD\nTítulo: ${entry.title}\nConteúdo: ${entry.content}`,
        },
      ],
    });
    const raw = res.text ?? "";
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd <= jsonStart) return [];
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      problemas?: { detalhe?: unknown }[];
    };
    return (parsed.problemas ?? [])
      .map((p) => (typeof p.detalhe === "string" ? p.detalhe.trim() : ""))
      .filter((d) => d.length > 0)
      .slice(0, 5);
  } catch {
    return []; // checagem semântica é melhor-esforço; a mecânica já rodou
  }
}

export const saveKbEntry = authAction({
  permission: "settings.manage",
  schema: entrySchema,
  handler: async (input, { auth, tx }): Promise<KbSaveResult> => {
    if (!input.force) {
      const [mecanica, semantica] = [
        await checagemMecanica(tx, auth.clinicId, input),
        await checagemSemantica(tx, auth.clinicId, input),
      ];
      // Sem duplicar aviso que as duas checagens pegaram
      const warnings = [...new Set([...mecanica, ...semantica])];
      if (warnings.length > 0) return { ok: false, warnings };
    }

    if (input.id) {
      const updated = await tx
        .update(schema.kbEntries)
        .set({
          kind: input.kind,
          title: input.title,
          content: input.content,
          active: input.active,
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.kbEntries.id, input.id), eq(schema.kbEntries.clinicId, auth.clinicId)),
        )
        .returning({ id: schema.kbEntries.id });
      if (!updated[0]) return { ok: false, error: "Card não encontrado." };
      revalidatePath("/conhecimento");
      return { ok: true, entryId: updated[0].id };
    }

    const inserted = await tx
      .insert(schema.kbEntries)
      .values({
        clinicId: auth.clinicId,
        kind: input.kind,
        title: input.title,
        content: input.content,
        active: input.active,
        createdBy: auth.userId,
      })
      .returning({ id: schema.kbEntries.id });
    revalidatePath("/conhecimento");
    return { ok: true, entryId: inserted[0]?.id };
  },
});

export const deleteKbEntry = authAction({
  permission: "settings.manage",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { auth, tx }): Promise<KbSaveResult> => {
    await tx
      .delete(schema.kbEntries)
      .where(and(eq(schema.kbEntries.id, input.id), eq(schema.kbEntries.clinicId, auth.clinicId)));
    revalidatePath("/conhecimento");
    return { ok: true };
  },
});
