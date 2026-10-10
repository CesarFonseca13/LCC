"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { PLANS } from "@clinicaos/core/plans";
import { Button, FieldError, Input, Label, Select } from "@/components/ui";
import { createClinic } from "../actions";

export function NewClinicForm() {
  const [clinicName, setClinicName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [plan, setPlan] = useState("profissional");
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ message: string; password?: string }>();
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
        <p>{done.message}</p>
        {done.password ? (
          <p className="mt-2">
            Senha inicial: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-stone-800">{done.password}</code>{" "}
            <span className="text-xs">(aparece só agora; anote e entregue por canal seguro)</span>
          </p>
        ) : null}
        <p className="mt-3">
          <Link href="/admin" className="underline">Voltar às clínicas</Link>
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        start(async () => {
          const r = await createClinic({ clinicName, ownerName, ownerEmail, plan, isDemo });
          if (r.ok) setDone({ message: r.message ?? "Criada.", password: r.password });
          else setError(r.error);
        });
      }}
      className="space-y-4 rounded-xl border border-stone-200 bg-white p-5"
    >
      <div>
        <Label htmlFor="n-clinic">Nome da clínica</Label>
        <Input id="n-clinic" value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="Ex.: Clínica Bella" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="n-owner">Nome da responsável</Label>
          <Input id="n-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="n-email">E-mail de login</Label>
          <Input id="n-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="n-plan">Plano</Label>
          <Select id="n-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · R$ {p.monthlyBrl}/mês</option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-stone-700">
          <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} className="h-4 w-4 accent-amber-600" />
          Clínica de demonstração (fora do faturamento)
        </label>
      </div>
      <FieldError message={error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>{pending ? "Criando..." : "Criar clínica"}</Button>
      </div>
    </form>
  );
}
