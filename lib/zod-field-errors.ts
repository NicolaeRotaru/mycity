import type { ZodError } from 'zod';

/**
 * Helper per mostrare gli errori di validazione DOVE sono, non come un unico
 * messaggio generico.
 *
 * - `zodFieldErrors`  → mappa { 'path.con.punti': messaggio } per evidenziare
 *   ogni campo nella sua posizione in un form con validazione manuale (safeParse).
 * - `zodFirstFieldMessage` → un singolo messaggio che NOMINA il campo, per toast
 *   o risposte API dove non c'è una UI per-campo (es. "Email: non valida").
 */

/** Mappa ogni path di errore al suo messaggio (tiene il primo per path). */
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Messaggio del primo errore, prefissato con l'etichetta del campo se fornita.
 * `labels` mappa il path (o la sua radice) a un'etichetta leggibile.
 */
export function zodFirstFieldMessage(error: ZodError, labels: Record<string, string> = {}): string {
  const issue = error.issues[0];
  if (!issue) return 'Dati non validi';
  const fullPath = issue.path.join('.');
  const label = labels[fullPath] ?? (issue.path.length > 0 ? labels[String(issue.path[0])] : undefined);
  return label ? `${label}: ${issue.message}` : issue.message;
}
