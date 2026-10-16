/**
 * Un rimborso PARZIALE fatto a mano dal cruscotto Stripe, cioè non partito da
 * `refundOrder`.
 *
 * 15/10/2026 (R85) — IL RIMBORSO DAL CRUSCOTTO VENIVA IGNORATO.
 *
 * Quando arrivava `charge.refunded` con un rimborso non totale, il gestore
 * scriveva un avviso nei log («riconciliare a mano») e usciva. Lo faceva anche
 * quando il pagamento apparteneva a un ordine solo, dove non c'è nessun dubbio
 * su chi abbia rimborsato cosa. Un caso vero: ordine da Pane Quotidiano di
 * 27,90 €, manca una focaccia da 3 €, Nicola rimborsa 3 € dal cruscotto. Sul
 * nostro database l'ordine restava «pagato», con zero rimborsato. Due danni:
 *
 *   ① il giro dei bonifici versava al negozio il netto intero (18,00 €): la sua
 *     parte dei 3 € la pagava MyCity;
 *   ② l'annullo successivo chiedeva a Stripe 27,90 € quando ne restavano 24,90:
 *     Stripe rifiutava e l'ordine non si poteva più annullare dal sito.
 *
 * Adesso, su un ordine solo, il rimborso si registra con la stessa contabilità
 * di `refundOrder` — importo rimborsato, quota del negozio, stato «rimborsato
 * in parte» — senza chiedere a Stripe un secondo rimborso: quello è già
 * uscito. Su un pagamento di più negozi Stripe non dice a quale ordine
 * appartiene il rimborso, e indovinare vorrebbe dire togliere soldi al negozio
 * sbagliato: lì si fermano i bonifici del carrello e si avvisano gli
 * amministratori.
 *
 * COME SI RICONOSCE UN RIMBORSO GIÀ REGISTRATO. Dai numeri: `refundOrder`
 * scrive l'importo sull'ordine (`accumula_rimborso`) PRIMA di chiedere il
 * rimborso a Stripe. Quindi, quando Stripe ci avvisa, il rimborsato su Stripe
 * meno il rimborsato scritto da noi è la parte che nessuno ha ancora
 * registrato. L'eco di un nostro rimborso dà zero e non tocca niente; lo
 * stesso evento consegnato due volte dà zero la seconda volta.
 *
 * E DALL'ETICHETTA, COME TETTO (collaudo del 15/10). Un caso in cui i numeri
 * da soli sbagliano: `refundOrder` chiede il rimborso, Stripe lo fa ma la
 * risposta si perde per strada, e `refundOrder` toglie dall'ordine l'importo
 * che aveva segnato (`storna_rimborso`), per poter riprovare. Quando arriva
 * l'avviso, la differenza c'è, ma il rimborso è NOSTRO: registrarlo qui come
 * «da fuori», e poi riregistrarlo quando `refundOrder` riprova, scriveva 6 € di
 * rimborso su 3 usciti e toglieva al negozio due volte la sua quota. Ogni
 * rimborso di `refundOrder` porta l'etichetta `metadata.order_id`: quello che
 * si registra qui non supera mai la somma dei rimborsi SENZA etichetta. Il
 * rimborso nostro rimasto senza registrazione lo ritrova `refundOrder` al
 * nuovo tentativo, con la stessa chiave anti-doppione.
 *
 * E OGNI RIMBORSO DA FUORI SI REGISTRA UNA VOLTA SOLA (riesame del 16/10).
 * Il tetto qui sopra confrontava due cose diverse: quanto manca sul database
 * e la somma di TUTTI i rimborsi senza etichetta, compresi quelli dal
 * cruscotto già registrati da avvisi precedenti. Un caso: 3 € dal cruscotto,
 * registrati; poi un reso da 5 € deciso dal sito perde la risposta di Stripe e
 * `refundOrder` toglie il suo segno; arriva l'avviso dei 5 €: mancano 500, i
 * rimborsi senza etichetta fanno 300, e i 3 € si registravano una seconda volta
 * (al negozio 1,94 € tolti due volte, all'annullo 3 € in meno al cliente).
 * Adesso si registrano rimborsi interi: la stessa scrittura che li registra
 * ne scrive l'id sull'ordine, e subito dopo ricevono su Stripe l'etichetta
 * `registrato_da_fuori`. Un rimborso scritto sull'ordine, o etichettato, non è
 * più «da fuori», qualunque cosa dicano i numeri dopo.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { reverseOrderTransfer } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from './comune';
import { scritturaObbligatoria } from './esito';

/** I campi dell'ordine che servono a registrare il rimborso. */
export type OrdineDelRimborso = {
  id: string;
  /** Sulla carta è il lordo pagato: non c'è credito MyCity da scomputare (ordini.ts). */
  total_price: number | string | null;
  refunded_amount_cents?: number | null;
  payout_status: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id?: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents?: number | null;
  /**
   * I rimborsi già scritti su questo ordine, separati da virgola (vedi
   * `rimborsiGiaScritti`). Lo scrive anche `refundOrder`, col suo rimborso.
   */
  stripe_refund_id?: string | null;
};

