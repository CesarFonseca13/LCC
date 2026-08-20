interface PagePlaceholderProps {
  title: string;
  description: string;
  phase: string;
}

/** Estado "em construção" — cada tela diz o que vai existir nela e quando chega. */
export function PagePlaceholder({ title, description, phase }: PagePlaceholderProps) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-stone-800">{title}</h1>
      <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white px-6 py-16 text-center">
        <p className="max-w-md text-sm text-stone-600">{description}</p>
        <span className="mt-4 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
          {phase}
        </span>
      </div>
    </div>
  );
}
