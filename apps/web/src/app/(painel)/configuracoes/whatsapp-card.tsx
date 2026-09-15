"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button, FieldError, Input, Label } from "@/components/ui";
import {
  connectMetaWhatsApp,
  deleteWhatsAppNumber,
  disconnectWhatsApp,
  makePrimaryWhatsApp,
  pollWhatsApp,
  renameWhatsApp,
  setupWhatsApp,
  syncMetaTemplates,
} from "./actions";

export interface InstanceView {
  id: string;
  label: string;
  phone: string | null;
  status: string;
  qr: string | null;
  isPrimary: boolean;
  /** 'evolution' (QR code) ou 'meta' (API oficial). Ausente = evolution. */
  provider?: "evolution" | "meta";
  meta?: {
    phoneNumberId: string;
    wabaId: string;
    tokenHint: string | null;
    verifiedName: string | null;
    templates: { approved: number; pending: number; rejected: number; total: number };
  } | null;
}

/** Dados que a clínica precisa colar no painel da Meta ao cadastrar o webhook. */
export interface MetaSetupInfo {
  webhookUrl: string;
  verifyToken: string | null;
  /** Já existe um app central da Meta (segredo no servidor): a clínica pode pular o App Secret. */
  hasCentralSecret: boolean;
}

const CONNECTING = ["created", "qr_pending", "connecting"];

