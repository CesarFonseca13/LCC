"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Select } from "@/components/ui";
import {
  SPECIALTIES,
  TIMEZONES,
  WEEKDAYS,
  type BusinessHours,
  type Specialty,
  type WeekdayKey,
} from "@/lib/clinic-profile";
import { saveClinicProfile } from "./actions";

export interface ClinicProfileView {
  name: string;
  legalName: string;
  cnpj: string;
  phone: string;
  email: string;
  addressZip: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
  timezone: string;
  googleReviewUrl: string;
  specialty: string;
  /** Texto livre quando a especialidade é "Outra". */
  specialtyOther: string;
  businessHours: BusinessHours;
}

type Fields = Omit<ClinicProfileView, "businessHours">;
type DayState = { open: boolean; from: string; to: string };

function hoursToState(hours: BusinessHours): Record<WeekdayKey, DayState> {
  const out = {} as Record<WeekdayKey, DayState>;
  for (const d of WEEKDAYS) {
    const first = hours[d.key]?.[0];
    const fimDeSemana = d.key === "sat" || d.key === "sun";
    out[d.key] = first
      ? { open: true, from: first[0], to: first[1] }
      : { open: false, from: fimDeSemana ? "09:00" : "08:00", to: fimDeSemana ? "14:00" : "19:00" };
  }
  return out;
}

function Bloco({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">{title}</p>
      {children}
    </div>
  );
}

