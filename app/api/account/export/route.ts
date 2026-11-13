import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { sullaPortaDeiDiritti } from '@/lib/privacy/porta-dei-diritti';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * 5/11/2026 — Trentatré tabelle si leggevano intere, senza nessun tetto: su un cliente
 * storico (o un negozio con anni di ordini) la richiesta poteva non finire dentro il tempo
 * della funzione. Ogni sezione si legge fino a questo numero di righe; se ci arriva, il file
 * lo dice in «sezioni_al_tetto» e si dichiara incompleto, invece di spacciarsi per intero.
 */
const TETTO_PER_SEZIONE = 5000;

/**
 * 12/11/2026 (R02-004) — IL DATABASE NE DÀ MILLE PER VOLTA.
 * Ogni sezione chiedeva `.limit(5000)`, ma l'interfaccia del database restituisce al massimo
 * `max_rows` righe (1000, supabase/config.toml): il file si fermava a mille e si diceva completo,
 * perché il controllo «righe ≥ 5000» non scattava mai. Adesso si legge a finestre di mille fino
 * al tetto, e «al tetto» vuol dire che dopo il tetto c'è davvero almeno un'altra riga.
 */
const FINESTRA = 1000;
// Le finestre sono richieste separate (OFFSET): senza un ordine stabile Postgres può restituire le
// righe in un ordine diverso da una richiesta all'altra, con doppioni o buchi fra un blocco e
// l'altro. Ogni sezione si legge quindi ordinata per la sua chiave (id, o la chiave vera della
// tabella quando non ha un id).

/** Una risposta di Supabase ridotta all'osso: i dati, l'eventuale guasto e se si è fermata al tetto. */
type Lettura = { data: unknown; error: unknown; alTetto?: boolean };

