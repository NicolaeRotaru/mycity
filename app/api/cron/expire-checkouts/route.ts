import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Cron: marca come EXPIRED i pending_checkouts scaduti (default 2h).
 *
 * Perché serve: ogni Checkout Session Stripe ha una vita ~24h ma il
 * record-of-intent su DB potrebbe restare PENDING indefinitamente se
 * il buyer abbandona la sessione Stripe senza pagare. Tenerli puliti
 * evita confusione in dashboard admin e libera lo stripe_session_id.
 *
 * Esperti consultati:
 * - SRE: "Esecuzione ogni 30 min. Idempotente. Update-only, niente delete
 *   per audit trail."
 *
 * Setup esterno:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/expire-checkouts
 */
export const POST = withCronAuth(async (): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  // 162 — PRIMA DI RIMETTERE IN VENDITA, GUARDA SE E' GIA' STATO VENDUTO.
  //
  // La riserva della merce dura due ore. Se il pagamento riesce ma il webhook
  // muore a meta' — creati gli ordini dei primi negozi, non quelli degli
  // ultimi — il record resta PENDING mentre gli ordini dei gruppi precedenti
  // esistono davvero. Questo giro li ignorava: rimetteva in magazzino la merce
  // di TUTTI i gruppi, compresi quelli gia' venduti, e liberava il codice
  // sconto gia' consumato. Poi il tentativo successivo di Stripe trovava il
  // record EXPIRED e rimborsava tutto, mentre il negozio stava preparando.
  // Doppia vendita della stessa merce e un cliente rimborsato a merce in
  // lavorazione: poco probabile, devastante quando capita.
  //
  // Adesso si guarda prima: si prendono i candidati, si tolgono quelli che
  // hanno gia' un ordine, e solo il resto scade.
  const { data: candidati, error: errLettura } = await admin
    .from('pending_checkouts')
    .select('id, groups, coupon_code, stripe_session_id')
    .eq('status', 'PENDING')
    .lt('expires_at', new Date().toISOString());

  if (errLettura) {
    logger.error('[cron] expire-checkouts: lettura fallita', errLettura);
    return NextResponse.json({ ok: false, error: errLettura.message }, { status: 500 });
  }

  const sessioni = (candidati ?? [])
    .map((c) => (c as { stripe_session_id?: string | null }).stripe_session_id)
    .filter((x): x is string => !!x);
  const conOrdini = new Set<string>();
  if (sessioni.length > 0) {
    const { data: ordini, error: errOrdini } = await admin
      .from('orders')
      .select('stripe_session_id')
      .in('stripe_session_id', sessioni);
    if (errOrdini) {
      // Meglio non scadere niente che ripristinare merce gia' venduta.
      logger.error('[cron] expire-checkouts: controllo ordini fallito, nessuna scadenza applicata', errOrdini);
      return NextResponse.json({ ok: false, error: errOrdini.message }, { status: 500 });
    }
    for (const o of ordini ?? []) {
      const sid = (o as { stripe_session_id?: string | null }).stripe_session_id;
      if (sid) conOrdini.add(sid);
    }
  }

  const daSalvare = (candidati ?? []).filter((c) => {
    const sid = (c as { stripe_session_id?: string | null }).stripe_session_id;
    return !!sid && conOrdini.has(sid);
  });
  if (daSalvare.length > 0) {
    // Non si tocca niente e si avvisa: un carrello pagato a meta' e' un caso
    // da guardare a mano, non da chiudere in silenzio.
    logger.error('[cron] carrelli scaduti ma con ordini gia creati: non toccati', {
      ids: daSalvare.map((c) => c.id),
    });
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
    const righe = (admins ?? []).map((a) => ({
      category: 'system',
      user_id: a.id,
      title: '⚠️ Carrello scaduto con ordini gia creati',
      body: `${daSalvare.length} carrello/i sono scaduti ma hanno gia' degli ordini: la merce NON e' stata rimessa in vendita. Vanno chiusi a mano.`,
      link: '/admin/orders',
    }));
    if (righe.length > 0) await admin.from('notifications').insert(righe);
  }

  const daScadere = (candidati ?? []).filter((c) => !daSalvare.includes(c));
  const ids = daScadere.map((c) => c.id);

  /**
   * 22/8/2026 — SI RIPRISTINA SOLO CIO' CHE SI E' DAVVERO RIVENDICATO.
   *
   * Qui si scriveva EXPIRED senza nessuna condizione sullo stato e senza
   * chiedere indietro le righe toccate, poi si ripristinava la merce per OGNI
   * candidato letto. Due strade rotte, tutte e due vere:
   *
   * · questo giro e il webhook `checkout.session.expired` passano insieme: la
   *   merce torna a scaffale due volte e il magazzino segna pezzi che non
   *   esistono — si vende quello che non c'e' — e il codice sconto viene
   *   restituito due volte;
   * · un `checkout.session.completed` in ritardo scrive COMPLETED subito dopo
   *   la lettura, questo giro lo ribalta a EXPIRED e rimette a scaffale merce
   *   appena venduta davvero.
   *
   * Il gemello nel webhook fa gia' cosi', e il suo commento descrive parola per
   * parola questo scenario. Qui mancava.
   */
  let data: typeof daScadere = [];
  if (ids.length > 0) {
    const { data: rivendicati, error } = await admin
      .from('pending_checkouts')
      .update({ status: 'EXPIRED' })
      .in('id', ids)
      .eq('status', 'PENDING')
      .select('id');
    if (error) {
      logger.error('[cron] expire-checkouts failed', error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    const presi = new Set((rivendicati ?? []).map((r) => r.id as string));
    data = daScadere.filter((c) => presi.has(c.id as string));
    if (data.length < ids.length) {
      logger.info('[cron] expire-checkouts: qualcuno era gia stato preso', {
        candidati: ids.length, rivendicati: data.length,
      });
    }
  }

  const count = data.length;

  // Rilascia lo stock riservato al checkout per i pending scaduti (P0-4).
  // NB (audit 🟡-5): includere variant_id, altrimenti per i prodotti con varianti
  // restore_stock incrementa products.stock (poi sovrascritto dal trigger di
  // rollup) e lo stock della VARIANTE riservato non viene mai ripristinato.
  // Identico al gemello nel webhook checkout.session.expired.
  for (const pc of data) {
    const groups =
      (pc.groups as Array<{ items?: Array<{ productId: string; quantity: number; variantId?: string | null }> }> | null) ?? [];
    const items = groups.flatMap((g) =>
      (g.items ?? []).map((it) => ({ product_id: it.productId, variant_id: it.variantId ?? null, qty: it.quantity })),
    );
    if (items.length > 0) {
      const { error: rErr } = await admin.rpc('restore_stock', { p_items: items });
      if (rErr) logger.warn('[cron] restore_stock on expire fallita', { id: pc.id, message: rErr.message });
    }

    // Come per lo stock, anche il codice sconto torna disponibile: era stato
    // contato come usato prima del pagamento, e il pagamento non è avvenuto.
    const codice = (pc as { coupon_code?: string | null }).coupon_code ?? null;
    if (codice) {
      const { error: cErr } = await admin.rpc('release_coupon', { p_code: codice });
      if (cErr) logger.warn('[cron] codice sconto non restituito', { id: pc.id, message: cErr.message });
    }
  }

  if (count > 0) {
    logger.spesa(`[cron] expired ${count} pending checkouts`);
  }

  return NextResponse.json({ ok: true, expired: count, saltati: daSalvare.length }, { status: 200 });
});
