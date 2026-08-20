"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Modal } from "@/components/ui";
import { importCustomersCsv, type ImportResult } from "./actions";

const TEMPLATE_CSV =
  "nome;telefone;email;nascimento;ultima_visita;ultimo_procedimento;total_gasto\n" +
  "Maria Silva;(11) 98862-1152;maria@email.com;10/05/1990;12/06/2026;Limpeza de Pele;180,00\n";

export function ImportButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ImportResult>();
  const [fileName, setFileName] = useState<string>();
  const [csvText, setCsvText] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function close() {
    setOpen(false);
    setResult(undefined);
    setError(undefined);
    setFileName(undefined);
    setCsvText(undefined);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file, "utf-8");
  }

  function submit() {
    if (!csvText) {
      setError("Escolha o arquivo preenchido a partir do modelo.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      try {
        const res = await importCustomersCsv({ csv: csvText });
        if (res.ok) {
          setResult(res);
          router.refresh();
        } else {
          setError(res.error ?? "Não foi possível importar.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível importar.");
      }
    });
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Importar planilha
      </Button>
      <Modal open={open} onClose={close} title="Importar clientes">
        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-700">
              <strong>{result.imported}</strong> cliente
              {result.imported === 1 ? "" : "s"} importada
              {result.imported === 1 ? "" : "s"}
              {result.skipped && result.skipped.length > 0
                ? ` · ${result.skipped.length} pulada${result.skipped.length === 1 ? "" : "s"}`
                : ""}
              .
            </p>
            {result.skipped && result.skipped.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                {result.skipped.map((s) => (
                  <p key={`${s.line}-${s.reason}`}>
                    Linha {s.line} ({s.name}): {s.reason}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button onClick={close}>Fechar</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-600">
              <li>
                <a
                  href={templateHref}
                  download="clientes-modelo.csv"
                  className="font-medium text-teal-700 underline"
                >
                  Baixe a planilha-modelo
                </a>{" "}
                e preencha uma cliente por linha (abre no Excel).
              </li>
              <li>Salve como CSV e envie o arquivo aqui.</li>
            </ol>
            <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
              Preenchendo <strong>ultima_visita</strong> e <strong>total_gasto</strong>, o
              histórico entra junto — é ele que alimenta as reativações automáticas e o
              ranking de clientes desde o primeiro dia.
            </p>
            <div>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="block w-full text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-teal-700 hover:file:bg-teal-100"
              />
              {fileName ? (
                <p className="mt-1 text-xs text-stone-500">Arquivo: {fileName}</p>
              ) : null}
            </div>

            <FieldError message={error} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending || !csvText}>
                {pending ? "Importando..." : "Importar"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
