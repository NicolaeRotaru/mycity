/**
 * R07-010 — Le frasi italiane di Zod, senza Zod. Stanno qui perché `lib/errors.ts` (che entra in ogni
 * pagina dal piede del sito) le legge per tradurre i testi inglesi che arrivano dal server, e non deve
 * portarsi dietro Zod e il traduttore (`lib/zod-i18n`, che accende `z.setErrorMap`).
 */

/** I tipi di Zod detti come li direbbe una persona: «serve un numero», non «Atteso number». */
const TIPI_IN_ITALIANO: Record<string, string> = {
  string: 'un testo',
  number: 'un numero',
  integer: 'un numero intero',
  bigint: 'un numero',
  float: 'un numero',
  boolean: 'sì o no',
  date: 'una data',
  array: 'un elenco',
  object: 'un gruppo di dati',
};

const quanti = (n: number | bigint, uno: string, tanti: string) => (Number(n) === 1 ? `1 ${uno}` : `${n} ${tanti}`);

export const FRASI_ZOD = {
  obbligatorio: 'Campo obbligatorio',
  tipo: (atteso: string) => `Valore non valido: serve ${TIPI_IN_ITALIANO[atteso] ?? 'un valore diverso'}`,
  almenoCaratteri: (n: number | bigint) => (Number(n) === 1 ? 'Campo obbligatorio' : `Almeno ${quanti(n, 'carattere', 'caratteri')}`),
  massimoCaratteri: (n: number | bigint) => `Massimo ${quanti(n, 'carattere', 'caratteri')}`,
  minimo: (n: number | bigint) => `Valore minimo: ${n}`,
  massimo: (n: number | bigint) => `Valore massimo: ${n}`,
  // Giro di correzione (R24-019) — Il limite escluso: positive() rifiuta lo 0, che non è
  // «Valore minimo: 0».
  maggioreDi: (n: number | bigint) => `Deve essere maggiore di ${n}`,
  minoreDi: (n: number | bigint) => `Deve essere minore di ${n}`,
  massimoElementi: (n: number | bigint) => `Massimo ${quanti(n, 'elemento', 'elementi')}`,
  almenoElementi: (n: number | bigint) => `Seleziona almeno ${quanti(n, 'elemento', 'elementi')}`,
  email: 'Email non valida',
  url: 'URL non valido',
  uuid: 'ID non valido',
  formato: 'Formato non valido',
  scelta: 'Valore non valido: scegline uno fra quelli proposti',
  // R04-003 — i quattro casi che restavano in inglese («Invalid input», «Unrecognized key(s)…»).
  // Non nominano le chiavi interne: al cliente non dicono niente.
  valoreNonValido: 'Valore non valido',
  campiInPiu: (n: number) => (n === 1 ? 'C’è un campo che non serve qui' : `Ci sono ${n} campi che non servono qui`),
  // R07-004 (onda 2) — i casi che restavano in inglese: multipleOf, finite, startsWith/endsWith/
  // includes, datetime/date/time, le date fuori limite. I numeri con la virgola, come si scrivono qui.
  multiploDi: (n: number | bigint) => `Deve essere un multiplo di ${String(n).replace('.', ',')}`,
  numeroFinito: 'Serve un numero valido',
  iniziaCon: (testo: string) => `Deve iniziare con «${testo}»`,
  finisceCon: (testo: string) => `Deve finire con «${testo}»`,
  contiene: (testo: string) => `Deve contenere «${testo}»`,
  data: 'Data non valida',
  orario: 'Orario non valido',
  dataDal: (giorno: string) => `La data deve essere dal ${giorno} in poi`,
  dataFinoAl: (giorno: string) => `La data deve essere entro il ${giorno}`,
};
