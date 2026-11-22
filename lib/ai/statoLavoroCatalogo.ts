// lib/ai/statoLavoroCatalogo.ts
/**
 * 12/11/2026 (R04-005 · R04-013) — GLI STATI DI UN LAVORO AI SUL CATALOGO,
 * DETTI IN UN POSTO SOLO.
 *
 * La pagina conosceva solo «in corso», «pronto», «applicato», «errore» e
 * «annullato». Un lavoro «in invio» (la riga nasce cosi') o «fallito» non
 * aveva ne' rotella ne' pulsante: la pagina restava muta e il lavoro non si
 * dimenticava mai. Qui ogni stato ha il suo posto.
 */
export type StatoLavoroCatalogo =
  | 'submitting'
  | 'processing'
  | 'ready'
  | 'applied'
  | 'error'
  | 'failed'
  | 'canceled';

const CHIUSI: ReadonlySet<string> = new Set(['applied', 'canceled', 'error', 'failed']);
const IN_CORSO: ReadonlySet<string> = new Set(['submitting', 'processing']);

/** Il lavoro e' finito per sempre: si dimentica e se ne puo' avviare un altro. */
export function lavoroChiuso(stato: string | null | undefined): boolean {
  return typeof stato === 'string' && CHIUSI.has(stato);
}

/** Il lavoro sta ancora girando: rotella e interrogazioni periodiche. */
export function lavoroInCorso(stato: string | null | undefined): boolean {
  return typeof stato === 'string' && IN_CORSO.has(stato);
}

/** Il pulsante «Avvia» si mostra solo senza un lavoro aperto. */
export function puoAvviareLavoro(job: { status: string } | null | undefined): boolean {
  return !job || lavoroChiuso(job.status);
}

/** La riga che spiega lo stato, quando la scheda dei risultati non c'e'. */
export function testoStatoLavoro(job: { status: string; total: number; error?: string | null }): string | null {
  switch (job.status) {
    case 'submitting':
      return `Sto inviando il lavoro su ${job.total} prodotti… non riavviarlo: tra poco lo vedi partire.`;
    case 'processing':
      return `Sto elaborando ${job.total} prodotti… puoi lasciare aperta questa pagina o tornare più tardi.`;
    case 'failed':
    case 'error':
      return `Il lavoro non è andato a buon fine${job.error ? ` (${job.error})` : ''}. Puoi avviarne un altro.`;
    case 'canceled':
      return 'Il lavoro è stato annullato. Puoi avviarne un altro.';
    default:
      return null;
  }
}
