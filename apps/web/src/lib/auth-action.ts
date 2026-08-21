import "server-only";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { can, type Permission, type Role } from "@clinicaos/core/permissions";
import { withTenant, type Tx } from "@clinicaos/db";
import { getAuth, type AuthContext } from "./session";

/** Contexto entregue aos handlers autenticados. */
export interface ActionContext {
  auth: AuthContext & { clinicId: string; role: Role };
  tx: Tx;
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Sem permissão: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/** Garante sessão + clínica ativa; redireciona para /login se ausente. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/**
 * Wrapper padrão de toda server action de tenant:
 * sessão → clínica ativa → permissão (RBAC) → validação zod → transação com RLS.
 */
export function authAction<S extends z.ZodType, R>(opts: {
  permission: Permission;
  schema: S;
  handler: (input: z.infer<S>, ctx: ActionContext) => Promise<R>;
}) {
  return async (rawInput: unknown): Promise<R> => {
    const auth = await requireAuth();
    if (!auth.clinicId || !auth.role) redirect("/login");
    if (!can(auth.role, opts.permission)) throw new ForbiddenError(opts.permission);

    // Validação NUNCA derruba a página: a mensagem pt-BR volta para o formulário
    const parsed = opts.schema.safeParse(rawInput);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Confira os campos e tente de novo.";
      return { ok: false, error: message } as R;
    }
    const input = parsed.data;

    return withTenant(
      auth.clinicId,
      (tx) =>
        opts.handler(input, {
          auth: auth as ActionContext["auth"],
          tx,
        }),
      auth.userId,
    );
  };
}