/**
 * Valore di `internal_dispute_status` che ferma il giro dei bonifici: il giro
 * paga solo gli ordini con quel campo vuoto o 'RESOLVED'. Si toglie dal
 * pannello (Ordini → «Rimborsi dal cruscotto da dividere»): chi amministra
 * scrive la parte di ciascun ordine, e `registraSullOrdine` la registra con la
 * stessa contabilità di un ordine solo e toglie la pausa nella stessa
 * scrittura.
 */
export const PAUSA_RIMBORSO_DA_DIVIDERE = 'RIMBORSO_DA_RIPARTIRE';

/** L'etichetta che, su Stripe, dice «questo rimborso è già scritto sul nostro database». */
export const ETICHETTA_REGISTRATO = 'registrato_da_fuori';

export type ContoRimborsoDaFuori = {
  /** Il lordo dell'ordine: il tetto di quanto si può rimborsare. */
  lordoCents: number;
  /** Quanto risultava già rimborsato sul nostro database. */
  giaRegistratoCents: number;
  /** La parte del rimborso che nessuno ha ancora registrato. */
  nuovoCents: number;
  /** Il rimborsato dopo questa registrazione. */
  totaleCents: number;
  /** La parte del nuovo rimborso che esce dalla quota del negozio. */
  quotaNegozioCents: number;
};

/**
 * Il conto, senza toccare niente: quanto del rimborso fatto su Stripe manca sul
 * nostro ordine, e quanto ne paga il negozio.
 *
 * La quota del negozio è la stessa di `refundOrder`: la piattaforma restituisce
 * la sua commissione, e al negozio si toglie solo la sua parte del netto, in
 * proporzione al rimborso (rimborso × netto del negozio ÷ lordo dell'ordine).
 */
export function contoDelRimborsoDaFuori(
  ordine: Pick<OrdineDelRimborso, 'total_price' | 'refunded_amount_cents' | 'seller_payout_cents'>,
  rimborsatoSuStripeCents: number,
  /** La somma dei rimborsi da fuori non ancora registrati: più di così non è «da fuori». */
  daFuoriSuStripeCents: number = Number.POSITIVE_INFINITY,
): ContoRimborsoDaFuori {
  const lordoCents = Math.round(Number(ordine.total_price ?? 0) * 100);
  const giaRegistratoCents = ordine.refunded_amount_cents ?? 0;
  const tetto = Math.min(Math.max(0, rimborsatoSuStripeCents), Math.max(0, lordoCents));
  const nuovoCents = Math.max(0, Math.min(tetto - giaRegistratoCents, daFuoriSuStripeCents));
  const netto = ordine.seller_payout_cents ?? 0;
  const quotaNegozioCents =
    lordoCents > 0 ? Math.min(Math.round((nuovoCents * netto) / lordoCents), netto) : 0;
  return {
    lordoCents,
    giaRegistratoCents,
    nuovoCents,
    totaleCents: giaRegistratoCents + nuovoCents,
    quotaNegozioCents,
  };
}

/**
 * Da dove esce la quota del negozio di un rimborso già uscito da Stripe.
 *
 *  · 'dal-bonifico-da-fare' — il bonifico al negozio non è ancora partito: la
 *    quota si toglie da quello che gli verrà versato.
 *  · 'con-uno-storno' — il bonifico è partito: la quota si riprende su Stripe.
 *  · 'a-mano' — il bonifico è partito e uno storno precedente su questo ordine
 *    non è riuscito ('REVERSAL_FAILED'). Il giro dei bonifici quell'ordine non
 *    lo paga più, quindi una quota «tolta dal prossimo bonifico» resterebbe
 *    solo sulla carta: il database direbbe «ripresi» soldi rimasti al negozio
 *    (riesame del 16/10). Si dice a chi amministra quanto recuperare.
 *  · 'dopo-il-bonifico-in-corso' — il giro dei bonifici sta pagando adesso:
 *    il conto si fa quando ha finito.
 */
