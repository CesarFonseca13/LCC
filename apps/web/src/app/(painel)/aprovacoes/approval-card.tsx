"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, FieldError, Textarea } from "@/components/ui";
import { approveAllPending, approveMessage, rejectMessage } from "./actions";

export interface ApprovalView {
  id: string;
  customerName: string;
  customerId: string;
  automationLabel: string;
  body: string;
  contextLine: string | null;
  expiresAtISO: string | null;
}

function countdown(expiresAtISO: string | null): string | null {
  if (!expiresAtISO) return null;
  const ms = new Date(expiresAtISO).getTime() - Date.now();
  if (ms <= 0) return "expirada";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `expira em ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `expira em ${h}h` : null;
}

export function ApprovalCard({ approval }: { approval: ApprovalView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(approval.body);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [timeLeft, setTimeLeft] = useState<string | null>(countdown(approval.expiresAtISO));

  useEffect(() => {
    const timer = setInterval(
      () => setTimeLeft(countdown(approval.expiresAtISO)),
      30_000,
    );
    return () => clearInterval(timer);
  }, [approval.expiresAtISO]);

  function approve() {
    setError(undefined);
    startTransition(async () => {
      const result = await approveMessage({
        id: approval.id,
        editedBody: editing ? body : undefined,
      });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function reject() {
    setError(undefined);
    startTransition(async () => {
      const result = await rejectMessage({ id: approval.id });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            href={`/clientes/${approval.customerId}`}
            className="text-sm font-semibold text-teal-800 hover:underline"
          >
            {approval.customerName}
          </Link>
          <p className="text-xs text-stone-500">
            {approval.automationLabel}
            {approval.contextLine ? ` · ${approval.contextLine}` : ""}
          </p>
        </div>
        {timeLeft ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              timeLeft.startsWith("expira em") && timeLeft.includes("min")
                ? "bg-amber-50 text-amber-700"
                : "bg-stone-100 text-stone-500"
            }`}
          >
            {timeLeft}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        {editing ? (
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            autoFocus
          />
        ) : (
          <p className="whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2.5 text-sm text-stone-700">
            {body}
          </p>
        )}
      </div>

      <FieldError message={error} />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={approve} disabled={pending}>
          {pending ? "..." : editing ? "Aprovar com edição" : "Aprovar e enviar"}
        </Button>
        {!editing ? (
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={pending}>
            Editar
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(false);
              setBody(approval.body);
            }}
            disabled={pending}
          >
            Descartar edição
          </Button>
        )}
        <Button variant="danger" onClick={reject} disabled={pending}>
          Descartar
        </Button>
      </div>
    </div>
  );
}

export function ApproveAllButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await approveAllPending({});
          router.refresh();
        })
      }
    >
      {pending ? "Aprovando..." : `Aprovar todas (${count})`}
    </Button>
  );
}
