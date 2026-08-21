"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Textarea } from "@/components/ui";
import { saveCustomer } from "../actions";

export interface DadosInitial {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  cpf: string;
  birthDate: string;
  socialName: string;
  instagram: string;
  source: string;
  addressStreet: string;
  addressNumber: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  notes: string;
}

export function DadosForm({
  initial,
  readOnly = false,
}: {
  initial: DadosInitial;
  readOnly?: boolean;
}) {
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      try {
        const get = (k: string) => String(formData.get(k) ?? "");
        const result = await saveCustomer({
          id: initial.id,
          fullName: get("fullName"),
          phone: get("phone"),
          email: get("email"),
          cpf: get("cpf"),
          birthDate: get("birthDate"),
          socialName: get("socialName"),
          instagram: get("instagram"),
          source: get("source"),
          addressStreet: get("addressStreet"),
          addressNumber: get("addressNumber"),
          addressDistrict: get("addressDistrict"),
          addressCity: get("addressCity"),
          addressState: get("addressState"),
          addressZip: get("addressZip"),
          notes: get("notes"),
        });
        if (result.ok) {
          setSaved(true);
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível salvar.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <form action={submit} className="space-y-4 rounded-xl border border-stone-200 bg-white p-6">
      {/* fieldset disabled desliga todos os campos de uma vez no modo leitura */}
      <fieldset disabled={readOnly} className="contents">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="d-name">Nome completo</Label>
          <Input id="d-name" name="fullName" defaultValue={initial.fullName} required />
        </div>
        <div>
          <Label htmlFor="d-social" hint="opcional">Nome social</Label>
          <Input id="d-social" name="socialName" defaultValue={initial.socialName} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="d-phone">WhatsApp</Label>
          <Input id="d-phone" name="phone" defaultValue={initial.phone} required />
        </div>
        <div>
          <Label htmlFor="d-email" hint="opcional">E-mail</Label>
          <Input id="d-email" name="email" type="email" defaultValue={initial.email} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="d-cpf" hint="opcional">CPF</Label>
          <Input id="d-cpf" name="cpf" defaultValue={initial.cpf} />
        </div>
        <div>
          <Label htmlFor="d-birth" hint="opcional">Nascimento</Label>
          <Input id="d-birth" name="birthDate" defaultValue={initial.birthDate} placeholder="dd/mm/aaaa" />
        </div>
        <div>
          <Label htmlFor="d-instagram" hint="opcional">Instagram</Label>
          <Input id="d-instagram" name="instagram" defaultValue={initial.instagram} placeholder="@usuario" />
        </div>
      </div>

      <div>
        <Label htmlFor="d-source" hint="opcional">Como conheceu a clínica?</Label>
        <Input id="d-source" name="source" defaultValue={initial.source} />
      </div>

      <fieldset className="rounded-lg border border-stone-200 p-4">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-stone-400">
          Endereço (usado nos termos de consentimento)
        </legend>
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-4">
            <Label htmlFor="d-street">Rua</Label>
            <Input id="d-street" name="addressStreet" defaultValue={initial.addressStreet} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="d-number">Número</Label>
            <Input id="d-number" name="addressNumber" defaultValue={initial.addressNumber} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="d-district">Bairro</Label>
            <Input id="d-district" name="addressDistrict" defaultValue={initial.addressDistrict} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="d-city">Cidade</Label>
            <Input id="d-city" name="addressCity" defaultValue={initial.addressCity} />
          </div>
          <div className="col-span-1">
            <Label htmlFor="d-state">UF</Label>
            <Input id="d-state" name="addressState" defaultValue={initial.addressState} maxLength={2} />
          </div>
          <div className="col-span-1">
            <Label htmlFor="d-zip">CEP</Label>
            <Input id="d-zip" name="addressZip" defaultValue={initial.addressZip} />
          </div>
        </div>
      </fieldset>

      <div>
        <Label htmlFor="d-notes" hint="visível só para a equipe">Observações</Label>
        <Textarea id="d-notes" name="notes" rows={2} defaultValue={initial.notes} />
      </div>

      </fieldset>
      <FieldError message={error} />
      {saved ? <p className="text-sm text-emerald-600">Dados salvos!</p> : null}

      {readOnly ? (
        <p className="text-xs text-stone-400">
          Somente leitura — peça para a recepção ou a administradora atualizar os dados.
        </p>
      ) : (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
      )}
    </form>
  );
}
