"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WhatsAppCard } from "@/app/(painel)/configuracoes/whatsapp-card";
import { ImportButton } from "@/app/(painel)/clientes/import-modal";
import { saveProcedure } from "@/app/(painel)/servicos/actions";
import { saveProfessional } from "@/app/(painel)/equipe/actions";
import { saveAutomationSetting } from "@/app/(painel)/automacoes/actions";
import { Button, FieldError, Input, Label, Select } from "@/components/ui";
import { markOnboardingDone, saveClinicBasics } from "./actions";

const STEPS = ["Sua clínica", "WhatsApp", "Procedimentos", "Equipe", "Clientes", "Automações"];

const SPECIALTIES = [
  { value: "estetica_facial", label: "Estética facial" },
  { value: "estetica_corporal", label: "Estética corporal" },
  { value: "harmonizacao", label: "Harmonização" },
  { value: "depilacao", label: "Depilação a laser" },
] as const;

interface Suggestion {
  name: string;
  durationMinutes: number;
  price: string;
  returnDays?: number;
  touchupDays?: number;
}

const SUGGESTIONS: Record<string, Suggestion[]> = {
  estetica_facial: [
    { name: "Limpeza de Pele", durationMinutes: 60, price: "180,00", returnDays: 30 },
    { name: "Peeling Químico", durationMinutes: 45, price: "350,00", returnDays: 30 },
    { name: "Microagulhamento", durationMinutes: 60, price: "400,00", returnDays: 30 },
    { name: "Skinbooster", durationMinutes: 45, price: "800,00", returnDays: 90 },
  ],
  estetica_corporal: [
    { name: "Drenagem Linfática", durationMinutes: 50, price: "150,00", returnDays: 15 },
    { name: "Massagem Modeladora", durationMinutes: 50, price: "160,00", returnDays: 15 },
    { name: "Criolipólise", durationMinutes: 60, price: "600,00", returnDays: 90 },
  ],
  harmonizacao: [
    { name: "Botox", durationMinutes: 30, price: "1.200,00", returnDays: 120, touchupDays: 15 },
    { name: "Preenchimento Labial", durationMinutes: 45, price: "1.500,00", returnDays: 180, touchupDays: 30 },
    { name: "Bioestimulador de Colágeno", durationMinutes: 45, price: "1.800,00", returnDays: 120 },
  ],
  depilacao: [
    { name: "Laser — Axilas", durationMinutes: 20, price: "120,00", returnDays: 30 },
    { name: "Laser — Pernas", durationMinutes: 40, price: "250,00", returnDays: 30 },
    { name: "Laser — Virilha", durationMinutes: 30, price: "180,00", returnDays: 30 },
  ],
};

export interface WizardInitial {
  clinicName: string;
  city: string;
  state: string;
  specialty: string;
  procedures: string[];
  professionals: string[];
  whatsapp: import("../(painel)/configuracoes/whatsapp-card").InstanceView[];
  automationsOn: boolean;
}

