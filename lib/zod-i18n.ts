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
 */

z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Campo obbligatorio' };
      }
      return { message: `Atteso ${issue.expected}` };

    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        if (issue.minimum === 1) return { message: 'Campo obbligatorio' };
        return { message: `Almeno ${issue.minimum} caratteri` };
      }
      if (issue.type === 'number') {
        return { message: `Valore minimo: ${issue.minimum}` };
      }
      if (issue.type === 'array') {
        return { message: `Seleziona almeno ${issue.minimum} elementi` };
      }
      break;

    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: `Massimo ${issue.maximum} caratteri` };
      }
      if (issue.type === 'number') {
        return { message: `Valore massimo: ${issue.maximum}` };
      }
      break;

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Email non valida' };
      if (issue.validation === 'url')   return { message: 'URL non valido' };
      if (issue.validation === 'uuid')  return { message: 'ID non valido' };
      if (issue.validation === 'regex') return { message: 'Formato non valido' };
      break;

    case z.ZodIssueCode.invalid_enum_value:
      return { message: `Valore non valido. Usa: ${issue.options.join(', ')}` };

    case z.ZodIssueCode.custom:
      // Per messaggi custom dello schema, ritorna quello originale
      break;
  }

  return { message: ctx.defaultError };
});

export {};
