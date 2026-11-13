import { z } from 'zod';

/**
 * Localizzazione messaggi errore Zod in italiano.
 *
 * Esperti consultati:
 * - Content Designer: "Mai mostrare 'String must contain at least 1 character'
 *   in un sito IT. Sempre 'Campo obbligatorio', 'Email non valida'."
 * - Senior Code Reviewer: "z.setErrorMap globale → ogni schema usa default IT.
 *   Override field-specific via z.string().email('Email custom message') se serve."
 *
 * Import in app/layout.tsx o in QueryProvider per attivazione globale.
 *
 * 13/11/2026 (R24-019) — TRE FRASI SBAGLIATE. «Atteso number» (il tipo tecnico, in
 * inglese), «Seleziona almeno 1 elementi» (il plurale fisso) e «Valore non valido.
 * Usa: valore_a, valore_b» (le chiavi interne dell'elenco, che al cliente non dicono
 * niente). Le frasi stanno qui sotto, una volta sola.
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
  almenoElementi: (n: number | bigint) => `Seleziona almeno ${quanti(n, 'elemento', 'elementi')}`,
  email: 'Email non valida',
  url: 'URL non valido',
  uuid: 'ID non valido',
  formato: 'Formato non valido',
  scelta: 'Valore non valido: scegline uno fra quelli proposti',
};

z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: FRASI_ZOD.obbligatorio };
      }
      return { message: FRASI_ZOD.tipo(issue.expected) };

    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return { message: FRASI_ZOD.almenoCaratteri(issue.minimum) };
      }
      if (issue.type === 'number') {
        return { message: FRASI_ZOD.minimo(issue.minimum) };
      }
      if (issue.type === 'array') {
        return { message: FRASI_ZOD.almenoElementi(issue.minimum) };
      }
      break;

    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: FRASI_ZOD.massimoCaratteri(issue.maximum) };
      }
      if (issue.type === 'number') {
        return { message: FRASI_ZOD.massimo(issue.maximum) };
      }
      break;

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: FRASI_ZOD.email };
      if (issue.validation === 'url')   return { message: FRASI_ZOD.url };
      if (issue.validation === 'uuid')  return { message: FRASI_ZOD.uuid };
      if (issue.validation === 'regex') return { message: FRASI_ZOD.formato };
      break;

    case z.ZodIssueCode.invalid_enum_value:
      return { message: FRASI_ZOD.scelta };

    case z.ZodIssueCode.custom:
      // Per messaggi custom dello schema, ritorna quello originale
      break;
  }

  return { message: ctx.defaultError };
});
