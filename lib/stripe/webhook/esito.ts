/**
 * Che cosa fare quando il database dice di no, dentro un avviso di Stripe.
 *
 * 15/10/2026 (R81) — IL DATABASE SBAGLIAVA, E A STRIPE SI DICEVA «TUTTO A POSTO».
 *
 * La rotta del webhook si regge su un patto: se il gestore va in errore, si
 * risponde 500 e Stripe riprova più tardi. Ma la libreria di Supabase non
 * lancia quando una scrittura fallisce: mette l'errore dentro `{ error }`, e
 * qualcuno deve leggerlo. Nei gestori c'erano scritture il cui esito non
 * leggeva nessuno. Un esempio vero: arriva una contestazione carta, la riga
 * `dispute_status = 'OPEN'` va in timeout, il gestore finisce «bene», la rotta
 * risponde 200 e Stripe non riprova più. L'ordine resta senza contestazione
 * aperta e il giro dei bonifici paga il negozio su soldi che la banca si è già
 * ripresa.
 *
 * Qui stanno le due sole forme ammesse per una scrittura dentro i gestori di
 * Stripe, e il controllo di stile (`.eslintrc.json`, cartella
 * `lib/stripe/webhook`) rifiuta una scrittura lasciata senza nessuna delle due:
 *
 *   ① `scritturaObbligatoria` — la scrittura conta: se fallisce il gestore
 *      fallisce, la rotta libera il turno e risponde 500, Stripe riprova.
 *   ② `scritturaFacoltativa` — un avviso di contorno (una campanella): se non
 *      parte si scrive nei log e si va avanti, perché far ritentare a Stripe un
 *      evento che i soldi li ha già mossi rifarebbe tutto il resto.
 */
import { logger } from '@/lib/logger';

type EsitoDb = { error?: unknown } | null | undefined;

function messaggioDi(errore: unknown): string {
  if (errore && typeof errore === 'object' && 'message' in errore) {
    const m = (errore as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return 'errore del database';
}

/**
 * Una scrittura che conta. Se il database l'ha rifiutata, lancia: chi chiama
 * (la rotta del webhook) risponde 500 e Stripe consegna di nuovo l'evento.
 * Restituisce l'esito così com'è, per chi deve leggerne anche i dati.
 */
export function scritturaObbligatoria<T extends EsitoDb>(esito: T, cosa: string): T {
  const errore = esito?.error;
  if (errore) {
    logger.error('[stripe] scrittura non riuscita: Stripe deve riprovare', {
      cosa,
      codice: (errore as { code?: unknown }).code ?? null,
      message: messaggioDi(errore),
    });
    throw new Error(`[stripe] ${cosa}: ${messaggioDi(errore)}`);
  }
  return esito;
}

/**
 * Una scrittura di contorno, di proposito non bloccante: se fallisce resta
 * scritta nei log dove si guarda, e il gestore va avanti.
 */
export function scritturaFacoltativa(esito: EsitoDb, cosa: string): void {
  const errore = esito?.error;
  if (errore) {
    logger.warn('[stripe] scrittura di contorno non riuscita', { cosa, message: messaggioDi(errore) });
  }
}
