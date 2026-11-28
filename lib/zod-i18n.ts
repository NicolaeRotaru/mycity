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

// R08-005 — Le frasi stanno in lib/zod-frasi (senza Zod): lib/errors.ts le legge da li' e non deve
// portarsi dietro Zod. Qui una copia sola, la stessa, riesportata per chi le prende da questo file.
import { FRASI_ZOD } from './zod-frasi';
export { FRASI_ZOD };

/** Il giorno di un limite di data, come lo legge una persona a Piacenza: «28/11/2026». */
const giornoItaliano = (ms: number | bigint) =>
  new Date(Number(ms)).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });

z.setErrorMap((issue) => {
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
      if (issue.type === 'number' || issue.type === 'bigint') {
        return { message: issue.inclusive ? FRASI_ZOD.minimo(issue.minimum) : FRASI_ZOD.maggioreDi(issue.minimum) };
      }
      if (issue.type === 'array' || issue.type === 'set') {
        return { message: FRASI_ZOD.almenoElementi(issue.minimum) };
      }
      if (issue.type === 'date') return { message: FRASI_ZOD.dataDal(giornoItaliano(issue.minimum)) };
      break;

    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: FRASI_ZOD.massimoCaratteri(issue.maximum) };
      }
      if (issue.type === 'number' || issue.type === 'bigint') {
        return { message: issue.inclusive ? FRASI_ZOD.massimo(issue.maximum) : FRASI_ZOD.minoreDi(issue.maximum) };
      }
      if (issue.type === 'array' || issue.type === 'set') {
        return { message: FRASI_ZOD.massimoElementi(issue.maximum) };
      }
      if (issue.type === 'date') return { message: FRASI_ZOD.dataFinoAl(giornoItaliano(issue.maximum)) };
      break;

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: FRASI_ZOD.email };
      if (issue.validation === 'url')   return { message: FRASI_ZOD.url };
      if (issue.validation === 'uuid')  return { message: FRASI_ZOD.uuid };
      if (issue.validation === 'regex') return { message: FRASI_ZOD.formato };
      // R07-004 (onda 2) — startsWith, endsWith e includes arrivano come oggetto; date e orari col loro nome.
      if (typeof issue.validation === 'object') {
        if ('startsWith' in issue.validation) return { message: FRASI_ZOD.iniziaCon(issue.validation.startsWith) };
        if ('endsWith' in issue.validation) return { message: FRASI_ZOD.finisceCon(issue.validation.endsWith) };
        if ('includes' in issue.validation) return { message: FRASI_ZOD.contiene(issue.validation.includes) };
      }
      if (issue.validation === 'datetime' || issue.validation === 'date') return { message: FRASI_ZOD.data };
      if (issue.validation === 'time' || issue.validation === 'duration') return { message: FRASI_ZOD.orario };
      // Le altre validazioni (ip, cuid, emoji, base64, jwt…): un formato sbagliato, senza il nome tecnico.
      return { message: FRASI_ZOD.formato };

    case z.ZodIssueCode.invalid_date:
      return { message: FRASI_ZOD.data };

    case z.ZodIssueCode.not_multiple_of:
      return { message: FRASI_ZOD.multiploDi(issue.multipleOf) };

    case z.ZodIssueCode.not_finite:
      return { message: FRASI_ZOD.numeroFinito };

    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: FRASI_ZOD.scelta };

    case z.ZodIssueCode.invalid_intersection_types:
    case z.ZodIssueCode.invalid_arguments:
    case z.ZodIssueCode.invalid_return_type:
      return { message: FRASI_ZOD.valoreNonValido };

    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_literal:
      return { message: FRASI_ZOD.valoreNonValido };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: FRASI_ZOD.campiInPiu(issue.keys.length) };

    case z.ZodIssueCode.custom:
      // Un refine con il suo messaggio non passa di qui (Zod usa quello dello schema):
      // arriva solo il caso senza messaggio, che resterebbe «Invalid input».
      return { message: FRASI_ZOD.valoreNonValido };
  }

  // Un caso che qui sopra non ha una frase sua (un tipo nuovo di Zod, un limite su un tipo raro):
  // mai il testo inglese di Zod, che al cliente non dice niente.
  return { message: FRASI_ZOD.valoreNonValido };
});
