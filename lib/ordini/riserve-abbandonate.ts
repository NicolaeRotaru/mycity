import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { RiserveLiberate } from '@/lib/ordini/ordine-in-contanti-puo-nascere';
import {
  SESSIONE_NON_GUARDATA,
  TETTO_TENTATIVI_APERTI,
  tentativiApertiDaLiberare,
  type RigaTentativo,
} from '@/lib/ordini/tentativi-aperti-da-liberare';
import {
  destinoDellaPagina,
  dopoIlRifiutoDiStripe,
  type EsitoChiusura,
} from '@/lib/ordini/che-fine-ha-fatto-la-pagina-di-pagamento';

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
 *
 * ── 3/9/2026: LIBERARE LA MERCE E CHIUDERE LA PAGINA SONO UNA COSA SOLA ──────
 * Chiudere la pagina di pagamento era un favore che ogni chiamante doveva
 * ricordarsi di fare (un parametro facoltativo). La rotta della carta se lo
 * ricordava, quella dei contanti no: chi premeva «Paga con carta», ci ripensava
 * e sceglieva i contanti si portava dietro una scheda di Stripe ancora
 * pagabile. Se ci tornava e pagava, l'avviso di Stripe trovava la riserva già
 * scaduta e rimborsava: soldi addebitati e riaccreditati a chi aveva già deciso
 * di pagare in contanti, con la commissione fissa persa e una telefonata
 * all'assistenza.
 *
 * Adesso le due cose non si possono più separare: la chiusura la fa QUESTA
 * funzione, sempre. Chi la chiama non deve ricordarsi niente.
 *
 * ── 8/9/2026: PRIMA SI CHIUDE, POI SI LIBERA ────────────────────────────────
 * Chiudere la pagina restava comunque un'AZIONE, e un'azione può non riuscire:
 * Stripe irraggiungibile, chiamata rifiutata, oppure — il caso peggiore — la
 * pagina è appena stata PAGATA e non si può più chiudere. L'errore finiva in un
 * avviso nel registro, la merce tornava a scaffale lo stesso e chi aveva
 * chiamato non lo sapeva: restava in piedi la coppia che non deve esistere, un
 * ordine in contanti e una pagina con la carta ancora viva.
 *
 * L'ordine delle operazioni è stato rovesciato. La chiusura viene PRIMA della
 * rivendicazione della riga: se non riesce, di quel tentativo non si tocca
 * niente — niente `EXPIRED`, niente merce rimessa in vendita, niente codice
 * sconto restituito — e la sessione finisce in `ancoraPagabili`, che chi ha
 * chiamato deve guardare (`ordineInContantiPuoNascere`).
 *
 * Due cose si aggiustano da sole con questo rovesciamento:
 *   ① un pagamento appena riuscito, con l'avviso di Stripe ancora per strada,
 *      non fa più liberare la merce che ha appena comprato — `expire` su una
 *      sessione pagata fallisce, e il fallimento adesso ferma tutto invece di
 *      essere ignorato. Prima quel pagamento buono finiva rimborsato;
 *   ② lo stato resta coerente: la riga rimane `PENDING` con la sua merce
 *      impegnata, quindi al tentativo successivo si riprova da capo. Il freno
 *      non è di un solo giro, è scritto nei dati.
 *
 * ── 8/9/2026 (secondo giro): UN CANCELLO CIECO NON È UN CANCELLO ────────────
 * Tre cose, tutte nello stesso verso — quello che non fa incassare due volte.
 *
 * ① **Si guardano tutti i tentativi aperti, non i primi dieci che capitano.**
 *    La lettura chiedeva `.limit(10)` senza nemmeno dire in che ordine, e il
 *    filtro sui prodotti girava DOPO, qui in JavaScript: all'undicesimo
 *    tentativo aperto il cancello smetteva di vedere, in silenzio, e la pagina
 *    vecchia restava viva. Adesso la scelta di chi guardare vive in
 *    `tentativiApertiDaLiberare`, che è pura e si può eseguire in una prova.
 * ② **«Non ho potuto guardare» non si dice più «non c'è niente di pagabile».**
 *    Se la lettura dei tentativi fallisce, o se il controllo sugli ordini già
 *    creati fallisce, esce un `ancoraPagabili` che contiene almeno
 *    `SESSIONE_NON_GUARDATA`: i cancelli a valle si fermano, come si fermano
 *    davanti a una pagina viva. Prima la stessa situazione lasciava passare.
 * ③ **La pagina già scaduta da sé non blocca più i contanti.** Stripe rifiuta
 *    `expire` sia sulla pagina viva sia su quella già scaduta: adesso, dopo il
 *    rifiuto, si va a guardare com'è messa (`destinoDellaPagina`) invece di
 *    dare per scontato il peggio. Solo `expired` apre la strada.
 */

