import { TERMS_SECTIONS, TERMS_VERSION, termsVersionLabel } from "@clinicaos/core/terms-of-use";

/** Texto dos Termos de Uso — o mesmo na página pública e na tela de aceite. */
export function TermsBody() {
  return (
    <div className="space-y-6 text-sm leading-relaxed text-stone-700">
      <p className="text-xs text-stone-400">Versão de {termsVersionLabel(TERMS_VERSION)}</p>
      {TERMS_SECTIONS.map((section) => {
        const blocks: React.ReactNode[] = [];
        let list: string[] = [];
        const flushList = () => {
          if (list.length === 0) return;
          blocks.push(
            <ul key={`l${blocks.length}`} className="list-disc space-y-1.5 pl-5">
              {list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>,
          );
          list = [];
        };
        for (const p of section.paragraphs) {
          if (p.startsWith("- ")) {
            list.push(p.slice(2));
            continue;
          }
          flushList();
          blocks.push(<p key={`p${blocks.length}`}>{p}</p>);
        }
        flushList();
        return (
          <section key={section.title}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">{section.title}</h2>
            <div className="space-y-2.5">{blocks}</div>
          </section>
        );
      })}
    </div>
  );
}
