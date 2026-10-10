"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PLANS } from "@clinicaos/core/plans";
import { Button, FieldError, Input, Label, Select } from "@/components/ui";
import {
  addClinicUser,
  deleteClinic,
  enterClinic,
  leaveClinic,
  removeClinicUser,
  resetUserPassword,
  saveClinicAdmin,
} from "../../actions";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dona / administradora",
  manager: "Gerente",
  professional: "Profissional",
  reception: "Recepção",
};

export function ClinicAdmin({
  clinic,
  members,
  instances,
  adminIsMember,
}: {
  clinic: {
    id: string;
    name: string;
    status: string;
    plan: string;
    customMonthlyBrl: string;
    billingNote: string;
    monthlyLimitBrl: string;
    allowOverage: boolean;
    isDemo: boolean;
  };
  members: { userId: string; role: string; active: boolean; name: string; email: string; isSuperadmin: boolean; isMe: boolean }[];
  instances: { id: string; label: string | null; phone: string | null; status: string; provider: string; verifiedName: string | null; coexistence: boolean; lastSeenAt: string | null }[];
  adminIsMember: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();
  const [pwd, setPwd] = useState<{ who: string; password: string }>();

  // Form da clínica
  const [plan, setPlan] = useState(clinic.plan);
  const [status, setStatus] = useState(clinic.status);
  const [custom, setCustom] = useState(clinic.customMonthlyBrl);
  const [note, setNote] = useState(clinic.billingNote);
  const [limit, setLimit] = useState(clinic.monthlyLimitBrl);
  const [allowOverage, setAllowOverage] = useState(clinic.allowOverage);
  const [isDemo, setIsDemo] = useState(clinic.isDemo);

  // Novo usuário
  const [uName, setUName] = useState("");
  const [uEmail, setUEmail] = useState("");
  const [uRole, setURole] = useState("reception");

  // Apagar
  const [confirmName, setConfirmName] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string; password?: string } | void>, who?: string) =>
    start(async () => {
      setMsg(undefined);
      setErr(undefined);
      setPwd(undefined);
      const r = await fn();
      if (!r) return;
      if (r.ok) {
        setMsg(r.message);
        if (r.password && who) setPwd({ who, password: r.password });
        router.refresh();
      } else setErr(r.error);
    });

  return (
    <div className="space-y-6">
      {(msg || err || pwd) && (
        <div className={`rounded-lg border p-3 text-sm ${err ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {err ?? msg}
          {pwd ? (
            <p className="mt-1">
              Senha de <strong>{pwd.who}</strong>: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-stone-800">{pwd.password}</code>{" "}
              <span className="text-xs">(aparece só agora; anote)</span>
            </p>
          ) : null}
        </div>
      )}

      {/* Acesso rápido */}
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-4">
        <Button type="button" disabled={pending} onClick={() => run(() => enterClinic({ clinicId: clinic.id }))}>
          Entrar no painel desta clínica
        </Button>
        {adminIsMember ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => leaveClinic({ clinicId: clinic.id }))}>
            Remover meu acesso
          </Button>
        ) : null}
        <p className="text-xs text-stone-500">
          Entrar te adiciona como administradora desta clínica (aparece na Equipe dela). Remova quando terminar.
        </p>
      </section>

      {/* Plano, preço, limite, demo, status */}
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-800">Plano e cobrança</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="a-plan">Plano</Label>
            <Select id="a-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · R$ {p.monthlyBrl}/mês · franquia R$ {p.apiAllowanceBrl}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="a-status">Situação</Label>
            <Select id="a-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Ativa</option>
              <option value="suspended">Suspensa (bloqueia o acesso da equipe)</option>
              <option value="cancelled">Cancelada</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="a-custom" hint="em branco = preço do plano">Mensalidade negociada (R$)</Label>
            <Input id="a-custom" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="ex.: 200" />
          </div>
          <div>
            <Label htmlFor="a-note" hint="opcional">Observação da cobrança</Label>
            <Input id="a-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="ex.: cliente fundadora, R$ 200 por 12 meses" />
          </div>
          <div>
            <Label htmlFor="a-limit" hint="em branco = franquia do plano">Limite mensal de gastos com API (R$)</Label>
            <Input id="a-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="ex.: 50" />
          </div>
          <div className="space-y-2 pt-6">
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={allowOverage} onChange={(e) => setAllowOverage(e.target.checked)} className="h-4 w-4 accent-teal-700" />
              Permitir ultrapassar o limite (excedente cobrado com 20%)
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} className="h-4 w-4 accent-amber-600" />
              Clínica de demonstração (fora do faturamento)
            </label>
          </div>
        </div>
        <div className="mt-4">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                saveClinicAdmin({
                  clinicId: clinic.id,
                  plan,
                  status,
                  customMonthlyBrl: custom,
                  billingNote: note,
                  monthlyLimitBrl: limit,
                  allowOverage,
                  isDemo,
                }),
              )
            }
          >
            {pending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </section>

      {/* WhatsApp */}
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-800">Números de WhatsApp</h2>
        {instances.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nenhum número conectado.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {instances.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className={`inline-block h-2 w-2 rounded-full ${i.status === "connected" ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="font-medium text-stone-800">{i.phone ?? "(sem número)"}</span>
                <span className="text-stone-500">{i.verifiedName ?? i.label ?? ""}</span>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
                  {i.provider === "meta" ? (i.coexistence ? "API oficial + app" : "API oficial") : "QR code"} · {i.status}
                </span>
                {i.lastSeenAt ? <span className="text-[11px] text-stone-400">visto {i.lastSeenAt.slice(0, 16).replace("T", " ")}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-stone-400">Conectar ou trocar número é feito dentro do painel da clínica, em Configurações → WhatsApp.</p>
      </section>

      {/* Usuários */}
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-800">Equipe (logins)</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-1">Nome</th>
              <th className="py-1">E-mail</th>
              <th className="py-1">Papel</th>
              <th className="py-1">Acesso</th>
              <th className="py-1 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t border-stone-100">
                <td className="py-2">
                  {m.name}
                  {m.isSuperadmin ? <span className="ml-1 text-[10px] text-amber-700">(admin da plataforma)</span> : null}
                </td>
                <td className="py-2 text-stone-600">{m.email}</td>
                <td className="py-2">{ROLE_LABEL[m.role] ?? m.role}</td>
                <td className="py-2">{m.active ? <span className="text-emerald-700">ativo</span> : <span className="text-stone-400">desativado</span>}</td>
                <td className="py-2 text-right">
                  {m.isMe ? null : (
                    <span className="inline-flex gap-1">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => resetUserPassword({ clinicId: clinic.id, userId: m.userId }), m.email)}
                        className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                      >
                        nova senha
                      </button>
                      {m.active ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => removeClinicUser({ clinicId: clinic.id, userId: m.userId }))}
                          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          desativar
                        </button>
                      ) : null}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-[1fr_1fr_160px_auto]">
          <div>
            <Label htmlFor="u-name">Nome</Label>
            <Input id="u-name" value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Nome completo" />
          </div>
          <div>
            <Label htmlFor="u-email">E-mail</Label>
            <Input id="u-email" type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="email@clinica.com.br" />
          </div>
          <div>
            <Label htmlFor="u-role">Papel</Label>
            <Select id="u-role" value={uRole} onChange={(e) => setURole(e.target.value)}>
              {Object.entries(ROLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              disabled={pending || uName.trim().length < 2 || !uEmail.includes("@")}
              onClick={() =>
                run(async () => {
                  const r = await addClinicUser({ clinicId: clinic.id, name: uName, email: uEmail, role: uRole });
                  if (r.ok) {
                    setUName("");
                    setUEmail("");
                  }
                  return r;
                }, uEmail)
              }
            >
              Adicionar
            </Button>
          </div>
        </div>
      </section>

      {/* Zona de perigo */}
      <section className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-sm font-semibold text-red-800">Apagar clínica</h2>
        <p className="mt-1 text-xs text-red-700">
          Só para clínica vazia (sem clientes, atendimentos ou conversas). Com dados, use &quot;Suspensa&quot; acima; exclusão completa é feita com backup.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="del-name">Digite o nome da clínica para confirmar</Label>
            <Input id="del-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={clinic.name} />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || confirmName.trim() !== clinic.name}
            onClick={() => run(() => deleteClinic({ clinicId: clinic.id, confirmName }))}
          >
            Apagar definitivamente
          </Button>
        </div>
        <FieldError message={undefined} />
      </section>
    </div>
  );
}
