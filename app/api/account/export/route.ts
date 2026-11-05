import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit, type OpzioniAccesso } from '@/lib/api/middleware';
import { apiError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { stradaAManoPerIDiritti } from '@/lib/legal/titolare';

export const runtime = 'nodejs';

/**
 * 5/11/2026 — Trentatré tabelle si leggevano intere, senza nessun tetto: su un cliente
 * storico (o un negozio con anni di ordini) la richiesta poteva non finire dentro il tempo
 * della funzione. Ogni sezione si legge fino a questo numero di righe; se ci arriva, il file
 * lo dice in «sezioni_al_tetto» e si dichiara incompleto, invece di spacciarsi per intero.
 */
const TETTO_PER_SEZIONE = 5000;

function senzaChiave(cosa: string, e: unknown): NextResponse {
  // 27/10/2026 — «Servizio non configurato» lasciava la persona davanti a un
  // muro: il diritto alla portabilità resta, cambia solo la strada.
  logger.error('[account-export] esportazione automatica spenta: manca la chiave di servizio', {
    errore: e instanceof Error ? e.message : 'errore',
  });
  // 27/10/2026 (secondo giro) — Con la frase viaggia il collegamento
  // (`details.recapito`): la pagina lo offre come pulsante. Senza casella e
  // senza un modulo che arrivi a qualcuno è null, e la frase lo dice.
  const strada = stradaAManoPerIDiritti(cosa);
  return apiError(503, strada.frase, 'SERVICE_UNAVAILABLE', { recapito: strada.recapito });
}

/**
 * 27/10/2026 (quarto giro, fase 2) — PRIMA CHI SEI, POI LA CHIAVE.
 *
 * Qui c'era un involucro che guardava la chiave PRIMA del controllo d'accesso:
 * senza chiave rispondeva 503 con la strada a mano a chiunque bussasse, anche
 * a chi non aveva fatto l'accesso, che deve ricevere 401 nel formato ApiErrors.
 * Adesso decide `withAuth`: prima chi sei (401 se nessuno), poi, se la chiave
 * manca, la strada a mano. Prova:
 * tests/unit/prima-chi-sei-poi-la-chiave-sulle-porte-dei-diritti.test.ts
 */
function sullaPorta(cosa: string): OpzioniAccesso {
  return { seMancaLaChiave: (_chi, e) => senzaChiave(cosa, e) };
}

/**
 * GDPR Art. 20 — Portabilità dei dati.
 *
 * Esporta in JSON tutti i dati personali dell'utente corrente:
 *  - profilo
 *  - indirizzi salvati
 *  - ordini (come buyer)
 *  - ordini venduti (come seller, se applicabile)
 *  - ordini consegnati (come rider, se applicabile)
 *  - recensioni lasciate (prodotti, store, rider)
 *  - preferiti
 *  - referral (sia come referrer sia come referred)
 *  - notifiche
 *
 * Restituisce un file `mycity-data-{userId}-{date}.json` scaricabile.
 *
 * Onestà: se una sezione non si riesce a leggere, il file NON la spaccia per
 * vuota — vale `null`, compare in `letture_fallite`, `export_completo` diventa
 * false e il nome del file finisce in `-INCOMPLETO`.
 *
 * Sicurezza: richiede Bearer token; userId derivato dal token.
 */
// 026 — Nessun freno su una rotta che legge diecimila righe e le impacchetta in
// memoria: bastava un ciclo per tenere occupata l'istanza. Esportare i propri
// dati è un diritto, e come tutti i diritti si esercita qualche volta, non
// trecento al minuto. Tre al giorno.
const scarica = withAuthRateLimit(
  { name: 'account-export', max: 3, windowMs: 24 * 60 * 60_000, ...sullaPorta('Scaricare i tuoi dati') },
  async ({ user }): Promise<NextResponse> => {
  const userId = user.id;
  const userEmail = user.email ?? null;

  let admin;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return senzaChiave('Scaricare i tuoi dati', e);
  }

  // Query parallele
  const [
    profile,
    addresses,
    ordersAsBuyer,
    ordersAsSeller,
    ordersAsRider,
    productReviews,
    storeReviews,
    riderReviews,
    favorites,
    referralsOut,
    referralsIn,
    notifications,
    conversations,
    chatMessages,
    contactMessages,
    activityEvents,
    recentlyViewed,
    productViews,
    pushSubscriptions,
    newsletter,
    returns,
    disputes,
    consents,
  ] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).single(),
    admin.from('user_addresses').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('orders').select('*, order_items(*)').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('orders').select('id, created_at, total_price, delivery_status').eq('seller_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('orders').select('id, created_at, delivered_at, shipping_cost').eq('rider_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('reviews').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    // 🟡-13: store_reviews/rider_reviews usano user_id (non reviewer_id): prima
    // l'export interrogava una colonna inesistente e ometteva queste recensioni.
    admin.from('store_reviews').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('rider_reviews').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('favorites').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('referrals').select('*').eq('referrer_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('referrals').select('*').eq('referred_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('notifications').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    // 🟡-13: chat e contact form fanno parte dei dati personali (Art. 15/20).
    admin.from('conversations').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).limit(TETTO_PER_SEZIONE),
    admin.from('messages').select('*').eq('sender_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('contact_messages').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    // Mancavano all'appello, e sono i dati con cui una persona viene profilata:
    // il registro delle azioni (con indirizzo di rete e browser), le cose
    // guardate, i dispositivi registrati per le notifiche, l'iscrizione alle
    // novità, i resi, le contestazioni e lo storico dei consensi.
    admin.from('activity_events').select('*').or(`user_id.eq.${userId},actor_id.eq.${userId}`).limit(TETTO_PER_SEZIONE),
    admin.from('recently_viewed').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('product_views').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('push_subscriptions').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('newsletter_subscribers').select('*').eq('email', userEmail ?? '').limit(TETTO_PER_SEZIONE),
    admin.from('returns').select('*').eq('buyer_id', userId).limit(TETTO_PER_SEZIONE),
    admin.from('disputes').select('*').or(`opener_id.eq.${userId},against_id.eq.${userId}`).limit(TETTO_PER_SEZIONE),
    admin.from('consent_log').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
  ]);

  /**
   * 6/9/2026 — L'EXPORT SALTAVA VENTICINQUE TABELLE.
   *
   * L'elenco delle tabelle viveva scritto a mano qui dentro e si aggiornava
   * solo quando qualcuno se ne ricordava — i commenti «🟡-13» e «mancavano
   * all'appello» qui sopra sono la prova che è già successo due volte. Ogni
   * tabella nuova nasceva fuori dall'export: restavano fuori il credito del
   * portafoglio, i punti fedeltà, i buoni regalo comprati, le domande scritte
   * sui prodotti e perfino gli SOS del fattorino.
   *
   * Chi chiede «i miei dati» e non ci trova il proprio credito ha in mano una
   * risposta incompleta a una richiesta fatta per legge (art. 15 e 20).
   *
   * LA RIPARAZIONE VERA NON È QUESTO ELENCO, È LA PROVA CHE LO SORVEGLIA:
   * tests/unit/scarica-i-miei-dati-non-salta-nessuna-tabella.test.ts legge le
   * chiavi esterne verso `profiles` e `auth.users` nelle migrazioni e diventa
   * rossa se una tabella non è né qui né fra le esclusioni motivate. La
   * prossima tabella nuova non può più nascere fuori dall'export in silenzio.
   */
  const altreTabelle = {
    portafoglio: admin.from('wallet_ledger').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    punti_fedelta: admin.from('loyalty_accounts').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    punti_movimenti: admin.from('loyalty_transactions').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    buoni_regalo: admin.from('gift_cards').select('*').or(`buyer_id.eq.${userId},redeemed_by.eq.${userId}`).limit(TETTO_PER_SEZIONE),
    domande_sui_prodotti: admin
      .from('product_questions')
      .select('*')
      .or(`author_id.eq.${userId},answered_by.eq.${userId}`).limit(TETTO_PER_SEZIONE),
    sos_del_fattorino: admin.from('rider_sos_events').select('*').eq('rider_id', userId).limit(TETTO_PER_SEZIONE),
    carrello_salvato: admin.from('user_carts').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    carrelli_abbandonati: admin.from('abandoned_carts').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    iscrizioni_agli_eventi: admin.from('event_rsvps').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    negozi_seguiti: admin.from('follows').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    liste_di_prodotti: admin.from('product_lists').select('*').eq('owner_id', userId).limit(TETTO_PER_SEZIONE),
    ordini_di_gruppo: admin
      .from('group_orders')
      .select('*')
      .or(`organizer_id.eq.${userId},seller_id.eq.${userId}`).limit(TETTO_PER_SEZIONE),
    partecipazioni_di_gruppo: admin.from('group_participants').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    ordini_ricorrenti: admin
      .from('subscription_orders')
      .select('*')
      .or(`user_id.eq.${userId},seller_id.eq.${userId}`).limit(TETTO_PER_SEZIONE),
    tentativi_di_pagamento: admin.from('payment_attempts').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    casse_aperte: admin.from('pending_checkouts').select('*').eq('buyer_id', userId).limit(TETTO_PER_SEZIONE),
    casse_contanti: admin.from('cod_checkout_attempts').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    email_in_coda: admin.from('email_queue').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    segnalazioni_fatte: admin.from('segnalazioni').select('*').eq('segnalante_id', userId).limit(TETTO_PER_SEZIONE),
    cashback_riscosso: admin.from('cashback_redemptions').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    codici_di_zona_usati: admin.from('zone_code_uses').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    recensioni_votate_utili: admin.from('review_helpful').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    storie_guardate: admin.from('seller_story_views').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
    voti_negozio_del_mese: admin.from('shop_of_month_votes').select('*').eq('voter_id', userId).limit(TETTO_PER_SEZIONE),
    traguardi: admin.from('user_achievements').select('*').eq('user_id', userId).limit(TETTO_PER_SEZIONE),
  };

  /**
   * 6/9/2026 — UNA LETTURA CADUTA NON PUÒ TRAVESTIRSI DA ELENCO VUOTO.
   *
   * Qui il campo `error` della risposta finiva nel cestino: una tabella che
   * non rispondeva usciva nel file come `"portafoglio": []`, identico a «non
   * hai niente». Chi esercita il diritto di accesso (art. 15 e 20 GDPR) si
   * portava a casa un file che dice il falso, e non aveva nessun modo di
   * accorgersene. Un adempimento che risponde una bugia è peggio di un
   * adempimento che fallisce.
   *
   * Adesso una sezione che non si è riusciti a leggere esce `null` — mai una
   * lista vuota — finisce elencata in `letture_fallite`, il file si dichiara
   * incompleto in testa e perfino il nome del file lo dice.
   */
  const letture_fallite: { sezione: string; motivo: string }[] = [];
  // 5/11/2026 — Le sezioni arrivate al tetto: il file lo dice, non le spaccia per intere.
  const sezioni_al_tetto: string[] = [];

  /** Una risposta di Supabase ridotta all'osso: i dati e l'eventuale guasto. */
  type Lettura = { data: unknown; error: unknown };

  /**
   * Traduce una lettura in una sezione dell'export. Elenco se è andata bene,
   * `null` + riga in `letture_fallite` se è caduta. Mai `[]` per un guasto.
   */
  function sezione(nome: string, esito: Lettura): unknown[] | null {
    const guasto = esito.error;
    if (guasto) {
      // Il perché tecnico resta nei log, per chi deve ripararlo: il messaggio
      // grezzo del database non si mette in mano al cliente. A lui serve
      // sapere QUALE pezzo manca e che ha diritto a riaverlo.
      logger.error(guasto, { context: 'account-export', sezione: nome });
      letture_fallite.push({
        sezione: nome,
        motivo: 'non siamo riusciti a leggere questa sezione: riprova più tardi',
      });
      return null;
    }
    const righe = (esito.data as unknown[] | null) ?? [];
    if (Array.isArray(righe) && righe.length >= TETTO_PER_SEZIONE) sezioni_al_tetto.push(nome);
    return righe;
  }

  const altre: Record<string, unknown[] | null> = {};
  await Promise.all(
    Object.entries(altreTabelle).map(async ([chiave, domanda]) => {
      // Una tabella che non risponde non fa cadere tutto l'export: la sua
      // sezione esce dichiarata come non letta, invece di negare l'intera
      // richiesta — e senza fingersi vuota.
      altre[chiave] = sezione(chiave, (await domanda) as Lettura);
    }),
  );

  // Il profilo: «nessuna riga» (PGRST116) vuol dire davvero che non c'è, ed è
  // un'informazione vera. Un errore diverso vuol dire che non siamo riusciti a
  // leggerlo: le due cose non possono uscire uguali dal file.
  const profiloLetto = profile as { error: { message?: string; code?: string } | null };
  if (profiloLetto.error && profiloLetto.error.code !== 'PGRST116') {
    logger.error(profiloLetto.error, { context: 'account-export', sezione: 'profile' });
    letture_fallite.push({
      sezione: 'profile',
      motivo: 'non siamo riusciti a leggere questa sezione: riprova più tardi',
    });
  }

  // Anonimizza/maschera campi sensibili anche nell'export
  const profileClean = profile.data ? {
    ...profile.data,
    // Non esportare hash password (non c'è qui, ma per principio nessun secret)
  } : null;

  // 5/11/2026 — Le sezioni si leggono PRIMA di scrivere la testata: «export_completo» e
  // il nome del file guardano letture_fallite e sezioni_al_tetto, che si riempiono qui.
  // Prima la testata si calcolava per prima e non vedeva i guasti delle sezioni principali.
  const sezioni = {
    profile: profileClean,
    addresses: sezione('addresses', addresses),
    orders_as_buyer: sezione('orders_as_buyer', ordersAsBuyer),
    orders_as_seller: sezione('orders_as_seller', ordersAsSeller),
    orders_as_rider: sezione('orders_as_rider', ordersAsRider),
    reviews: {
      products: sezione('reviews.products', productReviews),
      stores: sezione('reviews.stores', storeReviews),
      riders: sezione('reviews.riders', riderReviews),
    },
    favorites: sezione('favorites', favorites),
    referrals: {
      as_referrer: sezione('referrals.as_referrer', referralsOut),
      as_referred: sezione('referrals.as_referred', referralsIn),
    },
    notifications: sezione('notifications', notifications),
    chat: {
      conversations: sezione('chat.conversations', conversations),
      messages_sent: sezione('chat.messages_sent', chatMessages),
    },
    contact_messages: sezione('contact_messages', contactMessages),
    registro_attivita: sezione('registro_attivita', activityEvents),
    guardati_di_recente: sezione('guardati_di_recente', recentlyViewed),
    prodotti_visti: sezione('prodotti_visti', productViews),
    dispositivi_notifiche: sezione('dispositivi_notifiche', pushSubscriptions),
    newsletter: sezione('newsletter', newsletter),
    resi: sezione('resi', returns),
    contestazioni: sezione('contestazioni', disputes),
    consensi: sezione('consensi', consents),
    ...altre,
  };

  const payload = {
    export_metadata: {
      generated_at: new Date().toISOString(),
      gdpr_article: 20,
      user_id: userId,
      email: userEmail,
      export_completo: letture_fallite.length === 0 && sezioni_al_tetto.length === 0,
      note:
        sezioni_al_tetto.length > 0 && letture_fallite.length === 0
          ? `ATTENZIONE: questo file NON è completo. Le sezioni in «sezioni_al_tetto» hanno più di ${TETTO_PER_SEZIONE} righe e qui trovi solo le prime ${TETTO_PER_SEZIONE}. Scrivici: hai diritto a riceverle tutte.`
          : letture_fallite.length === 0
          ? 'Questo file contiene tutti i dati personali associati al tuo account. Conservato in formato JSON strutturato e leggibile come previsto dall\'art. 20 GDPR.'
          : 'ATTENZIONE: questo file NON è completo. Alcune sezioni non siamo riusciti a leggerle: le trovi in «letture_fallite», e nel file valgono null. Null non vuol dire «non hai niente»: vuol dire «non lo sappiamo». Riprova più tardi o scrivici, hai diritto a riceverle.',
    },
    letture_fallite,
    sezioni_al_tetto,
    ...sezioni,
  };

  const today = new Date().toISOString().slice(0, 10);
  // Il nome del file lo dice prima ancora che tu lo apra.
  const filename =
    letture_fallite.length === 0 && sezioni_al_tetto.length === 0
      ? `mycity-data-${userId}-${today}.json`
      : `mycity-data-${userId}-${today}-INCOMPLETO.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
  },
);

export const GET = scarica;
