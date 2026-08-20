import { requireAuth } from "@/lib/auth-action";

function saudacao(): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

function dataDeHoje(): string {
  const data = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  return data.charAt(0).toUpperCase() + data.slice(1);
}

const CARDS_HOJE = [
  { label: "Agendamentos", value: 0 },
  { label: "Confirmados", value: 0 },
  { label: "Aguardando confirmação", value: 0 },
  { label: "Faltas", value: 0 },
];

export default async function InicioPage() {
  const auth = await requireAuth();
  const primeiroNome = auth.userName.split(" ")[0];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-stone-800">
        {saudacao()}, {primeiroNome}!
      </h1>
      <p className="mt-0.5 text-sm text-stone-500">{dataDeHoje()}</p>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {CARDS_HOJE.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-stone-200 bg-white p-4"
          >
            <p className="text-sm text-stone-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-800">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="text-sm font-medium text-stone-700">Agenda de hoje</h2>
        <p className="mt-4 text-center text-sm text-stone-500">
          Nenhum agendamento por aqui ainda — a Agenda chega no próximo milestone.
          Toque em “Agenda” para acompanhar o progresso.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="text-sm font-medium text-stone-700">
          O que as automações fizeram hoje
        </h2>
        <p className="mt-4 text-center text-sm text-stone-500">
          Quando o WhatsApp estiver conectado, este bloco mostra lembretes enviados,
          confirmações recebidas e faltas em recuperação — tudo sozinho.
        </p>
      </section>
    </div>
  );
}
