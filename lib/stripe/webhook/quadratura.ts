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
import { logger } from '@/lib/logger';
import { notifyAdmins } from './comune';
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

/** Una riga del carrello come la salva il checkout (`PendingGroup` in ordini.ts), per il poco che serve qui. */
type GruppoDelCarrello = {
  items?: Array<{ productId: string; variantId?: string | null; quantity: number }> | null;
};

/** Un pezzo da rimettere in vendita, nella forma che vuole `restore_stock`. */
export type MerceDaRimettere = { product_id: string; variant_id: string | null; qty: number };

/**
 * La merce che il checkout ha tolto dalla vendita (`reserve_stock`) per questo
 * carrello: la stessa lista per il carrello scaduto e per quello chiuso per
 * quadratura, così le due strade non rimettono a scaffale cose diverse.
 */
export function merceDelCarrello(groups: unknown): MerceDaRimettere[] {
  if (!Array.isArray(groups)) return [];
  return (groups as GruppoDelCarrello[]).flatMap((g) =>
    (g?.items ?? []).map((it) => ({ product_id: it.productId, variant_id: it.variantId ?? null, qty: it.quantity })),
  );
}

/**
 * Segna il carrello come chiuso per quadratura fallita: 'MISMATCH', o 'CANCELED'
 * prima della 126. E rimette a posto quello che il checkout aveva preso.
 *
 * 16/10/2026 — LA MERCE TENUTA DA PARTE NON TORNAVA PIÙ IN VENDITA.
 *
 * Al checkout con carta la merce si toglie dalla vendita e il codice sconto si
 * consuma subito. Qui il carrello si chiudeva e basta: il cliente veniva
 * rimborsato, ma la merce restava fuori vendita e il codice consumato. Nessun
 * giro li riprende, perché il giro dei carrelli scaduti lavora solo quelli
 * ancora «in attesa». Un caso: il fornaio ha un pezzo solo, il carrello finisce
 * qui, e quel pezzo risulta esaurito per sempre.
 *
 * Adesso il carrello si prende solo se è ancora «in attesa» (come fa il
 * carrello scaduto): chi lo prende rimette la merce in vendita e restituisce il
 * codice, una volta sola. Se l'avviso arriva di nuovo, o il giro dei carrelli
 * scaduti è passato prima, non lo prende e non rifà niente.
 */
export async function chiudiIlCarrelloPerQuadratura(
  admin: ReturnType<typeof getAdminSupabase>,
  pendingCheckoutId: string,
): Promise<void> {
  const chiudi = (status: 'MISMATCH' | 'CANCELED') =>
    admin
      .from('pending_checkouts')
      .update({ status })
      .eq('id', pendingCheckoutId)
      .eq('status', 'PENDING')
      .select('id, groups, coupon_code');
  const primo = await chiudi('MISMATCH');
  const esito = primo.error && mancaLoStatoMismatch(primo.error) ? await chiudi('CANCELED') : primo;
  scritturaFacoltativa(esito, 'carrello chiuso per quadratura fallita');
  if (esito.error) return;
  const carrello = (esito.data as Array<{ groups?: unknown; coupon_code?: string | null }> | null)?.[0];
  if (!carrello) return;

  const merce = merceDelCarrello(carrello.groups);
  if (merce.length > 0) {
    const { error: errScaffale } = await admin.rpc('restore_stock', { p_items: merce });
    if (errScaffale) {
      // Il carrello è già chiuso: né l'avviso ripetuto né il giro lo riprendono.
      logger.error('[stripe] quadratura fallita: merce non rimessa in vendita', { pendingCheckoutId, message: errScaffale.message });
      await notifyAdmins(
        '⚠️ Merce non rimessa in vendita',
        `Il carrello ${pendingCheckoutId} è stato rimborsato perché l'incasso non tornava col preventivo, ma la sua merce (${merce.length} articolo/i) non è tornata in vendita: la giacenza va sistemata a mano.`,
        '/admin/orders',
      );
    }
  }

  const codice = carrello.coupon_code?.trim();
  if (codice) {
    const { error: errCodice } = await admin.rpc('release_coupon', { p_code: codice });
    if (errCodice) logger.warn('[stripe] quadratura fallita: codice sconto non restituito', { pendingCheckoutId, message: errCodice.message });
  }
}