export type DoveSiRiprendeLaQuota = 'dal-bonifico-da-fare' | 'con-uno-storno' | 'a-mano' | 'dopo-il-bonifico-in-corso';

export function doveSiRiprendeLaQuota(
  ordine: Pick<OrdineDelRimborso, 'payout_status' | 'stripe_transfer_id'>,
): DoveSiRiprendeLaQuota {
  if (ordine.payout_status === 'PROCESSING') return 'dopo-il-bonifico-in-corso';
  if (ordine.payout_status === 'TRANSFERRED' && ordine.stripe_transfer_id) return 'con-uno-storno';
  if (ordine.payout_status === 'REVERSAL_FAILED') return 'a-mano';
  return 'dal-bonifico-da-fare';
}

/** Un rimborso Stripe, per il poco che serve qui. */
export type RimborsoStripe = {
  id?: string;
  amount?: number | null;
  status?: string | null;
  created?: number | null;
  metadata?: Record<string, string> | null;
};

/**
 * Un rimborso partito da fuori e non ancora registrato: senza l'etichetta
 * `order_id` che `refundOrder` mette su ogni rimborso suo, e senza quella che
 * mettiamo noi dopo averlo registrato. Uno fallito o annullato non conta: i
 * soldi sono tornati indietro.
 */
function daFuoriDaRegistrare(r: RimborsoStripe): boolean {
  if (r.status === 'failed' || r.status === 'canceled') return false;
  if ((r.metadata?.order_id ?? '').trim()) return false;
  if ((r.metadata?.[ETICHETTA_REGISTRATO] ?? '').trim()) return false;
  return true;
}

/** La somma dei rimborsi partiti da fuori e non ancora registrati. */
export function sommaDeiRimborsiDaFuori(rimborsi: ReadonlyArray<RimborsoStripe>): number {
  return rimborsi.filter(daFuoriDaRegistrare).reduce((somma, r) => somma + Math.max(0, r.amount ?? 0), 0);
}

/** Quanti rimborsi tiene a mente l'ordine: bastano e avanzano, e la riga non cresce per sempre. */
const RIMBORSI_A_MENTE = 15;

/**
 * I rimborsi che il nostro database dice di aver già scritto su questo ordine.
 *
 * L'etichetta su Stripe arriva DOPO la scrittura sull'ordine, con una chiamata
 * sua: se Stripe in quel momento non risponde, il rimborso resta registrato ma
 * senza etichetta, e un avviso successivo lo ritroverebbe «da fuori». Per
 * questo la stessa scrittura che registra il rimborso ne scrive anche l'id
 * sull'ordine (`stripe_refund_id`, la colonna della tracciabilità dei
 * rimborsi): o passano tutte e due, o nessuna. Un rimborso in questo elenco
 * non si registra più, qualunque cosa dica Stripe.
 */
export function rimborsiGiaScritti(ordine: Pick<OrdineDelRimborso, 'stripe_refund_id'>): Set<string> {
  return new Set((ordine.stripe_refund_id ?? '').split(',').map((x) => x.trim()).filter(Boolean));
}

/** L'elenco da scrivere sull'ordine: quelli di prima più i nuovi, gli ultimi RIMBORSI_A_MENTE. */
function elencoDaScrivere(prima: ReadonlySet<string>, nuovi: ReadonlyArray<string>): string {
  const tutti = [...prima, ...nuovi.filter((id) => !prima.has(id))];
  return tutti.slice(-RIMBORSI_A_MENTE).join(',');
}

