/** Constantes do cadastro da clínica — wizard de implantação, Configurações e actions. */

export const SPECIALTIES = [
  { value: "estetica_facial", label: "Estética facial" },
  { value: "estetica_corporal", label: "Estética corporal" },
  { value: "harmonizacao", label: "Harmonização orofacial" },
  { value: "depilacao", label: "Depilação a laser" },
  { value: "dermatologia", label: "Dermatologia" },
  { value: "odontologia", label: "Odontologia" },
  { value: "medica", label: "Clínica médica / consultório" },
  { value: "fisioterapia", label: "Fisioterapia" },
  { value: "nutricao", label: "Nutrição" },
  { value: "psicologia", label: "Psicologia" },
  { value: "veterinaria", label: "Veterinária" },
  { value: "outra", label: "Outra" },
] as const;

export type Specialty = (typeof SPECIALTIES)[number]["value"];
export const SPECIALTY_VALUES = SPECIALTIES.map((s) => s.value) as unknown as [
  Specialty,
  ...Specialty[],
];

export const WEEKDAYS = [
  { key: "mon", label: "Segunda-feira", short: "Seg" },
  { key: "tue", label: "Terça-feira", short: "Ter" },
  { key: "wed", label: "Quarta-feira", short: "Qua" },
  { key: "thu", label: "Quinta-feira", short: "Qui" },
  { key: "fri", label: "Sexta-feira", short: "Sex" },
  { key: "sat", label: "Sábado", short: "Sáb" },
  { key: "sun", label: "Domingo", short: "Dom" },
] as const;
export type WeekdayKey = (typeof WEEKDAYS)[number]["key"];

/** Formato gravado em clinics.business_hours: dia ausente = fechado. */
export type BusinessHours = Partial<Record<WeekdayKey, [string, string][]>>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: [["08:00", "19:00"]],
  tue: [["08:00", "19:00"]],
  wed: [["08:00", "19:00"]],
  thu: [["08:00", "19:00"]],
  fri: [["08:00", "19:00"]],
  sat: [["09:00", "14:00"]],
};

export const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília — SP, RJ, MG, PR, SC, RS, ES, GO, DF" },
  { value: "America/Bahia", label: "Salvador — BA" },
  { value: "America/Fortaleza", label: "Fortaleza — CE, MA, PI, PB, RN" },
  { value: "America/Recife", label: "Recife — PE" },
  { value: "America/Maceio", label: "Maceió — AL, SE" },
  { value: "America/Belem", label: "Belém — PA, AP" },
  { value: "America/Araguaina", label: "Araguaína — TO" },
  { value: "America/Cuiaba", label: "Cuiabá — MT" },
  { value: "America/Campo_Grande", label: "Campo Grande — MS" },
  { value: "America/Manaus", label: "Manaus — AM, RR, RO" },
  { value: "America/Rio_Branco", label: "Rio Branco — AC" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
] as const;
