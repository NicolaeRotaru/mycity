/**
 * Il carrello pagato la cui cifra non torna col preventivo: si chiude una
 * volta sola, anche sul database di produzione che non ha ancora la 126.
 *
 * 15/10/2026 (R81, secondo giro di collaudo) — IL RIPIEGO NON SCATTAVA.
 *
 * Lo stato 'MISMATCH' lo ammette solo la migrazione 126, che in produzione non
 * c'è ancora. Prima della 126 il database rifiuta la scrittura con 23514 e il
 * nome del vincolo `pending_checkouts_status_check`. Il codice aveva un
 * ripiego verso 'CANCELED', ma lo affidava a `conRipiegoSchema`, che un 23514
 * lo accetta solo se nomina i due vincoli degli ORDINI: sul carrello non
 * scattava mai. Finché l'errore si ignorava non se ne accorgeva nessuno; con
 * R81 l'errore faceva rispondere 500, Stripe ripeteva, e a ogni ripetizione
 * partiva un altro avviso «Incasso diverso dal preventivo». Il collaudo l'ha
 * misurato con l'errore vero di PostgreSQL 16: tre risposte 500, tre avvisi,
 * carrello ancora PENDING.
 *
 * Due cose adesso:
 *   ① il ripiego riconosce il vincolo del carrello per NOME (la regola di
 *     `lib/db/migrazione-124.ts`: mai per famiglia di codice);
 *   ② se anche il ripiego fallisce, NON si fa riprovare Stripe. È la decisione
 *     del 22/8 («uno scarto deterministico non si ritenta: si chiude»): il
 *     rimborso al cliente è già partito, con la sua chiave stabile; il segno
 *     sul carrello è contabilità. Un carrello rimasto PENDING lo chiude il giro
 *     `expire-checkouts` alla scadenza, rimettendo in vendita la merce — che
 *     qui è giusto, perché nessun ordine è nato.
 */
import type { getAdminSupabase } from '@/lib/supabase/server';
import { scritturaFacoltativa } from './esito';

/** Il vincolo sugli stati del carrello che, prima della 126, non conosce 'MISMATCH'. */
export const VINCOLO_STATI_DEL_CARRELLO = 'pending_checkouts_status_check';

/** Il database ha rifiutato 'MISMATCH' perché la migrazione 126 non c'è ancora? */
export function mancaLoStatoMismatch(errore: unknown): boolean {
  const e = errore as { code?: unknown; message?: unknown; details?: unknown } | null;
  if (e?.code !== '23514') return false;
  const testo = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.details === 'string' ? e.details : ''}`;
  return testo.includes(VINCOLO_STATI_DEL_CARRELLO);
}

/** Segna il carrello come chiuso per quadratura fallita: 'MISMATCH', o 'CANCELED' prima della 126. */
export async function chiudiIlCarrelloPerQuadratura(
  admin: ReturnType<typeof getAdminSupabase>,
  pendingCheckoutId: string,
): Promise<void> {
  const primo = await admin.from('pending_checkouts').update({ status: 'MISMATCH' }).eq('id', pendingCheckoutId);
  const esito = primo.error && mancaLoStatoMismatch(primo.error)
    ? await admin.from('pending_checkouts').update({ status: 'CANCELED' }).eq('id', pendingCheckoutId)
    : primo;
  scritturaFacoltativa(esito, 'carrello chiuso per quadratura fallita');
}