export function Wizard({ initial }: { initial: WizardInitial }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [specialty, setSpecialty] = useState(initial.specialty);
  const [procedures, setProcedures] = useState<string[]>(initial.procedures);
  const [professionals, setProfessionals] = useState<string[]>(initial.professionals);
  const [automationsOn, setAutomationsOn] = useState(initial.automationsOn);

  function next() {
    setError(undefined);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function finish() {
    startTransition(async () => {
      await markOnboardingDone({});
      router.push("/inicio");
    });
  }

  function submitBasics(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await saveClinicBasics({
        name: String(fd.get("name") ?? ""),
        city: String(fd.get("city") ?? ""),
        state: String(fd.get("state") ?? ""),
        specialty: String(fd.get("specialty") ?? "estetica_facial"),
        weekOpen: String(fd.get("weekOpen") ?? "08:00"),
        weekClose: String(fd.get("weekClose") ?? "19:00"),
        saturday: fd.get("saturday") === "on",
        satOpen: String(fd.get("satOpen") ?? "09:00"),
        satClose: String(fd.get("satClose") ?? "14:00"),
      });
      if (result.ok) next();
      else setError(result.error);
    });
  }

  function addSuggestion(s: Suggestion) {
    setError(undefined);
    startTransition(async () => {
      const result = await saveProcedure({
        name: s.name,
        category: "",
        durationMinutes: String(s.durationMinutes),
        price: s.price,
        returnDays: s.returnDays ? String(s.returnDays) : "",
        touchupDays: s.touchupDays ? String(s.touchupDays) : "",
        preCare: "",
        postCare: "",
        commissionDefaultPct: "",
      });
      if (result.ok) setProcedures((p) => [...p, s.name]);
      else setError(result.error);
    });
  }

  function addProfessional(fd: FormData, form: HTMLFormElement) {
    const name = String(fd.get("profName") ?? "").trim();
    if (name.length < 2) return;
    setError(undefined);
    startTransition(async () => {
      const result = await saveProfessional({
        name,
        specialty: String(fd.get("profSpecialty") ?? ""),
        registrationNumber: "",
        calendarColor: "#0f766e",
      });
      if (result.ok) {
        setProfessionals((p) => [...p, name]);
        form.reset();
      } else {
        setError(result.error);
      }
    });
  }

  function enableAutomations() {
    setError(undefined);
    startTransition(async () => {
      for (const automationId of ["reminder_24h", "confirm_2h"]) {
        await saveAutomationSetting({
          automationId,
          enabled: true,
          requiresApproval: true,
        });
      }
      setAutomationsOn(true);
    });
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-teal-800">ClinicaOS</h1>
          <button
            type="button"
            onClick={finish}
            className="text-sm text-stone-400 hover:text-stone-600"
          >
            Pular por enquanto →
          </button>
        </div>

        {/* Progresso */}
        <div className="mb-6 flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div
                className={`h-1.5 rounded-full ${
                  i < step ? "bg-teal-600" : i === step ? "bg-teal-400" : "bg-stone-200"
                }`}
              />
              <p
                className={`mt-1 hidden text-[10px] sm:block ${
                  i === step ? "font-medium text-teal-800" : "text-stone-400"
                }`}
              >
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          {step === 0 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitBasics(new FormData(e.currentTarget));
              }}
              className="space-y-4"
            >
              <div>
                <h2 className="text-xl font-semibold text-stone-800">
                  Bem-vinda! Vamos montar sua clínica 🎉
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  Leva menos de 5 minutos — e tudo pode ser ajustado depois.
                </p>
              </div>
              <div>
                <Label htmlFor="w-name">Nome da clínica</Label>
                <Input id="w-name" name="name" defaultValue={initial.clinicName} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label htmlFor="w-city">Cidade</Label>
                  <Input id="w-city" name="city" defaultValue={initial.city} />
                </div>
                <div>
                  <Label htmlFor="w-state">UF</Label>
                  <Input id="w-state" name="state" defaultValue={initial.state} maxLength={2} />
                </div>
              </div>
              <div>
                <Label htmlFor="w-specialty">Especialidade principal</Label>
                <Select
                  id="w-specialty"
                  name="specialty"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                >
                  {SPECIALTIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-stone-400">
                  Usamos para sugerir procedimentos e modelos prontos.
                </p>
              </div>
              <fieldset className="rounded-lg border border-stone-200 p-4">
                <legend className="px-1 text-xs font-medium uppercase tracking-wide text-stone-400">
                  Horário de funcionamento
                </legend>
                <div className="flex flex-wrap items-center gap-3 text-sm text-stone-700">
                  <span>Seg–Sex</span>
                  <Input name="weekOpen" type="time" defaultValue="08:00" className="w-28" />
                  <span>às</span>
                  <Input name="weekClose" type="time" defaultValue="19:00" className="w-28" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-stone-700">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="saturday" defaultChecked className="h-4 w-4 accent-teal-700" />
                    Sábado
                  </label>
                  <Input name="satOpen" type="time" defaultValue="09:00" className="w-28" />
                  <span>às</span>
                  <Input name="satClose" type="time" defaultValue="14:00" className="w-28" />
                </div>
              </fieldset>
              <FieldError message={error} />
              <div className="flex justify-end">
                <Button type="submit" disabled={pending}>
                  {pending ? "Salvando..." : "Continuar"}
                </Button>
              </div>
            </form>
          ) : step === 1 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-stone-800">Conecte o WhatsApp</h2>
                <p className="mt-1 text-sm text-stone-500">
                  É por ele que os lembretes e confirmações automáticas saem. Não desconecta
                  o celular da clínica.
                </p>
              </div>
              <WhatsAppCard initialInstances={initial.whatsapp} />
              <div className="flex justify-between">
                <Button variant="ghost" onClick={next}>
                  Deixar para depois
                </Button>
                <Button onClick={next}>Continuar</Button>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-stone-800">
                  O que a sua clínica faz?
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  Toque para adicionar — duração, preço e prazo de retorno já vêm prontos
                  (tudo editável em Serviços).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(SUGGESTIONS[specialty] ?? []).map((s) => {
                  const added = procedures.some(
                    (p) => p.toLowerCase() === s.name.toLowerCase(),
                  );
                  return (
                    <button
                      key={s.name}
                      type="button"
                      disabled={added || pending}
                      onClick={() => addSuggestion(s)}
                      className={
                        added
                          ? "rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700"
                          : "rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm text-teal-800 transition hover:bg-teal-100 disabled:opacity-60"
                      }
                    >
                      {added ? "✓ " : "+ "}
                      {s.name} · {s.durationMinutes}min · R$ {s.price}
                    </button>
                  );
                })}
              </div>
              {procedures.length > 0 ? (
                <p className="text-sm text-stone-600">
                  {procedures.length} procedimento{procedures.length === 1 ? "" : "s"} no
                  catálogo.
                </p>
              ) : null}
              <FieldError message={error} />
              <div className="flex justify-between">
                <Button variant="ghost" onClick={next}>
                  Pular
                </Button>
                <Button onClick={next} disabled={pending}>
                  Continuar
                </Button>
              </div>
            </div>
          ) : step === 3 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-stone-800">Quem atende?</h2>
                <p className="mt-1 text-sm text-stone-500">
                  Cada profissional vira uma coluna na agenda.
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addProfessional(new FormData(e.currentTarget), e.currentTarget);
                }}
                className="flex items-end gap-2"
              >
                <div className="flex-1">
                  <Label htmlFor="w-prof">Nome</Label>
                  <Input id="w-prof" name="profName" placeholder="Ex.: Dra. Paula" />
                </div>
                <div className="flex-1">
                  <Label htmlFor="w-prof-esp" hint="opcional">Especialidade</Label>
                  <Input id="w-prof-esp" name="profSpecialty" />
                </div>
                <Button type="submit" disabled={pending}>
                  Adicionar
                </Button>
              </form>
              {professionals.length > 0 ? (
                <ul className="space-y-1 text-sm text-stone-700">
                  {professionals.map((p) => (
                    <li key={p}>✓ {p}</li>
                  ))}
                </ul>
              ) : null}
              <FieldError message={error} />
              <div className="flex justify-between">
                <Button variant="ghost" onClick={next}>
                  Pular
                </Button>
                <Button onClick={next}>Continuar</Button>
              </div>
            </div>
          ) : step === 4 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-stone-800">
                  Traga suas clientes
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  Importe a planilha de uma vez — com a última visita preenchida, as
                  reativações automáticas e o ranking já nascem funcionando.
                </p>
              </div>
              <ImportButton />
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={next}>
                  Deixar para depois
                </Button>
                <Button onClick={next}>Continuar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-stone-800">
                  Ligar as automações essenciais
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  Lembrete 24h antes e confirmação 2h antes — começam no modo{" "}
                  <strong>“Revisar antes de enviar”</strong>: nada sai sem você aprovar,
                  até você confiar e automatizar.
                </p>
              </div>
              {automationsOn ? (
                <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  ✓ Automações de confirmação ligadas em modo supervisionado.
                </p>
              ) : (
                <Button onClick={enableAutomations} disabled={pending}>
                  {pending ? "Ligando..." : "Ligar automações de confirmação"}
                </Button>
              )}
              <FieldError message={error} />
              <div className="flex justify-end pt-2">
                <Button onClick={finish} disabled={pending}>
                  {pending ? "..." : "Concluir — abrir minha clínica 🎉"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