export function ClinicCard({ initial }: { initial: ClinicProfileView }) {
  const router = useRouter();
  const { businessHours: initialHours, ...initialFields } = initial;
  const [form, setForm] = useState<Fields>(initialFields);
  const [hours, setHours] = useState(() => hoursToState(initialHours));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const bind = (key: keyof Fields) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setSaved(false);
      setForm((f) => ({ ...f, [key]: e.target.value }));
    },
  });

  function setDay(key: WeekdayKey, patch: Partial<DayState>) {
    setSaved(false);
    setHours((h) => ({ ...h, [key]: { ...h[key], ...patch } }));
  }

  function save() {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const businessHours: Record<string, [string, string][]> = {};
      for (const d of WEEKDAYS) {
        const s = hours[d.key];
        if (s.open) businessHours[d.key] = [[s.from, s.to]];
      }
      const result = await saveClinicProfile({
        ...form,
        specialty: form.specialty as Specialty,
        businessHours,
      });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-stone-700">Dados da clínica</h2>
      <p className="mt-1 text-sm text-stone-500">
        É o que a assistente diz às clientes (nome, endereço, telefone e horários), o que entra
        nos termos e o que define os horários que a agenda oferece.
      </p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="mt-5 space-y-6"
      >
        <Bloco title="Identificação">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cl-name">Nome da clínica</Label>
              <Input id="cl-name" {...bind("name")} placeholder="Como as clientes conhecem" />
            </div>
            <div>
              <Label htmlFor="cl-specialty">Especialidade principal</Label>
              <Select id="cl-specialty" {...bind("specialty")}>
                {SPECIALTIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            {form.specialty === "outra" ? (
              <div className="sm:col-span-2">
                <Label htmlFor="cl-specialty-other">Qual é a especialidade?</Label>
                <Input
                  id="cl-specialty-other"
                  {...bind("specialtyOther")}
                  placeholder="Ex.: Podologia, Terapias integrativas..."
                  maxLength={60}
                  invalid={form.specialtyOther.trim().length < 2}
                />
              </div>
            ) : null}
            <div>
              <Label htmlFor="cl-legal" hint="opcional">
                Razão social
              </Label>
              <Input id="cl-legal" {...bind("legalName")} />
            </div>
            <div>
              <Label htmlFor="cl-cnpj" hint="opcional">
                CNPJ
              </Label>
              <Input id="cl-cnpj" {...bind("cnpj")} placeholder="00.000.000/0000-00" inputMode="numeric" />
            </div>
          </div>
        </Bloco>

        <Bloco title="Contato">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cl-phone" hint="opcional">
                Telefone
              </Label>
              <Input id="cl-phone" {...bind("phone")} placeholder="(11) 3456-7890" inputMode="tel" />
            </div>
            <div>
              <Label htmlFor="cl-email" hint="opcional">
                E-mail
              </Label>
              <Input id="cl-email" {...bind("email")} placeholder="contato@suaclinica.com.br" inputMode="email" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cl-review" hint="opcional">
                Link de avaliação no Google
              </Label>
              <Input id="cl-review" {...bind("googleReviewUrl")} placeholder="https://g.page/r/..." inputMode="url" />
              <p className="mt-1 text-xs text-stone-400">
                Quando uma cliente elogia o atendimento, a assistente convida para avaliar por este link.
              </p>
            </div>
          </div>
        </Bloco>

        <Bloco title="Endereço">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label htmlFor="cl-zip">CEP</Label>
              <Input id="cl-zip" {...bind("addressZip")} placeholder="00000-000" inputMode="numeric" />
            </div>
            <div className="sm:col-span-4">
              <Label htmlFor="cl-street">Rua / Avenida</Label>
              <Input id="cl-street" {...bind("addressStreet")} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cl-number">Número</Label>
              <Input id="cl-number" {...bind("addressNumber")} />
            </div>
            <div className="sm:col-span-4">
              <Label htmlFor="cl-complement" hint="opcional">
                Complemento
              </Label>
              <Input id="cl-complement" {...bind("addressComplement")} placeholder="Sala, andar, bloco..." />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cl-district">Bairro</Label>
              <Input id="cl-district" {...bind("addressDistrict")} />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="cl-city">Cidade</Label>
              <Input id="cl-city" {...bind("addressCity")} />
            </div>
            <div className="sm:col-span-1">
              <Label htmlFor="cl-state">UF</Label>
              <Input id="cl-state" {...bind("addressState")} maxLength={2} placeholder="SP" />
            </div>
          </div>
        </Bloco>

        <Bloco title="Horário de funcionamento">
          <div className="space-y-2">
            {WEEKDAYS.map((d) => {
              const s = hours[d.key];
              return (
                <div key={d.key} className="flex flex-wrap items-center gap-3 text-sm text-stone-700">
                  <label className="flex w-36 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={s.open}
                      onChange={(e) => setDay(d.key, { open: e.target.checked })}
                      className="h-4 w-4 accent-teal-700"
                    />
                    {d.label}
                  </label>
                  {s.open ? (
                    <>
                      <Input
                        type="time"
                        value={s.from}
                        onChange={(e) => setDay(d.key, { from: e.target.value })}
                        className="w-28"
                        aria-label={`${d.label} — abre`}
                      />
                      <span className="text-stone-400">às</span>
                      <Input
                        type="time"
                        value={s.to}
                        onChange={(e) => setDay(d.key, { to: e.target.value })}
                        className="w-28"
                        aria-label={`${d.label} — fecha`}
                      />
                    </>
                  ) : (
                    <span className="text-xs text-stone-400">fechada</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-stone-400">
            A assistente só oferece horários dentro desses períodos; a agenda de cada
            profissional pode ser mais curta (em Equipe).
          </p>
        </Bloco>

        <Bloco title="Fuso horário">
          <Select id="cl-tz" {...bind("timezone")} aria-label="Fuso horário">
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
            {TIMEZONES.some((t) => t.value === form.timezone) ? null : (
              <option value={form.timezone}>{form.timezone}</option>
            )}
          </Select>
        </Bloco>

        <FieldError message={error} />
        {saved ? <p className="text-sm text-emerald-600">Dados da clínica salvos!</p> : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={
              pending ||
              form.name.trim().length < 2 ||
              (form.specialty === "outra" && form.specialtyOther.trim().length < 2)
            }
          >
            {pending ? "Salvando..." : "Salvar dados da clínica"}
          </Button>
        </div>
      </form>
    </section>
  );
}