/** Il poco che serve del client di servizio: così la prova può eseguirla davvero. */
export type ClientRiserve = Pick<SupabaseClient, 'from' | 'rpc'>;

/**
 * La chiusura vera della pagina di pagamento.
 *
 * Si carica solo quando c'è davvero una pagina da chiudere: così questo modulo
 * resta leggero per chi lo importa e per le prove che non hanno Stripe.
 *
 * Il caso normale è una chiamata sola (`expire` riesce). La seconda chiamata —
 * la riletta — si paga solo quando Stripe ha detto no, ed è quella che
 * distingue «ancora viva» da «già scaduta da sé»: senza, un ordine in contanti
 * restava bloccato per mezz'ora da una pagina che non incassava più niente.
 */
async function chiudiSuStripe(sessionId: string): Promise<EsitoChiusura> {
  const { getStripe } = await import('@/lib/stripe/client');
  const stripe = getStripe();
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return 'chiusa';
  } catch (rifiuto) {
    let sessione: { status?: string | null; payment_status?: string | null } | null = null;
    try {
      sessione = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (illeggibile) {
      logger.warn('[riserve] pagina di pagamento non rileggibile dopo il rifiuto', {
        sessione: sessionId, illeggibile,
      });
    }
    const destino = destinoDellaPagina(sessione);
    if (destino !== 'gia_morta') {
      logger.error('[riserve] pagina di pagamento NON chiusa', { sessione: sessionId, destino, rifiuto });
    } else {
      logger.info('[riserve] pagina di pagamento gia scaduta da se: niente da chiudere', { sessione: sessionId });
    }
    return dopoIlRifiutoDiStripe(destino);
  }
}

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
    /**
     * NON serve passarla: la pagina di pagamento la chiude questa funzione, da
     * sola, su Stripe. Esiste solo perché le prove possano guardare che venga
     * chiusa davvero, senza parlare con Stripe.
     *
     * Chi la passa può rispondere con un `EsitoChiusura`; chi non risponde
     * niente (`void`) viene inteso come «chiusa», ed è il caso normale.
     */
    chiudiSessione?: (sessionId: string) => Promise<void | EsitoChiusura>;
  },
): Promise<RiserveLiberate> {
  // Si chiede una riga IN PIÙ del tetto apposta: è così che ci si accorge di
  // averlo superato invece di tagliare in silenzio.
  const { data, error } = await admin
    .from('pending_checkouts')
    .select('id, created_at, groups, coupon_code, stripe_session_id, delivery')
    .eq('buyer_id', opzioni.buyerId)
    .eq('status', 'PENDING')
    .limit(TETTO_TENTATIVI_APERTI + 1);

  const selezione = tentativiApertiDaLiberare(
    { righe: (data ?? null) as RigaTentativo[] | null, errore: error, tetto: TETTO_TENTATIVI_APERTI },
    { improntaDaTenere: opzioni.improntaDaTenere, soloConProdotti: opzioni.soloConProdotti ?? null },
  );

  if (!selezione.guardati) {
    // Qui non si sa se una pagina di pagamento vecchia sia ancora viva. Andare
    // avanti vorrebbe dire aprirne una seconda sugli stessi articoli: si dice
    // «non ho potuto guardare», e i cancelli a valle si fermano.
    logger.error('[riserve] tentativi aperti NON guardati: non si incassa', {
      perche: selezione.perche,
      dettaglio: selezione.dettaglio,
    });
    return { liberati: [], ancoraPagabili: [SESSIONE_NON_GUARDATA] };
  }

  const candidati = selezione.candidati;
  if (candidati.length === 0) return { liberati: [], ancoraPagabili: [] };

  // ① Chi ha già degli ordini non si tocca: la merce è stata venduta davvero.
  const sessioni = candidati.map((r) => r.stripe_session_id).filter((s): s is string => !!s);
  const conOrdini = new Set<string>();
  if (sessioni.length > 0) {
    const { data: ordini, error: errOrdini } = await admin
      .from('orders')
      .select('stripe_session_id')
      .in('stripe_session_id', sessioni);
    if (errOrdini) {
      // Non si libera niente, come prima. Ma adesso lo si DICE anche a chi ha
      // chiamato: quelle pagine potrebbero essere vive, e nessuno le ha chiuse.
      logger.error('[riserve] controllo ordini fallito: non libero niente e non si incassa', {
        message: errOrdini.message,
      });
      return { liberati: [], ancoraPagabili: [SESSIONE_NON_GUARDATA] };
    }
    for (const o of (ordini ?? []) as Array<{ stripe_session_id?: string | null }>) {
      if (o.stripe_session_id) conOrdini.add(o.stripe_session_id);
    }
  }

  const liberati: string[] = [];
  const ancoraPagabili: string[] = [];
  for (const riga of candidati) {
    if (riga.stripe_session_id && conOrdini.has(riga.stripe_session_id)) {
      logger.warn('[riserve] tentativo con ordini gia creati: non lo tocco', { id: riga.id });
      continue;
    }

    // ①bis PRIMA SI CHIUDE LA PAGINA DI PAGAMENTO, POI SI LIBERA LA MERCE.
    //
    // Se questa chiamata non riesce, la pagina resta pagabile: allora di questo
    // tentativo non si tocca NIENTE. Liberare la merce lasciando viva la pagina
    // è esattamente la coppia che fa pagare due volte. E se il motivo del
    // fallimento è che la pagina è appena stata PAGATA, fermarsi qui salva un
    // pagamento buono dal rimborso automatico.
    //
    // Unica eccezione, ed è il motivo per cui qui non basta un sì/no: la pagina
    // già SCADUTA da sé. Stripe rifiuta `expire` anche su quella, ma quella non
    // incassa più niente — trattarla come viva bloccava un ordine in contanti
    // per mezz'ora, con un «riprova» che non poteva funzionare.
    if (riga.stripe_session_id) {
      let esito: EsitoChiusura;
      try {
        esito = (await (opzioni.chiudiSessione ?? chiudiSuStripe)(riga.stripe_session_id)) ?? 'chiusa';
      } catch (e) {
        logger.error('[riserve] pagamento vecchio non chiuso: non libero niente di questo tentativo', {
          id: riga.id, sessione: riga.stripe_session_id, e,
        });
        esito = 'ancora_pagabile';
      }
      if (esito === 'ancora_pagabile') {
        ancoraPagabili.push(riga.stripe_session_id);
        continue;
      }
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

    liberati.push(riga.id);
  }

  if (liberati.length > 0) {
    logger.info('[riserve] merce liberata da tentativi abbandonati', { quanti: liberati.length });
  }
  if (ancoraPagabili.length > 0) {
    logger.error('[riserve] pagine di pagamento rimaste pagabili', { quante: ancoraPagabili.length });
  }
  return { liberati, ancoraPagabili };
}
