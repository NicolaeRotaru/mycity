import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { chiamataDelCalendarioFerma, rispostaDelFermo } from '@/lib/cron/fermo-dei-lavori';
import { logger } from '@/lib/logger';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

/** Ore di silenzio fra due avvisi sullo stesso carrello pagato a metà: il giro passa ogni mezz'ora. */
const ORE_SILENZIO_CARRELLO = 24;
const chiaveCarrello = (id: string) => `CARRELLO_PAGATO_A_META|${id}`;

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
 * Cadenza: ogni 30 minuti. Chi la fa partire sta in `vercel.json` → `crons`.
 * A mano si chiama così:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/expire-checkouts
 */
export const POST = withCronAuth(async (req): Promise<NextResponse> => {
  // 31/10/2026 — Il fermo dei lavori a orario: dopo il segreto, prima di tutto il resto (lib/cron/fermo-dei-lavori.ts).
  if (chiamataDelCalendarioFerma(req)) return rispostaDelFermo();
  let admin: ReturnType<typeof getAdminSupabase>;
  try {
    admin = getAdminSupabase();
  } catch (e) {
    return ApiErrors.unavailable(e instanceof Error ? e.message : 'config error');
  }

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
  // R01-016 (12/11/2026) — DUECENTO CARRELLI PAGATI A META' FERMAVANO LA PULIZIA PER SEMPRE.
  //
  // I carrelli pagati a meta' restano PENDING (non si toccano: vanno guardati a mano), quindi
  // tornano fra i candidati a ogni giro. Con il tetto a duecento e nessun ordine, bastavano
  // duecento casi cosi' per occupare tutti i posti: ogni giro leggeva sempre gli stessi, non ne
  // scadeva nessuno, e i carrelli scaduti dietro tenevano la merce bloccata per sempre.
  // Adesso si legge a pagine (dalla scadenza piu' recente indietro): se una pagina e' piena
  // solo di carrelli pagati a meta', si passa alla successiva, fino a PAGINE_MASSIME.
  const PAGINA = 200;
  const PAGINE_MASSIME = 5;
  type Candidato = { id: string; groups: unknown; coupon_code: string | null; stripe_session_id: string | null; expires_at?: string };
  const candidati: Candidato[] = [];
  const conOrdini = new Set<string>();
  let cursore = new Date().toISOString();
  for (let pagina = 0; pagina < PAGINE_MASSIME; pagina++) {
    const { data: lette, error: errLettura } = await admin
      .from('pending_checkouts')
      .select('id, groups, coupon_code, stripe_session_id, expires_at')
      .eq('status', 'PENDING')
      .lt('expires_at', cursore)
      .order('expires_at', { ascending: false })
      // 22/8/2026 — non c'era nessun tetto. Se per un guasto restassero
      // diecimila carrelli scaduti, questo giro proverebbe a chiuderli tutti in
      // un colpo: il tempo massimo del lavoro scade a metà, e il giro dopo
      // ricomincia dallo stesso punto senza mai arrivare in fondo. Duecento per
      // pagina, ogni trenta minuti: il resto lo prende il giro successivo.
      .limit(PAGINA);

    if (errLettura) {
      logger.error('[cron] expire-checkouts: lettura fallita', errLettura);
      return NextResponse.json({ ok: false, error: errLettura.message }, { status: 500 });
    }
    const righe = (lette ?? []) as Candidato[];
    candidati.push(...righe);

    const sessioni = righe.map((c) => c.stripe_session_id).filter((x): x is string => !!x);
    let salvatiQui = 0;
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
      salvatiQui = righe.filter((c) => !!c.stripe_session_id && conOrdini.has(c.stripe_session_id)).length;
    }

    // Pagina non piena: non c'e' altro da leggere. Pagina con almeno un carrello da scadere:
    // il lavoro di questo giro c'e', il resto lo prende il giro dopo.
    if (righe.length < PAGINA || salvatiQui < righe.length) break;
    const ultima = righe[righe.length - 1]?.expires_at;
    if (!ultima || ultima >= cursore) break;
    cursore = ultima;
  }

  /** Perche' l'avviso agli amministratori non e' partito: `null` = e' partito, o non serviva. */
  let avvisoNonPartito: string | null = null;
  /** Nessun amministratore in tabella: riprovare non lo fa comparire, quindi non si ritenta. */
  let avvisoSenzaDestinatario = false;
  const daSalvare = (candidati ?? []).filter((c) => {
    const sid = (c as { stripe_session_id?: string | null }).stripe_session_id;
    return !!sid && conOrdini.has(sid);
  });
  // 5/11/2026 — Lo stesso carrello pagato a metà restava fra i candidati e ogni mezz'ora scriveva un
  // avviso nuovo a ogni amministratore. Si avvisa una volta ogni 24 ore per carrello, con la memoria
  // del sorvegliante operativo (`operational_alert_log`). Se la memoria non si legge, si avvisa.
  let daAvvisare = daSalvare;
  if (daSalvare.length > 0) {
    try {
      const soglia = new Date(Date.now() - ORE_SILENZIO_CARRELLO * 3_600_000).toISOString();
      // R01-016 — Con le pagine i carrelli pagati a meta' possono essere fino a mille: le chiavi si
      // chiedono a blocchi di cento, perche' mille chiavi in una sola richiesta fanno un indirizzo
      // troppo lungo, la lettura cade e si riavviserebbe tutto a ogni giro.
      const chiavi = daSalvare.map((c) => chiaveCarrello(c.id as string));
      const giaAvvisati = new Set<string>();
      let letturaRiuscita = true;
      for (let i = 0; i < chiavi.length && letturaRiuscita; i += 100) {
        const { data: gia, error: errGia } = await admin
          .from('operational_alert_log')
          .select('alert_key')
          .in('alert_key', chiavi.slice(i, i + 100))
          .gte('last_sent_at', soglia);
        if (errGia) letturaRiuscita = false;
        else for (const r of gia ?? []) giaAvvisati.add((r as { alert_key: string }).alert_key);
      }
      if (letturaRiuscita) {
        daAvvisare = daSalvare.filter((c) => !giaAvvisati.has(chiaveCarrello(c.id as string)));
      }
    } catch (e) {
      logger.warn('[cron] expire-checkouts: memoria degli avvisi non letta, si avvisa', { e });
    }
  }
  if (daAvvisare.length > 0) {
    // Non si tocca niente e si avvisa: un carrello pagato a meta' e' un caso
    // da guardare a mano, non da chiudere in silenzio.
    logger.error('[cron] carrelli scaduti ma con ordini gia creati: non toccati', {
      ids: daSalvare.map((c) => c.id),
    });
    // 6/9/2026 — E L'UNICO AVVISO SU QUESTO CASO POTEVA SPARIRE IN SILENZIO.
    //
    // La riga si scriveva con un `await ... .insert(righe)` di cui nessuno
    // leggeva l'esito, e il client Supabase non solleva eccezioni: categoria
    // rifiutata, permesso cambiato, riga non valida, e il giro rispondeva
    // comunque «ok». Il caso e' il piu' delicato che il sistema conosca —
    // merce gia' venduta e cliente da rimborsare a mano — e restava scritto
    // solo nel log tecnico. Ogni altra scrittura di questo file l'errore lo
    // legge gia': qui era saltato perche' e' un ramo che quasi mai gira.
    const { data: admins, error: errAdmins } = await admin.from('profiles').select('id').eq('role', 'admin');
    const righe = (admins ?? []).map((a) => ({
      category: 'system',
      user_id: a.id,
      title: '⚠️ Carrello scaduto con ordini gia creati',
      body: `${daAvvisare.length} carrello/i sono scaduti ma hanno gia' degli ordini: la merce NON e' stata rimessa in vendita. Vanno chiusi a mano.`,
      link: '/admin/orders',
    }));
    if (errAdmins) {
      logger.error('[cron] elenco amministratori non letto: avviso non partito', errAdmins);
      avvisoNonPartito = errAdmins.message;
    } else if (righe.length === 0) {
      // Nessun amministratore in tabella: riprovare non lo fa comparire, ma
      // nemmeno questo puo' restare una riga di log che non guarda nessuno.
      logger.error('[cron] nessun amministratore da avvisare: carrello pagato a meta senza destinatario');
      // 5/11/2026 — Non si risponde 500: il giro sarebbe rosso e ritentato per sempre, e nessun
      // tentativo fa comparire un amministratore. Lo dice la risposta (`avvisoSenzaDestinatario`).
      avvisoSenzaDestinatario = true;
    } else {
      const { error: errAvviso } = await admin.from('notifications').insert(righe);
      if (errAvviso) {
        logger.error('[cron] avviso agli amministratori non scritto', errAvviso);
        avvisoNonPartito = errAvviso.message;
      } else {
        try {
          const adesso = new Date().toISOString();
          const { error: errMemoria } = await admin
            .from('operational_alert_log')
            .upsert(daAvvisare.map((c) => ({ alert_key: chiaveCarrello(c.id as string), last_sent_at: adesso })));
          if (errMemoria) logger.warn('[cron] expire-checkouts: memoria degli avvisi non scritta', { message: errMemoria.message });
        } catch (e) {
          logger.warn('[cron] expire-checkouts: memoria degli avvisi non scritta', { e });
        }
      }
    }
  }

  // `includes` su un elenco costa un giro dell'elenco per ogni candidato: con
  // duecento candidati sono quarantamila confronti. Un insieme risponde subito.
  const salvati = new Set(daSalvare);
  const daScadere = (candidati ?? []).filter((c) => !salvati.has(c));
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
      if (rErr) {
        // 5/11/2026 — Come il gemello nel webhook (lib/stripe/webhook/carrello-scaduto.ts): il carrello
        // è già EXPIRED e nessun giro lo riprende, quindi lo deve sapere una persona.
        logger.error('[cron] restore_stock on expire fallita', { id: pc.id, message: rErr.message });
        await notifyAdmins(
          '⚠️ Merce non rimessa in vendita',
          `Il carrello ${pc.id} è scaduto ma la sua merce (${items.length} articolo/i) non è tornata in vendita: la giacenza va sistemata a mano.`,
          '/admin/orders',
        ).catch((e) => logger.error('[cron] expire-checkouts: avviso merce non partito', { id: pc.id, e }));
      }
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

  // L'avviso mancato non si perde in un log: il giro si dichiara fallito, cosi'
  // Vercel lo ritenta. Il lavoro fatto qui sopra e' gia' idempotente — scade
  // solo cio' che e' ancora PENDING — quindi al giro dopo si riprova l'avviso
  // e non si ripristina niente due volte.
  if (avvisoNonPartito) {
    return NextResponse.json(
      { ok: false, error: `avviso agli amministratori non partito: ${avvisoNonPartito}`, expired: count, saltati: daSalvare.length },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, expired: count, saltati: daSalvare.length, ...(avvisoSenzaDestinatario ? { avvisoSenzaDestinatario } : {}) },
    { status: 200 },
  );
});

// I lavori periodici di Vercel bussano in GET, sempre — non c'è modo di
// chiedergli un POST. Questa rotta nasceva POST-e-basta, dai tempi del cron
// esterno: su Vercel avrebbe risposto «405 metodo non ammesso» a ogni giro, e
// il lavoro non sarebbe mai partito. Stesso identico handler, stesso controllo
// del segreto: cambia solo la porta da cui si entra. Il POST resta valido
// perché il cron esterno continua a girare finché non lo spegni.
export const GET = POST;
