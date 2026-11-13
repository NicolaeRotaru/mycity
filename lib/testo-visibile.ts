import { sanitizeRichText } from './sanitize-html';

/**
 * 12/11/2026 (R10-014) — Quanto e' lungo un blocco di testo, misurato su quello che il sito
 * SALVA: prima si sanitizza (come fanno le rotte), poi si conta. Cosi' il conto e' lo stesso
 * prima e dopo il salvataggio, e un blocco che passa il controllo non viene scartato alla
 * rilettura.
 *
 * Collaudo K03: la prima versione toglieva con un'espressione tutto cio' che stava fra «<» e
 * «>», e un testo con quei simboli scritti a mano («a < b … c > d») valeva pochi caratteri,
 * passava, veniva salvato con &lt; e &gt; e alla rilettura il blocco spariva intero. Dopo la
 * sanitizzazione i simboli letterali sono entita' e i tag sono solo quelli veri.
 */
const TAG = /<[^>]*>/g;
const ENTITA = /&(#\d+|#x[0-9a-f]+|[a-z]+);/gi;

/** I caratteri che una persona legge: senza tag, e un'entità vale un carattere. */
export function lunghezzaDelTesto(html: string | null | undefined): number {
  if (!html) return 0;
  return sanitizeRichText(html).replace(TAG, '').replace(ENTITA, '_').length;
}