/**
 * Quali rimborsi da fuori registrare adesso: INTERI, dal più recente, finché la
 * somma non supera `tettoCents` (quanto i numeri dicono che manca sull'ordine),
 * saltando quelli che l'ordine dice di aver già scritto (`giaScritti`).
 *
 * Interi, perché ognuno, una volta scritto, riceve la sua etichetta: un
 * rimborso registrato a metà non si saprebbe come etichettarlo. Quello che
 * resta fuori lo prende l'avviso successivo, quando i numeri lo permettono.
 *
 * Dal più recente, perché l'avviso arriva per l'ultimo rimborso fatto: se un
 * rimborso già registrato fosse rimasto senza etichetta (Stripe non ha
 * risposto quando gliela chiedevamo), partendo dal più vecchio si prenderebbe
 * di nuovo quello, e il nuovo resterebbe fuori. Stripe elenca i rimborsi dal
 * più recente; a parità di secondo vale il suo ordine.
 */
export function rimborsiDaRegistrare(
  rimborsi: ReadonlyArray<RimborsoStripe>,
  tettoCents: number,
  giaScritti: ReadonlySet<string> = new Set(),
): { ids: string[]; cents: number } {
  const candidati = rimborsi
    .map((r, posto) => ({ r, posto }))
    .filter(({ r }) => daFuoriDaRegistrare(r) && !(r.id && giaScritti.has(r.id)))
    .sort((a, b) => (b.r.created ?? 0) - (a.r.created ?? 0) || a.posto - b.posto);
  const ids: string[] = [];
  let cents = 0;
  for (const { r } of candidati) {
    const importo = Math.max(0, r.amount ?? 0);
    if (cents + importo > tettoCents) break;
    cents += importo;
    if (r.id) ids.push(r.id);
  }
  return { ids, cents };
}

/**
 * Tutti i rimborsi di un pagamento. Nell'avviso di solito non ci sono (dalla
 * versione 2022-11-15 delle API Stripe non li manda più dentro la carica):
 * si chiedono a Stripe. Se Stripe non risponde si lancia, e chi chiama riprova.
 */
export async function elencoDeiRimborsi(
  filtro: { charge: string } | { payment_intent: string },
  inLinea?: Stripe.ApiList<Stripe.Refund> | null,
): Promise<RimborsoStripe[]> {
  if (inLinea && Array.isArray(inLinea.data) && inLinea.has_more === false) return inLinea.data;
  const tutti: RimborsoStripe[] = [];
  let dopo: string | undefined;
  for (let pagina = 0; pagina < 20; pagina++) {
    const elenco = await getStripe().refunds.list({ ...filtro, limit: 100, ...(dopo ? { starting_after: dopo } : {}) });
    tutti.push(...elenco.data);
    if (!elenco.has_more || elenco.data.length === 0) return tutti;
    dopo = elenco.data[elenco.data.length - 1].id;
  }
  throw new Error(`[stripe] rimborsi del pagamento ${JSON.stringify(filtro)}: elenco troppo lungo, non lo indovino`);
}

/**
 * Mette su Stripe l'etichetta «registrato» ai rimborsi appena scritti
 * sull'ordine. Non lancia: il rimborso è già registrato, e il suo id è scritto
 * sull'ordine (`rimborsiGiaScritti`), quindi nessun avviso lo conta di nuovo;
 * l'etichetta mancata si rimette al prossimo avviso dello stesso pagamento, e
 * intanto resta scritta nei log.
 */
