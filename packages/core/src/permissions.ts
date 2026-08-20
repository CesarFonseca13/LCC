/**
 * RBAC estático — papéis fixos, permissões string.
 * 4 papéis no schema; a UI do MVP expõe 3 (owner="Administradora", reception="Recepção",
 * professional="Profissional"); manager entra depois sem migração.
 */
export type Role = "owner" | "manager" | "professional" | "reception";

export type Permission =
  | "agenda.read.all"
  | "agenda.read.own"
  | "agenda.write"
  | "customers.read"
  | "customers.write"
  | "customers.clinical.read"
  | "customers.clinical.write"
  | "funnel.manage"
  | "quotes.manage"
  | "terms.manage"
  | "approvals.review"
  | "inbox.access"
  | "finance.read"
  | "finance.write"
  | "commissions.read.own"
  | "commissions.manage"
  | "stock.read"
  | "stock.manage"
  | "automations.manage"
  | "intelligence.read"
  | "reports.read"
  | "team.manage"
  | "settings.manage";

const ALL: readonly Permission[] = [
  "agenda.read.all", "agenda.read.own", "agenda.write",
  "customers.read", "customers.write", "customers.clinical.read", "customers.clinical.write",
  "funnel.manage", "quotes.manage", "terms.manage",
  "approvals.review", "inbox.access",
  "finance.read", "finance.write", "commissions.read.own", "commissions.manage",
  "stock.read", "stock.manage",
  "automations.manage", "intelligence.read", "reports.read",
  "team.manage", "settings.manage",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ALL),
  manager: new Set<Permission>([
    "agenda.read.all", "agenda.read.own", "agenda.write",
    "customers.read", "customers.write", "customers.clinical.read", "customers.clinical.write",
    "funnel.manage", "quotes.manage", "terms.manage",
    "approvals.review", "inbox.access",
    "finance.read", "finance.write", "commissions.manage",
    "stock.read", "stock.manage",
    "automations.manage", "intelligence.read", "reports.read",
  ]),
  professional: new Set<Permission>([
    "agenda.read.own",
    "customers.read",
    "customers.clinical.read", "customers.clinical.write",
    "commissions.read.own",
    "stock.read",
  ]),
  reception: new Set<Permission>([
    "agenda.read.all", "agenda.read.own", "agenda.write",
    "customers.read", "customers.write",
    "funnel.manage", "quotes.manage",
    "approvals.review", "inbox.access",
    "intelligence.read",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsOf(role: Role): readonly Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
