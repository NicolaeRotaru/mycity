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
        return { message: issue.inclusive ? FRASI_ZOD.minimo(issue.minimum) : FRASI_ZOD.maggioreDi(issue.minimum) };
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
        return { message: issue.inclusive ? FRASI_ZOD.massimo(issue.maximum) : FRASI_ZOD.minoreDi(issue.maximum) };
      }
      if (issue.type === 'array') {
        return { message: FRASI_ZOD.massimoElementi(issue.maximum) };
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

  return { message: ctx.defaultError };
});
