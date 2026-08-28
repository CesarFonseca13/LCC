/**
 * Feedback IMEDIATO ao trocar de página: o clique responde na hora com o
 * esqueleto, enquanto o conteúdo chega — essencial quando a rede até o
 * servidor tem latência alta (o "cliquei e nada aconteceu" some).
 */
export default function PainelLoading() {
  return (
    <div className="animate-pulse p-8">
      <div className="h-6 w-48 rounded bg-stone-200" />
      <div className="mt-2 h-4 w-72 rounded bg-stone-100" />
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-stone-200 bg-white p-4">
            <div className="h-4 w-20 rounded bg-stone-100" />
            <div className="mt-3 h-7 w-12 rounded bg-stone-200" />
          </div>
        ))}
      </div>
      <div className="mt-6 h-80 rounded-xl border border-stone-200 bg-white p-6">
        <div className="h-4 w-36 rounded bg-stone-100" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded bg-stone-50" />
          ))}
        </div>
      </div>
    </div>
  );
}