function StatusPill({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Conectado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
      <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
      {CONNECTING.includes(status) ? "Aguardando leitura do código" : "Não conectado"}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: "evolution" | "meta" }) {
  return provider === "meta" ? (
    <span
      className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"
      title="Conectado pela WhatsApp Business Platform (API oficial da Meta) — sem risco de bloqueio"
    >
      API oficial
    </span>
  ) : (
    <span
      className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500"
      title="Conectado por QR code (como o WhatsApp Web) — o WhatsApp pode bloquear o número"
    >
      QR code
    </span>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copiado!" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}

/** Formulário da API oficial: credenciais do número + instruções do webhook. */
function MetaConnectForm({
  instance,
  metaSetup,
  onDone,
  onCancel,
}: {
  instance?: InstanceView;
  metaSetup?: MetaSetupInfo;
  onDone: (next: InstanceView) => void;
  onCancel: () => void;
}) {
  const [phoneNumberId, setPhoneNumberId] = useState(instance?.meta?.phoneNumberId ?? "");
  const [wabaId, setWabaId] = useState(instance?.meta?.wabaId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [label, setLabel] = useState(instance?.label ?? "");
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [pending, startTransition] = useTransition();
  const reconnecting = Boolean(instance);

  function submit() {
    setError(undefined);
    setWarning(undefined);
    startTransition(async () => {
      const r = await connectMetaWhatsApp({
        instanceId: instance?.id,
        phoneNumberId,
        wabaId,
        accessToken,
        appSecret,
        label,
      });
      if (!r.ok) {
        setError(r.error ?? "Não deu certo — confira as credenciais.");
        return;
      }
      if (r.warning) setWarning(r.warning);
      onDone({
        id: r.instanceId ?? instance?.id ?? "",
        label: label || instance?.label || "Principal",
        phone: r.phone ?? instance?.phone ?? null,
        status: "connected",
        qr: null,
        isPrimary: instance?.isPrimary ?? true,
        provider: "meta",
        meta: {
          phoneNumberId,
          wabaId,
          tokenHint: accessToken ? accessToken.slice(-4) : (instance?.meta?.tokenHint ?? null),
          verifiedName: instance?.meta?.verifiedName ?? null,
          templates: r.templates ?? { approved: 0, pending: 0, rejected: 0, total: 0 },
        },
      });
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-lg border border-sky-200 bg-sky-50/40 p-4"
    >
      <p className="text-sm font-semibold text-stone-800">
        {reconnecting ? "Reconectar pela API oficial da Meta" : "Conectar pela API oficial da Meta"}
      </p>
      <p className="mt-1 text-sm text-stone-600">
        É a integração autorizada pelo WhatsApp: sem risco de bloqueio do número. Conversas
        respondidas em até 24h são gratuitas; lembretes e mensagens automáticas fora desse prazo
        saem como modelos aprovados pela Meta (cobrados por mensagem pela própria Meta).
      </p>

      <details className="mt-3 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-600">
        <summary className="cursor-pointer font-medium text-teal-700">
          Onde encontro essas informações? (passo a passo)
        </summary>
        <p className="mt-2 text-xs text-stone-500">
          Guia completo, com custos e as telas da Meta:{" "}
          <a
            href="/ajuda/whatsapp-api-oficial"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-teal-700 underline"
          >
            abrir o guia da API oficial
          </a>
          .
        </p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Acesse <strong>developers.facebook.com</strong>, crie (ou abra) um app do tipo
            Empresa e adicione o produto <strong>WhatsApp</strong>.
          </li>
          <li>
            Em <strong>WhatsApp → Configuração da API</strong>, copie o{" "}
            <strong>Identificação do número de telefone</strong> (Phone Number ID) e o{" "}
            <strong>Identificação da conta do WhatsApp Business</strong> (WABA ID).
          </li>
          <li>
            Gere um <strong>token permanente</strong>: Meta Business → Configurações →
            Usuários do sistema → adicionar usuário (admin) → Gerar token, com as permissões{" "}
            <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>.
          </li>
          <li>
            Em <strong>Configurações do app → Básico</strong>, copie a{" "}
            <strong>Chave secreta do app</strong> (App Secret).
          </li>
          <li>
            Em <strong>WhatsApp → Configuração → Webhooks</strong>, cadastre a URL e o token de
            verificação abaixo e assine o campo <strong>messages</strong>.
          </li>
        </ol>
        {metaSetup ? (
          <div className="mt-3 grid grid-cols-1 gap-3">
            <CopyField label="URL do webhook" value={metaSetup.webhookUrl} />
            {metaSetup.verifyToken ? (
              <CopyField label="Token de verificação" value={metaSetup.verifyToken} />
            ) : (
              <p className="text-xs text-amber-700">
                O servidor ainda não tem um token de verificação configurado (META_WEBHOOK_VERIFY_TOKEN)
                — avise o suporte antes de cadastrar o webhook.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-stone-400">
            A URL do webhook e o token de verificação aparecem em Configurações → Números do WhatsApp.
          </p>
        )}
      </details>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="meta-phone-id">Phone Number ID</Label>
          <Input
            id="meta-phone-id"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="ex.: 106540352242922"
            data-autofocus
          />
        </div>
        <div>
          <Label htmlFor="meta-waba-id">ID da conta do WhatsApp Business</Label>
          <Input
            id="meta-waba-id"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="ex.: 102290129340398"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="meta-token" hint={reconnecting ? "deixe em branco para manter o atual" : undefined}>
            Token permanente
          </Label>
          <Input
            id="meta-token"
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={reconnecting && instance?.meta?.tokenHint ? `salvo (termina em ${instance.meta.tokenHint})` : "EAAG..."}
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <Label
            htmlFor="meta-secret"
            hint={metaSetup?.hasCentralSecret ? "opcional — só se a clínica usa o próprio app da Meta" : reconnecting ? "deixe em branco para manter o atual" : undefined}
          >
            App Secret (chave secreta do app)
          </Label>
          <Input
            id="meta-secret"
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="meta-label" hint="opcional">
            Apelido do número
          </Label>
          <Input id="meta-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Recepção, Campanhas..." maxLength={40} />
        </div>
      </div>

      <FieldError message={error} />
      {warning ? <p className="mt-2 text-xs text-amber-700">{warning}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || phoneNumberId.length < 5 || wabaId.length < 5}>
          {pending ? "Validando na Meta..." : reconnecting ? "Reconectar" : "Conectar pela API oficial"}
        </Button>
      </div>
    </form>
  );
}

function InstanceRow({
  instance,
  metaSetup,
  onChange,
  onRemove,
  canRemoveConnect,
}: {
  instance: InstanceView;
  metaSetup?: MetaSetupInfo;
  onChange: (next: InstanceView) => void;
  onRemove: (id: string) => void;
  canRemoveConnect: boolean;
}) {
  const [error, setError] = useState<string>();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(instance.label);
  const [reconnecting, setReconnecting] = useState(false);
  const [pending, startTransition] = useTransition();
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  const provider = instance.provider ?? "evolution";

  // Enquanto aguarda o QR ser lido, consulta o status a cada 3s
  useEffect(() => {
    const active = provider === "evolution" && CONNECTING.includes(instance.status);
    if (active && !polling.current) {
      polling.current = setInterval(() => {
        void pollWhatsApp({ instanceId: instance.id }).then((r) => {
          if (!r.ok) return;
          onChange({
            ...instance,
            status: r.status ?? instance.status,
            qr: r.qrCode ?? null,
            phone: r.phone ?? instance.phone,
          });
        });
      }, 3000);
    }
    if (!active && polling.current) {
      clearInterval(polling.current);
      polling.current = null;
    }
    return () => {
      if (polling.current) {
        clearInterval(polling.current);
        polling.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.status, instance.id]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Não deu certo — tente de novo.");
      else after?.();
    });
  }

  const templates = instance.meta?.templates;

  return (
    <div className="rounded-lg border border-stone-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {editingLabel ? (
            <form
              className="flex items-center gap-1"
              action={() =>
                run(
                  () => renameWhatsApp({ instanceId: instance.id, label: labelDraft }),
                  () => {
                    setEditingLabel(false);
                    onChange({ ...instance, label: labelDraft });
                  },
                )
              }
            >
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                className="w-36 rounded border border-stone-300 px-2 py-1 text-sm"
                maxLength={40}
                autoFocus
              />
              <Button type="submit" variant="ghost" disabled={pending}>
                ok
              </Button>
            </form>
          ) : (
            <button
              type="button"
              className="text-sm font-semibold text-stone-800 hover:underline"
              title="Renomear (ex.: Recepção, Campanhas)"
              onClick={() => setEditingLabel(true)}
            >
              {instance.label} ✏️
            </button>
          )}
          <ProviderBadge provider={provider} />
          {instance.isPrimary ? (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
              principal
            </span>
          ) : null}
          {instance.phone ? <span className="text-xs text-stone-400">{instance.phone}</span> : null}
          {instance.meta?.verifiedName ? (
            <span className="text-xs text-stone-400">· {instance.meta.verifiedName}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={instance.status} />
          {instance.status === "connected" ? (
            <>
              {!instance.isPrimary ? (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => makePrimaryWhatsApp({ instanceId: instance.id }),
                      () => onChange({ ...instance, isPrimary: true }),
                    )
                  }
                >
                  Tornar principal
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run(
                    () => disconnectWhatsApp({ instanceId: instance.id }),
                    () => onChange({ ...instance, status: "disconnected", qr: null }),
                  )
                }
              >
                Desconectar
              </Button>
            </>
          ) : (
            <>
              {provider === "meta" ? (
                <Button disabled={pending} onClick={() => setReconnecting(true)}>
                  Reconectar
                </Button>
              ) : !CONNECTING.includes(instance.status) && canRemoveConnect ? (
                <Button
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => setupWhatsApp({ instanceId: instance.id }),
                      () => onChange({ ...instance, status: "qr_pending" }),
                    )
                  }
                >
                  {pending ? "Preparando..." : "Conectar"}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Excluir "${instance.label}"? Se houver conversas nele, elas passam para outro número da clínica — o histórico não some.`,
                    )
                  )
                    return;
                  run(
                    () => deleteWhatsAppNumber({ instanceId: instance.id }),
                    () => onRemove(instance.id),
                  );
                }}
              >
                Excluir
              </Button>
            </>
          )}
        </div>
      </div>

      {provider === "evolution" && CONNECTING.includes(instance.status) ? (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <div className="rounded-xl border border-stone-200 p-3">
            {instance.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={instance.qr.startsWith("data:") ? instance.qr : `data:image/png;base64,${instance.qr}`}
                alt="QR Code para conectar o WhatsApp"
                className="h-52 w-52"
              />
            ) : (
              <div className="flex h-52 w-52 items-center justify-center text-sm text-stone-400">
                Gerando código...
              </div>
            )}
          </div>
          <ol className="max-w-xs list-decimal space-y-2 pl-5 text-sm text-stone-600">
            <li>
              No celular <strong>deste número</strong>, abra o <strong>WhatsApp</strong>.
            </li>
            <li>
              Toque em <strong>⋮ → Dispositivos conectados → Conectar dispositivo</strong>.
            </li>
            <li>Aponte a câmera para o código ao lado.</li>
          </ol>
        </div>
      ) : null}

      {provider === "meta" && templates ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <span>
            Modelos na Meta: <strong className="text-emerald-700">{templates.approved} aprovados</strong>
            {templates.pending > 0 ? <> · {templates.pending} em análise</> : null}
            {templates.rejected > 0 ? <> · <span className="text-red-600">{templates.rejected} com problema</span></> : null}
            {templates.total === 0 ? " — nenhum registrado ainda" : ""}
          </span>
          <button
            type="button"
            className="text-teal-700 underline-offset-2 hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  syncMetaTemplates({ instanceId: instance.id }).then((r) => {
                    if (r.ok && r.templates && instance.meta) {
                      onChange({ ...instance, meta: { ...instance.meta, templates: r.templates } });
                    }
                    return r;
                  }),
              )
            }
          >
            atualizar
          </button>
          {templates.pending > 0 ? (
            <span className="text-stone-400">
              (a Meta aprova em até 24h — até lá, lembretes fora da janela de 24h aguardam)
            </span>
          ) : null}
        </div>
      ) : null}

      {reconnecting ? (
        <div className="mt-4">
          <MetaConnectForm
            instance={instance}
            metaSetup={metaSetup}
            onCancel={() => setReconnecting(false)}
            onDone={(next) => {
              setReconnecting(false);
              onChange(next);
            }}
          />
        </div>
      ) : null}

      <FieldError message={error} />
    </div>
  );
}

/** Escolha do caminho de conexão — a API oficial em primeiro, com o risco do QR code dito na hora. */
function ConnectChooser({
  onMeta,
  onQr,
  onCancel,
  pending,
}: {
  onMeta: () => void;
  onQr: () => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 p-5">
      <p className="text-sm font-medium text-stone-700">Como você quer conectar o número?</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onMeta}
          disabled={pending}
          className="rounded-lg border border-sky-200 bg-sky-50/50 p-4 text-left transition hover:border-sky-400 disabled:opacity-60"
        >
          <p className="text-sm font-semibold text-stone-800">
            API oficial da Meta <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">recomendado</span>
          </p>
          <p className="mt-1 text-xs text-stone-600">
            Integração autorizada pelo WhatsApp: <strong>sem risco de bloqueio</strong>. Conversas em até 24h
            são grátis; lembretes e avisos automáticos fora desse prazo saem como modelos aprovados e a Meta
            cobra centavos por mensagem. Precisa de um app da Meta e de um número dedicado.
          </p>
        </button>
        <button
          type="button"
          onClick={onQr}
          disabled={pending}
          className="rounded-lg border border-stone-200 p-4 text-left transition hover:border-stone-400 disabled:opacity-60"
        >
          <p className="text-sm font-semibold text-stone-800">QR code (como o WhatsApp Web)</p>
          <p className="mt-1 text-xs text-stone-600">
            Escaneia e pronto, sem custo por mensagem. <span className="font-medium text-amber-700">Atenção:</span>{" "}
            não é a integração oficial — o WhatsApp pode <strong>bloquear o número</strong> se considerar o uso
            abusivo. Use um número exclusivo da clínica e mantenha o volume moderado.
          </p>
        </button>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        Quanto custa e como a clínica cadastra o próprio app na Meta:{" "}
        <a
          href="/ajuda/whatsapp-api-oficial"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-teal-700 underline"
        >
          guia da API oficial
        </a>
        .
      </p>
      {onCancel ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function WhatsAppCard({
  initialInstances,
  metaSetup,
}: {
  initialInstances: InstanceView[];
  metaSetup?: MetaSetupInfo;
}) {
  const [instances, setInstances] = useState<InstanceView[]>(initialInstances);
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState<"choose" | "meta" | null>(null);
  const [pending, startTransition] = useTransition();

  // O vigia muda o status no servidor e a página se recarrega sozinha — o
  // card precisa ACEITAR o estado novo (useState ignora props novas). Sem
  // isso, um número que caiu continuava "Conectado" na tela até dar F5.
  const serverKey = initialInstances
    .map((i) => `${i.id}:${i.status}:${i.phone}:${i.isPrimary}:${i.meta?.templates.approved ?? "-"}`)
    .join("|");
  const lastServerKey = useRef(serverKey);
  useEffect(() => {
    if (lastServerKey.current !== serverKey) {
      lastServerKey.current = serverKey;
      setInstances(initialInstances);
    }
  }, [serverKey, initialInstances]);

  function addQrNumber() {
    setError(undefined);
    startTransition(async () => {
      const r = await setupWhatsApp({});
      if (r.ok && r.instanceId) {
        setInstances((prev) => [
          ...prev,
          {
            id: r.instanceId!,
            label: prev.length === 0 ? "Principal" : `Número ${prev.length + 1}`,
            phone: null,
            status: r.status ?? "qr_pending",
            qr: r.qrCode ?? null,
            isPrimary: prev.length === 0,
            provider: "evolution",
            meta: null,
          },
        ]);
        setAdding(null);
      } else if (!r.ok) {
        setError(r.error);
      }
    });
  }

  const soQr = instances.length > 0 && instances.every((i) => (i.provider ?? "evolution") === "evolution");

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">Números do WhatsApp</h2>
        {instances.length > 0 && !adding ? (
          <Button variant="ghost" onClick={() => setAdding("choose")} disabled={pending}>
            + Conectar outro número
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Com mais de um número, as campanhas se dividem entre eles (mais alcance por dia,
        menos risco). Cada cliente sempre fala com o mesmo número.
      </p>

      <div className="mt-4 space-y-3">
        {instances.map((inst) => (
          <InstanceRow
            key={inst.id}
            instance={inst}
            metaSetup={metaSetup}
            canRemoveConnect
            onRemove={(id) => setInstances((prev) => prev.filter((p) => p.id !== id))}
            onChange={(next) =>
              setInstances((prev) => {
                const updated = prev.map((p) => (p.id === next.id ? next : p));
                // "Tornar principal" derruba a marcação dos outros na tela
                return next.isPrimary
                  ? updated.map((p) => (p.id === next.id ? p : { ...p, isPrimary: false }))
                  : updated;
              })
            }
          />
        ))}

        {instances.length === 0 && !adding ? (
          <div className="rounded-lg border border-dashed border-stone-300 p-5">
            <p className="text-center text-sm text-stone-500">
              Conecte o número da clínica para ativar lembretes, confirmações e o atendimento
              pelo painel. Leva poucos minutos e não desconecta o celular.
            </p>
            <div className="mt-3">
              <ConnectChooser onMeta={() => setAdding("meta")} onQr={addQrNumber} pending={pending} />
            </div>
          </div>
        ) : null}

        {adding === "choose" ? (
          <ConnectChooser
            onMeta={() => setAdding("meta")}
            onQr={addQrNumber}
            onCancel={() => setAdding(null)}
            pending={pending}
          />
        ) : null}

        {adding === "meta" ? (
          <MetaConnectForm
            metaSetup={metaSetup}
            onCancel={() => setAdding(null)}
            onDone={(next) => {
              setInstances((prev) => [
                ...prev.map((p) => (next.isPrimary ? { ...p, isPrimary: false } : p)),
                { ...next, isPrimary: prev.length === 0 },
              ]);
              setAdding(null);
            }}
          />
        ) : null}

        {soQr && !adding ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Seus números estão conectados por QR code — funciona como o WhatsApp Web e o WhatsApp pode
            bloquear o número se considerar o uso abusivo. Para risco zero, conecte pela{" "}
            <button type="button" className="font-medium underline" onClick={() => setAdding("meta")}>
              API oficial da Meta
            </button>
            .
          </p>
        ) : null}
      </div>

      <FieldError message={error} />
    </section>
  );
}
