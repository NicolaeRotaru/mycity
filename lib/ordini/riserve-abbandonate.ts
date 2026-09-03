import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * LA MERCE CHE RESTA IMPEGNATA DA CHI HA GIÀ CAMBIATO IDEA.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * Premendo «Paga con carta» il server scala subito la merce (`reserve_stock`) e
 * apre la pagina di Stripe. Se lì la persona preme «indietro», Stripe non manda
 * nessun avviso: la riserva resta in piedi fino alla scadenza (due ore) e la
 * libera solo il lavoro periodico. Chi torna sui suoi passi e cambia qualcosa —
 * la fascia di consegna, l'indirizzo — o passa ai contanti si sente rispondere
 * «Stock insufficiente per Torta (0 disponibili)»: ha appena riservato lui
 * quell'unico pezzo, e adesso non può comprarlo. Per due ore non può comprarlo
 * nessuno.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * Un secondo tentativo dello stesso cliente **chiude il primo**. La riserva
 * vecchia si libera prima che la nuova nasca, invece di sommarsi.
 *
 * Tre cautele, copiate dal lavoro periodico che fa la stessa cosa a tempo
 * scaduto (`app/api/cron/expire-checkouts`), perché qui si rimette in vendita
 * merce e si restituiscono codici sconto:
 *   ① si salta ogni tentativo che ha GIÀ degli ordini (pagamento riuscito a
 *      metà): rimettere a scaffale merce venduta è peggio del difetto;
 *   ② la riga si rivendica in modo atomico (`PENDING → EXPIRED`): se il lavoro
 *      periodico o l'avviso di Stripe l'hanno già presa, qui non si fa niente e
 *      la merce non torna indietro due volte;
 *   ③ si tocca solo ciò che è di QUESTO cliente e di un carrello DIVERSO da
 *      quello che sta comprando adesso — il tentativo identico è già gestito da
 *      chi riusa la sessione aperta.
 */

type Riga = {
  id: string;
  groups?: Array<{ items?: Array<{ productId: string; quantity: number; variantId?: string | null }> }> | null;
  coupon_code?: string | null;
  stripe_session_id?: string | null;
  delivery?: { impronta_carrello?: string | null } | null;
};

/** Il poco che serve del client di servizio: così la prova può eseguirla davvero. */
export type ClientRiserve = Pick<SupabaseClient, 'from' | 'rpc'>;

export async function liberaRiserveAbbandonate(
  admin: ClientRiserve,
  opzioni: {
    buyerId: string;
    /** L'impronta del carrello che si sta comprando ADESSO: quella non si tocca. */
    improntaDaTenere?: string | null;
    /**
     * Si liberano solo i tentativi che impegnano almeno uno di questi prodotti.
     * Serve a non spegnere un pagamento aperto su un carrello che non c'entra:
     * qui si toglie di mezzo ciò che blocca QUESTO acquisto, non tutto il resto.
     */
    soloConProdotti?: string[];
    /** Chiude anche la pagina di pagamento rimasta aperta, se si può. */
    chiudiSessione?: (sessionId: string) => Promise<void>;
  },
): Promise<{ liberati: string[] }> {
  const { data, error } = await admin
    .from('pending_checkouts')
    .select('id, groups, coupon_code, stripe_session_id, delivery')
    .eq('buyer_id', opzioni.buyerId)
    .eq('status', 'PENDING')
    .limit(10);

  if (error) {
    // Non si ferma l'acquisto per questo: si va avanti come prima e resta scritto.
    logger.warn('[riserve] tentativi aperti non letti', { message: error.message });
    return { liberati: [] };
  }

  const daLiberare = opzioni.soloConProdotti ? new Set(opzioni.soloConProdotti) : null;
  const prodottiDi = (r: Riga) =>
    (r.groups ?? []).flatMap((g) => (g.items ?? []).map((it) => it.productId));

  const candidati = ((data ?? []) as Riga[]).filter(
    (r) =>
      (r.delivery?.impronta_carrello ?? null) !== (opzioni.improntaDaTenere ?? null) &&
      (!daLiberare || prodottiDi(r).some((id) => daLiberare.has(id))),
  );
  if (candidati.length === 0) return { liberati: [] };

  // ① Chi ha già degli ordini non si tocca: la merce è stata venduta davvero.
  const sessioni = candidati.map((r) => r.stripe_session_id).filter((s): s is string => !!s);
  const conOrdini = new Set<string>();
  if (sessioni.length > 0) {
    const { data: ordini, error: errOrdini } = await admin
      .from('orders')
      .select('stripe_session_id')
      .in('stripe_session_id', sessioni);
    if (errOrdini) {
      logger.warn('[riserve] controllo ordini fallito: non libero niente', { message: errOrdini.message });
      return { liberati: [] };
    }
    for (const o of (ordini ?? []) as Array<{ stripe_session_id?: string | null }>) {
      if (o.stripe_session_id) conOrdini.add(o.stripe_session_id);
    }
  }

  const liberati: string[] = [];
  for (const riga of candidati) {
    if (riga.stripe_session_id && conOrdini.has(riga.stripe_session_id)) {
      logger.warn('[riserve] tentativo con ordini gia creati: non lo tocco', { id: riga.id });
      continue;
    }

    // ② La rivendicazione atomica: o la riga passa da PENDING a EXPIRED qui, o
    // qualcun altro l'ha già presa e non si rimette in vendita niente.
    const { data: presi, error: errPresa } = await admin
      .from('pending_checkouts')
      .update({ status: 'EXPIRED' })
      .eq('id', riga.id)
      .eq('status', 'PENDING')
      .select('id');
    if (errPresa || !presi || (presi as unknown[]).length === 0) continue;

    const items = (riga.groups ?? []).flatMap((g) =>
      (g.items ?? []).map((it) => ({
        product_id: it.productId,
        variant_id: it.variantId ?? null,
        qty: it.quantity,
      })),
    );
    if (items.length > 0) {
      const { error: errMerce } = await admin.rpc('restore_stock', { p_items: items });
      if (errMerce) logger.warn('[riserve] merce non rimessa in vendita', { id: riga.id, message: errMerce.message });
    }

    if (riga.coupon_code) {
      const { error: errCodice } = await admin.rpc('release_coupon', { p_code: riga.coupon_code });
      if (errCodice) logger.warn('[riserve] codice sconto non restituito', { id: riga.id, message: errCodice.message });
    }

    if (riga.stripe_session_id && opzioni.chiudiSessione) {
      // La pagina di pagamento rimasta aperta va chiusa insieme alla riserva:
      // altrimenti resta pagabile, e a merce già liberata quel pagamento
      // finirebbe rimborsato.
      try {
        await opzioni.chiudiSessione(riga.stripe_session_id);
      } catch (e) {
        logger.warn('[riserve] pagamento vecchio non chiuso', { id: riga.id, e });
      }
    }

    liberati.push(riga.id);
  }

  if (liberati.length > 0) {
    logger.info('[riserve] merce liberata da tentativi abbandonati', { quanti: liberati.length });
  }
  return { liberati };
}