export async function etichettaComeRegistrati(ids: ReadonlyArray<string>, orderId: string | null): Promise<void> {
  for (const id of ids) {
    try {
      const etichettato = await getStripe().refunds.update(id, {
        metadata: { [ETICHETTA_REGISTRATO]: '1', ...(orderId ? { order_id: orderId } : {}) },
      });
      if (!etichettato) throw new Error('Stripe non ha risposto');
    } catch (err) {
      logger.error('[stripe] rimborso da fuori registrato ma senza etichetta su Stripe', {
        refundId: id, orderId, message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * La parte del rimborso che è davvero «da fuori», dati i numeri: si chiede a
 * Stripe solo quando i numeri dicono che manca qualcosa, così l'eco dei
 * nostri rimborsi (il caso di tutti i giorni) non costa una chiamata.
 */
async function rimborsatoDaFuori(charge: Stripe.Charge, mancaSulDatabase: number): Promise<number> {
  const daFuori = sommaDeiRimborsiDaFuori(await elencoDeiRimborsi({ charge: charge.id }, charge.refunds));
  if (daFuori < mancaSulDatabase) {
    // La differenza viene da rimborsi NOSTRI non scritti sull'ordine (di solito
    // una risposta di Stripe persa): li ritrova `refundOrder` al nuovo tentativo.
    logger.warn('[stripe] rimborso col nome di un ordine non registrato: non lo conto come «da fuori»', {
      chargeId: charge.id, mancaSulDatabase, daFuori,
    });
  }
  return daFuori;
}

/**
 * Registra sul nostro database un rimborso parziale arrivato da fuori.
 * Lancia se il database non risponde, così la rotta risponde 500 e Stripe
 * ripete l'evento: la seconda volta il conto riparte dai numeri scritti, e quello
 * che era già stato registrato non si registra due volte.
 */
export async function registraRimborsoParzialeDaFuori(
  charge: Stripe.Charge,
  ordini: OrdineDelRimborso[],
): Promise<void> {
  const rimborsatoSuStripe = charge.amount_refunded ?? 0;
  if (ordini.length === 0) return;
  if (ordini.length > 1) {
    await fermaIBonificiDelCarrello(charge, ordini, rimborsatoSuStripe);
    return;
  }

  const ordine = ordini[0];
  const aNumeri = contoDelRimborsoDaFuori(ordine, rimborsatoSuStripe);
  // Zero: è l'eco di un rimborso nostro, o lo stesso avviso arrivato di nuovo.
  if (aNumeri.nuovoCents <= 0) return;
  const rimborsi = await elencoDeiRimborsi({ charge: charge.id }, charge.refunds);
  const giaScritti = rimborsiGiaScritti(ordine);
  // Registrati da un avviso precedente ma rimasti senza etichetta (Stripe non
  // aveva risposto): l'etichetta si rimette adesso, e non si contano di nuovo.
  const daRietichettare = rimborsi
    .filter((r) => !!r.id && giaScritti.has(r.id) && daFuoriDaRegistrare(r))
    .map((r) => r.id as string);
  if (daRietichettare.length > 0) await etichettaComeRegistrati(daRietichettare, ordine.id);
  const scelti = rimborsiDaRegistrare(rimborsi, aNumeri.nuovoCents, giaScritti);
  if (scelti.cents < aNumeri.nuovoCents) {
    // La differenza viene da rimborsi NOSTRI non scritti sull'ordine (di solito
    // una risposta di Stripe persa): li ritrova `refundOrder` al nuovo tentativo.
    logger.warn('[stripe] rimborso col nome di un ordine non registrato: non lo conto come «da fuori»', {
      chargeId: charge.id, mancaSulDatabase: aNumeri.nuovoCents, daFuori: scelti.cents,
    });
  }
  if (scelti.cents <= 0) return;

  await registraSullOrdine(ordine, scelti.cents, { chargeId: charge.id, rimborsi: scelti.ids });
  await etichettaComeRegistrati(scelti.ids, ordine.id);
}

/**
 * Scrive su UN ordine `parteCents` di un rimborso già uscito da Stripe, con la
 * stessa contabilità di `refundOrder` — importo rimborsato, quota del negozio,
 * stato del pagamento — senza chiedere a Stripe un secondo rimborso.
 *
 * La usano il webhook (pagamento di un ordine solo) e il pannello, quando chi
 * amministra divide un rimborso fatto su un carrello di più negozi: lì
 * `togliLaPausa` toglie la pausa dei bonifici nella STESSA scrittura, così un
 * ordine o è registrato e libero, o è com'era — mai a metà, e mai due volte.
 *
 * Lancia se l'ordine è cambiato da quando è stato letto, o se il giro dei
 * bonifici lo sta pagando proprio adesso: chi chiama riprova sui numeri nuovi.
 */
export async function registraSullOrdine(
  ordine: OrdineDelRimborso,
  parteCents: number,
  opzioni: {
    chargeId: string | null;
    togliLaPausa?: boolean;
    /** I rimborsi Stripe che questa registrazione copre: si scrivono sull'ordine (`rimborsiGiaScritti`). */
    rimborsi?: ReadonlyArray<string>;
  },
): Promise<ContoRimborsoDaFuori> {
  const giaRegistrato = ordine.refunded_amount_cents ?? 0;
  const conto = contoDelRimborsoDaFuori(ordine, giaRegistrato + Math.max(0, parteCents), Math.max(0, parteCents));
  const dove = doveSiRiprendeLaQuota(ordine);

  // Il giro dei bonifici ha preso in mano questo ordine e sta pagando: il conto
  // si fa quando ha finito, altrimenti il bonifico parte col netto intero e la
  // quota tolta qui resterebbe solo sulla carta. Stripe riprova più tardi.
  if (conto.nuovoCents > 0 && dove === 'dopo-il-bonifico-in-corso') {
    throw new Error(`[stripe] rimborso da fuori sull'ordine ${ordine.id}: bonifico in corso, si riprova dopo`);
  }

  const valori: Record<string, unknown> = {};
  if (conto.nuovoCents > 0) {
    valori.refunded_amount_cents = conto.totaleCents;
    valori.payment_status = conto.totaleCents >= conto.lordoCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    if (opzioni.rimborsi && opzioni.rimborsi.length > 0) {
      valori.stripe_refund_id = elencoDaScrivere(rimborsiGiaScritti(ordine), opzioni.rimborsi);
    }
    if (dove === 'dal-bonifico-da-fare') {
      // Bonifico non ancora partito: la quota del negozio si toglie da quello che
      // gli verrà versato (stesso campo e stesso tetto di `refundOrder`).
      const netto = ordine.seller_payout_cents ?? 0;
      valori.seller_payout_reversed_cents = Math.min(
        (ordine.seller_payout_reversed_cents ?? 0) + conto.quotaNegozioCents,
        netto,
      );
    }
  }
  if (opzioni.togliLaPausa) valori.internal_dispute_status = null;
  if (Object.keys(valori).length === 0) return conto;

  // La scrittura passa solo se nessuno ha cambiato l'ordine da quando l'ho
  // letto: né un altro rimborso (stesso importo rimborsato), né il giro dei
  // bonifici (stesso stato del bonifico), né un'altra divisione (la pausa c'è
  // ancora). Se qualcuno l'ha cambiato, si riprova sui numeri nuovi invece di
  // sommare due volte.
  let scrittura = getAdminSupabase()
    .from('orders')
    .update(valori)
    .eq('id', ordine.id)
    .eq('refunded_amount_cents', giaRegistrato);
  scrittura = ordine.payout_status === null
    ? scrittura.is('payout_status', null)
    : scrittura.eq('payout_status', ordine.payout_status);
  if (opzioni.togliLaPausa) scrittura = scrittura.eq('internal_dispute_status', PAUSA_RIMBORSO_DA_DIVIDERE);
  const { data: registrati } = scritturaObbligatoria(
    await scrittura.select('id'),
    'rimborso parziale dal cruscotto registrato sull ordine',
  );
  if (!registrati || registrati.length === 0) {
    throw new Error(`[stripe] rimborso da fuori sull'ordine ${ordine.id}: l'ordine è cambiato nel frattempo, si riprova`);
  }
  if (conto.nuovoCents <= 0) return conto;

  logger.info('[stripe] rimborso parziale dal cruscotto registrato sull ordine', {
    orderId: ordine.id, chargeId: opzioni.chargeId, nuovoCents: conto.nuovoCents, quotaNegozioCents: conto.quotaNegozioCents,
  });
  if (conto.quotaNegozioCents <= 0) return conto;

  if (dove === 'a-mano') {
    // Lo storno precedente non è riuscito e il giro dei bonifici questo ordine
    // non lo paga più: la quota non scende da nessuna parte da sola.
    logger.error('[stripe] quota del negozio da recuperare a mano dopo il rimborso dal cruscotto', {
      orderId: ordine.id, centesimi: conto.quotaNegozioCents,
    });
    await notifyAdmins(
      '⚠️ Quota del negozio da recuperare a mano',
      `Dal cruscotto Stripe è uscito un rimborso di ${formatPriceFromCents(conto.nuovoCents)} sull'ordine ${ordine.id}. ` +
        'Il bonifico al negozio era già partito e uno storno precedente su questo ordine non è riuscito: ' +
        `ai soldi da riprendere al negozio si aggiungono ${formatPriceFromCents(conto.quotaNegozioCents)}. ` +
        "Prima di stornarli a mano, guarda su Stripe (Connect → il bonifico dell'ordine → Storni) quanto è già rientrato.",
      '/admin/orders',
    );
    return conto;
  }
  if (dove !== 'con-uno-storno') return conto;

  // Bonifico già uscito: la quota del negozio si riprende con uno storno. Il
  // rimborso è già registrato qui sopra, quindi se lo storno non riesce non si
  // ritenta da solo: diventa un lavoro dichiarato agli amministratori, come in
  // `refundOrder`.
  try {
    await reverseOrderTransfer(ordine, conto.quotaNegozioCents);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'errore sconosciuto';
    logger.error('[stripe] quota del negozio non ripresa dopo il rimborso dal cruscotto', {
      orderId: ordine.id, centesimi: conto.quotaNegozioCents, err,
    });
    // Un promemoria in una scrittura sua: se il vincolo del database non
    // conosce ancora questo stato (migrazione 130), cade solo il promemoria.
    const { error: errSegno } = await getAdminSupabase()
      .from('orders')
      .update({ payout_status: 'REVERSAL_FAILED', reversal_error: motivo.slice(0, 500) })
      .eq('id', ordine.id);
    if (errSegno) {
      logger.error('[stripe] storno mancato non segnato sull ordine', { orderId: ordine.id, message: errSegno.message });
    }
    // Collaudo del 15/10: «vanno recuperati a mano» e basta faceva rischiare
    // uno storno doppio, perché l'errore può essere una risposta di Stripe
    // persa per strada, con lo storno fatto davvero.
    await notifyAdmins(
      '⚠️ Storno al venditore non riuscito',
      `Dal cruscotto Stripe è uscito un rimborso di ${formatPriceFromCents(conto.nuovoCents)} sull'ordine ${ordine.id}, ` +
        `ma i ${formatPriceFromCents(conto.quotaNegozioCents)} di quota del negozio non risultano rientrati (${motivo}). ` +
        "Prima di recuperarli a mano, guarda su Stripe (Connect → il bonifico dell'ordine → Storni): la risposta di Stripe " +
        "può essersi persa e lo storno può esserci già. Se c'è, non va rifatto: va solo registrato sull'ordine.",
      '/admin/orders',
    );
  }
  return conto;
}

/**
 * Pagamento di più negozi: Stripe non dice a quale ordine appartiene il
 * rimborso. Si fermano i bonifici del carrello non ancora pagati e si
 * avvisano gli amministratori, che dividono il rimborso dal pannello.
 */
async function fermaIBonificiDelCarrello(
  charge: Stripe.Charge,
  ordini: OrdineDelRimborso[],
  rimborsatoSuStripe: number,
): Promise<void> {
  const registrato = ordini.reduce((somma, o) => somma + (o.refunded_amount_cents ?? 0), 0);
  const mancante = rimborsatoSuStripe - registrato;
  // Zero o meno: è l'eco dei nostri rimborsi, ognuno già scritto sul suo ordine.
  if (mancante <= 0) return;
  const daDividere = Math.min(mancante, await rimborsatoDaFuori(charge, mancante));
  if (daDividere <= 0) return;

  const ids = ordini.map((o) => o.id);
  // Solo chi oggi è pagabile: un reclamo interno già aperto resta com'è.
  scritturaObbligatoria(
    await getAdminSupabase()
      .from('orders')
      .update({ internal_dispute_status: PAUSA_RIMBORSO_DA_DIVIDERE })
      .in('id', ids)
      .or('internal_dispute_status.is.null,internal_dispute_status.eq.RESOLVED'),
    'bonifici del carrello fermati per un rimborso da dividere',
  );

  logger.warn('[stripe] rimborso parziale dal cruscotto su un pagamento di più negozi: bonifici fermati', {
    chargeId: charge.id, daDividere, ordini: ids,
  });
  await notifyAdmins(
    '⚠️ Rimborso dal cruscotto da dividere fra i negozi',
    `Dal cruscotto Stripe è uscito un rimborso di ${formatPriceFromCents(daDividere)} su un pagamento che copre ${ordini.length} ordini ` +
      `(${ids.map((i) => i.slice(0, 8)).join(', ')}). Stripe non dice a quale negozio appartiene: i bonifici di questi ordini sono fermi ` +
      'finché il rimborso non viene diviso. Si divide dal pannello, nella pagina Ordini, riquadro «Rimborsi dal cruscotto da dividere»: ' +
      'scrivi la parte di ciascun ordine (anche zero). Il pannello toglie al negozio la sua quota — con uno storno su Stripe ' +
      'se il suo bonifico è già partito — e poi riapre i bonifici.',
    '/admin/orders',
  );
}
