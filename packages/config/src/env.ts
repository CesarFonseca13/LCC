import { z } from "zod";

/**
 * Validação central de variáveis de ambiente.
 * Cada app chama `parseEnv(process.env)` no boot e falha rápido com mensagem clara.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_MIGRATOR: z.string().url().optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  APP_URL: z.string().url().default("http://localhost:3000"),
  SENSITIVE_DATA_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "SENSITIVE_DATA_KEY deve ser 32 bytes em base64 (openssl rand -base64 32)",
    }),
  ENABLE_DEV_CLOCK: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  EVOLUTION_BASE_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  if (result.data.NODE_ENV === "production" && result.data.ENABLE_DEV_CLOCK) {
    throw new Error("ENABLE_DEV_CLOCK não pode ser true em produção.");
  }
  return result.data;
}