async function tutta(
  chiedi: (da: number, a: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Lettura> {
  const righe: unknown[] = [];
  for (let da = 0; da < TETTO_PER_SEZIONE; da += FINESTRA) {
    const a = Math.min(da + FINESTRA, TETTO_PER_SEZIONE) - 1;
    const { data, error } = await chiedi(da, a);
    if (error) return { data: null, error };
    const blocco = Array.isArray(data) ? data : [];
    righe.push(...blocco);
    if (blocco.length < a - da + 1) return { data: righe, error: null, alTetto: false };
  }
  // Mille per mille fino al tetto: c'è qualcosa dopo?
  const dopo = await chiedi(TETTO_PER_SEZIONE, TETTO_PER_SEZIONE);
  if (dopo.error) return { data: righe, error: null, alTetto: true };
  return { data: righe, error: null, alTetto: Array.isArray(dopo.data) && dopo.data.length > 0 };
}

/**
 * 27/10/2026 — Senza la chiave di servizio «Servizio non configurato» lasciava la persona
 * davanti a un muro: il diritto alla portabilità resta, cambia solo la strada (503 con la
 * strada a mano). Prima chi sei (`withAuth`, 401 se nessuno), poi la chiave. Prova:
 * tests/unit/prima-chi-sei-poi-la-chiave-sulle-porte-dei-diritti.test.ts
 *
 * R23-002 (13/11/2026) — La risposta senza chiave stava copiata qui e nella cancellazione, e le
 * copie si erano separate: questa riga d'errore non diceva chi aveva chiesto. Adesso è una sola
 * (lib/privacy/porta-dei-diritti.ts), e nella porta non c'è più il `catch` sulla chiave che
 * non scattava mai: la chiave l'ha già chiesta `withAuth`.
 */
const SENZA_CHIAVE = sullaPortaDeiDiritti('[account-export] esportazione automatica spenta', 'Scaricare i tuoi dati');

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
  { name: 'account-export', max: 3, windowMs: 24 * 60 * 60_000, ...SENZA_CHIAVE },
  async ({ user }): Promise<NextResponse> => {
  const userId = user.id;
  const userEmail = user.email ?? null;

  const admin = getAdminSupabase();

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
    tutta((da, a) => admin.from('user_addresses').select('*').eq('user_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('orders').select('*, order_items(*)').eq('user_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('orders').select('id, created_at, total_price, delivery_status').eq('seller_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('orders').select('id, created_at, delivered_at, shipping_cost').eq('rider_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('reviews').select('*').eq('user_id', userId).order('id').range(da, a)),
    // 🟡-13: store_reviews/rider_reviews usano user_id (non reviewer_id): prima
    // l'export interrogava una colonna inesistente e ometteva queste recensioni.
    tutta((da, a) => admin.from('store_reviews').select('*').eq('user_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('rider_reviews').select('*').eq('user_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('favorites').select('*').eq('user_id', userId).order('product_id').range(da, a)),
    tutta((da, a) => admin.from('referrals').select('*').eq('referrer_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('referrals').select('*').eq('referred_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('notifications').select('*').eq('user_id', userId).order('id').range(da, a)),
    // 🟡-13: chat e contact form fanno parte dei dati personali (Art. 15/20).
    tutta((da, a) => admin.from('conversations').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).order('id').range(da, a)),
    tutta((da, a) => admin.from('messages').select('*').eq('sender_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('contact_messages').select('*').eq('user_id', userId).order('id').range(da, a)),
    // Mancavano all'appello, e sono i dati con cui una persona viene profilata:
    // il registro delle azioni (con indirizzo di rete e browser), le cose
    // guardate, i dispositivi registrati per le notifiche, l'iscrizione alle
    // novità, i resi, le contestazioni e lo storico dei consensi.
    tutta((da, a) => admin.from('activity_events').select('*').or(`user_id.eq.${userId},actor_id.eq.${userId}`).order('id').range(da, a)),
    tutta((da, a) => admin.from('recently_viewed').select('*').eq('user_id', userId).order('product_id').range(da, a)),
    tutta((da, a) => admin.from('product_views').select('*').eq('user_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('push_subscriptions').select('*').eq('user_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('newsletter_subscribers').select('*').eq('email', userEmail ?? '').order('id').range(da, a)),
    tutta((da, a) => admin.from('returns').select('*').eq('buyer_id', userId).order('id').range(da, a)),
    tutta((da, a) => admin.from('disputes').select('*').or(`opener_id.eq.${userId},against_id.eq.${userId}`).order('id').range(da, a)),
    tutta((da, a) => admin.from('consent_log').select('*').eq('user_id', userId).order('id').range(da, a)),
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
    portafoglio: tutta((da, a) => admin.from('wallet_ledger').select('*').eq('user_id', userId).order('id').range(da, a)),
    punti_fedelta: tutta((da, a) => admin.from('loyalty_accounts').select('*').eq('user_id', userId).order('user_id').range(da, a)),
    punti_movimenti: tutta((da, a) => admin.from('loyalty_transactions').select('*').eq('user_id', userId).order('id').range(da, a)),
    buoni_regalo: tutta((da, a) => admin.from('gift_cards').select('*').or(`buyer_id.eq.${userId},redeemed_by.eq.${userId}`).order('code').range(da, a)),
    domande_sui_prodotti: tutta((da, a) => admin
      .from('product_questions')
      .select('*')
      .or(`author_id.eq.${userId},answered_by.eq.${userId}`).order('id').range(da, a)),
    sos_del_fattorino: tutta((da, a) => admin.from('rider_sos_events').select('*').eq('rider_id', userId).order('id').range(da, a)),
    carrello_salvato: tutta((da, a) => admin.from('user_carts').select('*').eq('user_id', userId).order('user_id').range(da, a)),
    carrelli_abbandonati: tutta((da, a) => admin.from('abandoned_carts').select('*').eq('user_id', userId).order('user_id').range(da, a)),
    iscrizioni_agli_eventi: tutta((da, a) => admin.from('event_rsvps').select('*').eq('user_id', userId).order('event_id').range(da, a)),
    negozi_seguiti: tutta((da, a) => admin.from('follows').select('*').eq('user_id', userId).order('store_id').range(da, a)),
    liste_di_prodotti: tutta((da, a) => admin.from('product_lists').select('*').eq('owner_id', userId).order('id').range(da, a)),
    ordini_di_gruppo: tutta((da, a) => admin
      .from('group_orders')
      .select('*')
      .or(`organizer_id.eq.${userId},seller_id.eq.${userId}`).order('id').range(da, a)),
    partecipazioni_di_gruppo: tutta((da, a) => admin.from('group_participants').select('*').eq('user_id', userId).order('id').range(da, a)),
    ordini_ricorrenti: tutta((da, a) => admin
      .from('subscription_orders')
      .select('*')
      .or(`user_id.eq.${userId},seller_id.eq.${userId}`).order('id').range(da, a)),
    tentativi_di_pagamento: tutta((da, a) => admin.from('payment_attempts').select('*').eq('user_id', userId).order('id').range(da, a)),
    casse_aperte: tutta((da, a) => admin.from('pending_checkouts').select('*').eq('buyer_id', userId).order('id').range(da, a)),
    casse_contanti: tutta((da, a) => admin.from('cod_checkout_attempts').select('*').eq('user_id', userId).order('chiave').range(da, a)),
    email_in_coda: tutta((da, a) => admin.from('email_queue').select('*').eq('user_id', userId).order('id').range(da, a)),
    segnalazioni_fatte: tutta((da, a) => admin.from('segnalazioni').select('*').eq('segnalante_id', userId).order('id').range(da, a)),
    cashback_riscosso: tutta((da, a) => admin.from('cashback_redemptions').select('*').eq('user_id', userId).order('campaign_id').order('order_id').range(da, a)),
    codici_di_zona_usati: tutta((da, a) => admin.from('zone_code_uses').select('*').eq('user_id', userId).order('id').range(da, a)),
    recensioni_votate_utili: tutta((da, a) => admin.from('review_helpful').select('*').eq('user_id', userId).order('review_id').range(da, a)),
    storie_guardate: tutta((da, a) => admin.from('seller_story_views').select('*').eq('user_id', userId).order('story_id').order('viewed_at').range(da, a)),
    voti_negozio_del_mese: tutta((da, a) => admin.from('shop_of_month_votes').select('*').eq('voter_id', userId).order('id').range(da, a)),
    traguardi: tutta((da, a) => admin.from('user_achievements').select('*').eq('user_id', userId).order('achievement_id').range(da, a)),
    // 12/11/2026 (R02-025) — IL FATTORINO. Le recensioni che RICEVE stanno su rider_id (quelle
    // che scrive su user_id, già in «reviews.riders»), e le sue giornate di cassa sono dati suoi:
    // chi ha consegnato, quanto contante, quando l'ha rimesso. Delle recensioni ricevute non esce
    // chi le ha scritte (user_id): è un dato di un'altra persona (art. 15.4 GDPR).
    recensioni_ricevute_come_fattorino: tutta((da, a) => admin.from('rider_reviews').select('id, rider_id, order_id, rating, comment, created_at').eq('rider_id', userId).order('id').range(da, a)),
    giornate_di_cassa_del_fattorino: tutta((da, a) => admin.from('cod_reconciliations').select('*').eq('rider_id', userId).order('id').range(da, a)),
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
    if (esito.alTetto) sezioni_al_tetto.push(nome);
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
          : 'ATTENZIONE: questo file NON è completo. Alcune sezioni non siamo riusciti a leggerle: le trovi in «letture_fallite», e nel file valgono null. Null non vuol dire «non hai niente»: vuol dire «non lo sappiamo». Riprova più tardi o scrivici, hai diritto a riceverle.' +
            (sezioni_al_tetto.length > 0 ? ` Inoltre le sezioni in «sezioni_al_tetto» contengono solo le prime ${TETTO_PER_SEZIONE} righe.` : ''),
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
