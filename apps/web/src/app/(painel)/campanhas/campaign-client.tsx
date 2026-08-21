"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import {
  createCampaign,
  deleteCampaign,
  previewCampaign,
  startCampaign,
  transitionCampaign,
} from "./actions";

const DEFAULT_TEMPLATE =
  "Oi {{nome}}, tudo bem? 💛 Temos uma novidade especial na {{clinica}} essa semana e lembrei de você! Quer saber mais? É só responder por aqui. (Se preferir não receber avisos assim, responda SAIR)";

export function NewCampaignButton({
  procedures,
}: {
  procedures: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function readSegment(form: HTMLFormElement) {
    const fd = new FormData(form);
    return {
      status: String(fd.get("status") ?? "todas") as "todas" | "active" | "lead",
      procedureId: String(fd.get("procedureId") ?? "all"),
      semVisitaDias: String(fd.get("semVisitaDias") ?? "0"),
    };
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Nova campanha</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nova campanha">
        <form
          id="campaign-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setError(undefined);
            startTransition(async () => {
              const result = await createCampaign({
                name: String(fd.get("name") ?? ""),
                messageTemplate: String(fd.get("messageTemplate") ?? ""),
                dailyCap: String(fd.get("dailyCap") ?? "30") as "10" | "30" | "50",
                segment: readSegment(form),
              });
              if (result.ok) {
                setOpen(false);
                setPreview(null);
                router.refresh();
              } else setError(result.error);
            });
          }}
          className="space-y-3"
        >
          <div>
            <Label htmlFor="cp-name">Nome da campanha</Label>
            <Input id="cp-name" name="name" placeholder="Promoção de setembro" required />
          </div>
          <div>
            <Label htmlFor="cp-msg" hint="use {{nome}} e {{clinica}}">
              Mensagem
            </Label>
            <Textarea id="cp-msg" name="messageTemplate" rows={4} defaultValue={DEFAULT_TEMPLATE} />
            <p className="mt-1 text-xs text-stone-400">
              Dica: mantenha o final com “responda SAIR” — respeitar quem não quer receber
              protege o seu número.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="cp-status">Quem recebe</Label>
              <Select id="cp-status" name="status">
                <option value="todas">Todas as clientes</option>
                <option value="active">Só ativas</option>
                <option value="lead">Só leads</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="cp-proc">Que já fizeram</Label>
              <Select id="cp-proc" name="procedureId">
                <option value="all">Não filtrar por procedimento</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="cp-gap">Sem visita há</Label>
              <Select id="cp-gap" name="semVisitaDias">
                <option value="0">Tanto faz</option>
                <option value="30">mais de 30 dias</option>
                <option value="60">mais de 60 dias</option>
                <option value="90">mais de 90 dias</option>
                <option value="180">mais de 180 dias</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="cp-cap" hint="envio gradual protege o número">
              Ritmo de envio
            </Label>
            <Select id="cp-cap" name="dailyCap" defaultValue="30">
              <option value="10">Até 10 por dia (número novo)</option>
              <option value="30">Até 30 por dia (recomendado)</option>
              <option value="50">Até 50 por dia (número aquecido)</option>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                const form = document.getElementById("campaign-form") as HTMLFormElement;
                setError(undefined);
                startTransition(async () => {
                  const result = await previewCampaign({ segment: readSegment(form) });
                  if (result.ok) setPreview(result.count ?? 0);
                  else setError(result.error);
                });
              }}
            >
              Ver quantas clientes
            </Button>
            {preview !== null ? (
              <span className="text-sm text-stone-600">
                <span className="font-semibold text-teal-700">{preview}</span> cliente
                {preview === 1 ? "" : "s"} nesse filtro
              </span>
            ) : null}
          </div>

          <FieldError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar rascunho"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function CampaignActions({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [confirmingStart, setConfirmingStart] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex gap-2">
        {status === "draft" ? (
          confirmingStart ? (
            <>
              <span className="self-center text-xs text-stone-500">
                Começa a enviar agora, aos poucos.
              </span>
              <Button
                disabled={pending}
                onClick={() => {
                  setConfirmingStart(false);
                  run(() => startCampaign({ id }));
                }}
              >
                Confirmar
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingStart(false)}>
                Voltar
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirmingStart(true)}>Iniciar</Button>
          )
        ) : null}
        {status === "running" ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => transitionCampaign({ id, to: "paused" }))}
          >
            Pausar
          </Button>
        ) : null}
        {status === "paused" ? (
          <Button
            disabled={pending}
            onClick={() => run(() => transitionCampaign({ id, to: "running" }))}
          >
            Retomar
          </Button>
        ) : null}
        {["draft", "running", "paused"].includes(status) ? (
          confirmingCancel ? (
            <>
              <span className="self-center text-xs text-stone-500">Cancelar de vez?</span>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setConfirmingCancel(false);
                  run(() => transitionCampaign({ id, to: "cancelled" }));
                }}
              >
                Sim, cancelar
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
                Voltar
              </Button>
            </>
          ) : (
            <Button variant="danger" disabled={pending} onClick={() => setConfirmingCancel(true)}>
              Cancelar
            </Button>
          )
        ) : null}
        {["draft", "cancelled"].includes(status) ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => deleteCampaign({ id }))}
          >
            Excluir
          </Button>
        ) : null}
      </span>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
