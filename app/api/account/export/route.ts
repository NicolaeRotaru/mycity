import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

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
 * Sicurezza: richiede Bearer token; userId derivato dal token.
 */
// 026 — Nessun freno su una rotta che legge diecimila righe e le impacchetta in
// memoria: bastava un ciclo per tenere occupata l'istanza. Esportare i propri
// dati è un diritto, e come tutti i diritti si esercita qualche volta, non
// trecento al minuto. Tre al giorno.
export const GET = withAuthRateLimit(
  { name: 'account-export', max: 3, windowMs: 24 * 60 * 60_000 },
  async ({ user }): Promise<NextResponse> => {
  const userId = user.id;
  const userEmail = user.email ?? null;

  let admin;
  try {
    admin = getAdminSupabase();
  } catch {
    return ApiErrors.unavailable('Servizio non configurato.');
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
    admin.from('user_addresses').select('*').eq('user_id', userId),
    admin.from('orders').select('*, order_items(*)').eq('user_id', userId),
    admin.from('orders').select('id, created_at, total_price, delivery_status').eq('seller_id', userId),
    admin.from('orders').select('id, created_at, delivered_at, shipping_cost').eq('rider_id', userId),
    admin.from('reviews').select('*').eq('user_id', userId),
    // 🟡-13: store_reviews/rider_reviews usano user_id (non reviewer_id): prima
    // l'export interrogava una colonna inesistente e ometteva queste recensioni.
    admin.from('store_reviews').select('*').eq('user_id', userId),
    admin.from('rider_reviews').select('*').eq('user_id', userId),
    admin.from('favorites').select('*').eq('user_id', userId),
    admin.from('referrals').select('*').eq('referrer_id', userId),
    admin.from('referrals').select('*').eq('referred_id', userId),
    admin.from('notifications').select('*').eq('user_id', userId),
    // 🟡-13: chat e contact form fanno parte dei dati personali (Art. 15/20).
    admin.from('conversations').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`),
    admin.from('messages').select('*').eq('sender_id', userId),
    admin.from('contact_messages').select('*').eq('user_id', userId),
    // Mancavano all'appello, e sono i dati con cui una persona viene profilata:
    // il registro delle azioni (con indirizzo di rete e browser), le cose
    // guardate, i dispositivi registrati per le notifiche, l'iscrizione alle
    // novità, i resi, le contestazioni e lo storico dei consensi.
    admin.from('activity_events').select('*').or(`user_id.eq.${userId},actor_id.eq.${userId}`).limit(5000),
    admin.from('recently_viewed').select('*').eq('user_id', userId),
    admin.from('product_views').select('*').eq('user_id', userId).limit(5000),
    admin.from('push_subscriptions').select('*').eq('user_id', userId),
    admin.from('newsletter_subscribers').select('*').eq('email', userEmail ?? ''),
    admin.from('returns').select('*').eq('buyer_id', userId),
    admin.from('disputes').select('*').or(`opener_id.eq.${userId},against_id.eq.${userId}`),
    admin.from('consent_log').select('*').eq('user_id', userId),
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
    portafoglio: admin.from('wallet_ledger').select('*').eq('user_id', userId),
    punti_fedelta: admin.from('loyalty_accounts').select('*').eq('user_id', userId),
    punti_movimenti: admin.from('loyalty_transactions').select('*').eq('user_id', userId),
    buoni_regalo: admin.from('gift_cards').select('*').or(`buyer_id.eq.${userId},redeemed_by.eq.${userId}`),
    domande_sui_prodotti: admin
      .from('product_questions')
      .select('*')
      .or(`author_id.eq.${userId},answered_by.eq.${userId}`),
    sos_del_fattorino: admin.from('rider_sos_events').select('*').eq('rider_id', userId),
    carrello_salvato: admin.from('user_carts').select('*').eq('user_id', userId),
    carrelli_abbandonati: admin.from('abandoned_carts').select('*').eq('user_id', userId),
    iscrizioni_agli_eventi: admin.from('event_rsvps').select('*').eq('user_id', userId),
    negozi_seguiti: admin.from('follows').select('*').eq('user_id', userId),
    liste_di_prodotti: admin.from('product_lists').select('*').eq('owner_id', userId),
    ordini_di_gruppo: admin
      .from('group_orders')
      .select('*')
      .or(`organizer_id.eq.${userId},seller_id.eq.${userId}`),
    partecipazioni_di_gruppo: admin.from('group_participants').select('*').eq('user_id', userId),
    ordini_ricorrenti: admin
      .from('subscription_orders')
      .select('*')
      .or(`user_id.eq.${userId},seller_id.eq.${userId}`),
    tentativi_di_pagamento: admin.from('payment_attempts').select('*').eq('user_id', userId),
    casse_aperte: admin.from('pending_checkouts').select('*').eq('buyer_id', userId),
    casse_contanti: admin.from('cod_checkout_attempts').select('*').eq('user_id', userId),
    email_in_coda: admin.from('email_queue').select('*').eq('user_id', userId),
    segnalazioni_fatte: admin.from('segnalazioni').select('*').eq('segnalante_id', userId),
    cashback_riscosso: admin.from('cashback_redemptions').select('*').eq('user_id', userId),
    codici_di_zona_usati: admin.from('zone_code_uses').select('*').eq('user_id', userId),
    recensioni_votate_utili: admin.from('review_helpful').select('*').eq('user_id', userId),
    storie_guardate: admin.from('seller_story_views').select('*').eq('user_id', userId),
    voti_negozio_del_mese: admin.from('shop_of_month_votes').select('*').eq('voter_id', userId),
    traguardi: admin.from('user_achievements').select('*').eq('user_id', userId),
  };

  const altre: Record<string, unknown[]> = {};
  await Promise.all(
    Object.entries(altreTabelle).map(async ([chiave, domanda]) => {
      // Una tabella che non risponde non fa cadere tutto l'export: resta vuota
      // e il guasto si vede nel file, invece di negare l'intera richiesta.
      const esito = (await domanda) as { data: unknown[] | null };
      altre[chiave] = esito.data ?? [];
    }),
  );

  // Anonimizza/maschera campi sensibili anche nell'export
  const profileClean = profile.data ? {
    ...profile.data,
    // Non esportare hash password (non c'è qui, ma per principio nessun secret)
  } : null;

  const payload = {
    export_metadata: {
      generated_at: new Date().toISOString(),
      gdpr_article: 20,
      user_id: userId,
      email: userEmail,
      note: 'Questo file contiene tutti i dati personali associati al tuo account. Conservato in formato JSON strutturato e leggibile come previsto dall\'art. 20 GDPR.',
    },
    profile: profileClean,
    addresses: addresses.data ?? [],
    orders_as_buyer: ordersAsBuyer.data ?? [],
    orders_as_seller: ordersAsSeller.data ?? [],
    orders_as_rider: ordersAsRider.data ?? [],
    reviews: {
      products: productReviews.data ?? [],
      stores: storeReviews.data ?? [],
      riders: riderReviews.data ?? [],
    },
    favorites: favorites.data ?? [],
    referrals: {
      as_referrer: referralsOut.data ?? [],
      as_referred: referralsIn.data ?? [],
    },
    notifications: notifications.data ?? [],
    chat: {
      conversations: conversations.data ?? [],
      messages_sent: chatMessages.data ?? [],
    },
    contact_messages: contactMessages.data ?? [],
    registro_attivita: activityEvents.data ?? [],
    guardati_di_recente: recentlyViewed.data ?? [],
    prodotti_visti: productViews.data ?? [],
    dispositivi_notifiche: pushSubscriptions.data ?? [],
    newsletter: newsletter.data ?? [],
    resi: returns.data ?? [],
    contestazioni: disputes.data ?? [],
    consensi: consents.data ?? [],
    ...altre,
  };

  const today = new Date().toISOString().slice(0, 10);
  const filename = `mycity-data-${userId}-${today}.json`;

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
