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

/**
 * R01-011 — Un invio rimasto senza risposta e' «incerto»: il lotto potrebbe essere partito (ed essere
 * pagato) e resta aperto fino a 24 ore. Il marcatore e' l'inizio del motivo che scrive il server
 * (INVIO_SENZA_RISPOSTA in lib/ai/batch.ts, che qui non si importa: questa pagina gira nel browser).
 */
function invioIncerto(job: { status: string; error?: string | null }): boolean {
  return job.status === 'submitting' && /^invio senza risposta/i.test(job.error ?? '');
}

/** La riga che spiega lo stato, quando la scheda dei risultati non c'e'. */
export function testoStatoLavoro(job: { status: string; total: number; error?: string | null }): string | null {
  switch (job.status) {
    case 'submitting':
      if (invioIncerto(job)) {
        return `L'invio del lavoro su ${job.total} prodotti non ha avuto risposta: potrebbe essere già partito. Non riavviarlo: se entro 24 ore non succede niente, chiedi all'assistenza.`;
      }
      return `Sto inviando il lavoro su ${job.total} prodotti… non riavviarlo: tra poco lo vedi partire.`;
    case 'processing':
      return `Sto elaborando ${job.total} prodotti… puoi lasciare aperta questa pagina o tornare più tardi.`;
    case 'failed':
    case 'error': {
      const base = `Il lavoro non è andato a buon fine${job.error ? ` (${job.error})` : ''}.`;
      // Se il motivo manda all'assistenza, la riga non deve dire il contrario.
      return /assistenza/i.test(job.error ?? '') ? base : `${base} Puoi avviarne un altro.`;
    }
    case 'canceled':
      return 'Il lavoro è stato annullato. Puoi avviarne un altro.';
    default:
      return null;
  }
}
