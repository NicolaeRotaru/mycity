import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { veloceNonConfermataTemplate } from '@/lib/email/templates';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { consegnaSenzaLaVeloce } from '@/lib/ordini/prezzi';
import { MINUTI_PER_CONFERMARE_LA_VELOCE, scadenzaAccettazione, scadenzaLeggibile } from '@/lib/ordini/scadenza-accettazione';
import { ETICHETTA_ADESSO, FASCE_DI_DOMANI, FASCE_DI_OGGI, fasceAncoraPossibili } from '@/lib/quando-arriva';
import { negozioPuoServire, romeNow } from '@/lib/store-hours';
import { CAMPI_124, conRipiegoSchema, senzaCampi, senzaColonne } from '@/lib/db/migrazione-124';

/**
 * 30/10/2026 — IL SECONDO FRENO DELLA VELOCE (carta #220, scelta di Nicola delle 16:13: «il
 * secondo propone una fascia senza l'euro se il negozio non conferma entro 10 minuti»).
 *
 * ── Il difetto ──────────────────────────────────────────────────────────────────────────────
 * La veloce promette 30-60 minuti dalla conferma del negozio e costa 1 € in più. Se il negozio non
 * confermava, l'ordine restava «Adesso» per tre ore come tutti e poi si annullava: il cliente
 * aspettava, e la veloce l'aveva pagata. Esempio: alle 18:05 Maria ordina 15 € di pane con la
 * veloce e paga 4 € di consegna; alle 18:16 il forno non ha confermato.
 *
 * ── La regola (scelta ragionata dell'AD sulla carta firmata) ────────────────────────────────
 * Dopo 10 minuti dalla nascita, se un ordine veloce è ancora NEW, la veloce del carrello cade:
 * ① il carrello passa alla prima fascia che la cassa offrirebbe adesso (stessa funzione, stessi
 *   orari dei negozi) e che finisce almeno 60 minuti dopo adesso, SOLO se nessun ordine del
 *   carrello è già partito col fattorino o consegnato (altrimenti decidono gli amministratori);
 *   se gli orari non si leggono o non c'è nessuna fascia, non si sposta niente: il cliente legge
 *   l'ora vera in cui l'ordine si annulla da solo, e gli amministratori lo sanno;
 * ② l'euro della veloce si toglie dalla consegna dell'ordine che lo porta, tranne quando la veloce
 *   era compresa (spesa piccola): lì cambia solo la fascia;
 * ③ il compenso del fattorino resta quello scritto;
 * ④ il cliente lo sa subito, per email e nella campanella, e può annullare senza costi finché il
 *   negozio non conferma (dopo, la rotta di annullo non lo accetta più);
 * ⑤ la scrittura è condizionata su `delivery_status` e su `delivery_slot` = «Adesso»: se il negozio
 *   accetta mentre il freno lavora vince una sola delle due, e un secondo giro non trova niente.
 * Maria: alle 18:16 passa a «Stasera · 18:00–20:00» e alla porta paga 18 € invece di 19.
 * Poi la scadenza delle tre ore (scadenza-accettazione.ts) si conta sulla fascia nuova.
 *
 * ⚠️ Con la CARTA il conto scritto sull'ordine non si tocca qui: 1 € torna con un rimborso
 * parziale chiesto a `refundOrder` (lib/stripe/payout.ts, il libro dei rimborsi) PRIMA di scrivere
 * la fascia, così un giro che muore a metà non perde l'euro (il giro dopo lo richiede con la stessa
 * chiave). Se non parte, o torna meno di 1 €, il
 * cliente legge «te lo rendiamo a mano entro un giorno» e gli amministratori lo sanno. Al lancio
 * la carta è spenta. I negozi che avevano accettato e il fattorino assegnato ricevono la fascia nuova.
 */

const COLONNE =
  'id, user_id, seller_id, delivery_status, delivery_slot, pickup_in_store, payment_method, payment_status, ' +
  'total_price, gross_total_cents, wallet_applied_cents, shipping_cost, delivery_fee_cents, rider_fee_cents, ' +
  'discount_amount, stripe_session_id, rider_id, created_at, refunded_amount_cents, stripe_refund_id';
/**
 * Prima della migrazione 124 `gross_total_cents` non esiste: chiederla faceva fallire OGNI lettura
 * del freno, e nessuna veloce veniva mai spostata mentre l'email al negozio lo prometteva. Senza
 * la colonna il lordo si ricostruisce da `total_price` + credito (`lordoDi`), come in annulla.ts.
 */
const COLONNE_PRIMA_DELLA_124 = senzaColonne(COLONNE, CAMPI_124);
type Risposta = { data: unknown; error: { message: string; code?: string } | null };
const leggi = (dove: string, q: (colonne: string) => PromiseLike<Risposta>) =>
  conRipiegoSchema<Risposta>(`veloce-non-confermata.${dove}`, () => q(COLONNE), () => q(COLONNE_PRIMA_DELLA_124));

/** Gli stati di un ordine che il fattorino non ha ancora portato via dal negozio. */
const NON_ANCORA_PARTITI = ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED'];
/** Gli stati di un ordine uscito dal carrello prima della consegna: non pesano sulla decisione. */
const FUORI_DAL_GIRO = ['CANCELED', 'REJECTED'];

type RigaVeloce = {
  id: string;
  user_id: string | null;
  seller_id: string | null;
  delivery_status: string | null;
  delivery_slot: string | null;
  pickup_in_store: boolean | null;
  payment_method: string | null;
  payment_status: string | null;
  total_price: number | string | null;
  gross_total_cents: number | null;
  wallet_applied_cents: number | null;
  shipping_cost: number | string | null;
  delivery_fee_cents: number | null;
  rider_fee_cents: number | null;
  discount_amount: number | string | null;
  stripe_session_id: string | null;
  rider_id?: string | null;
  created_at: string | null;
  refunded_amount_cents?: number | null;
  stripe_refund_id?: string | null;
};

const centesimi = (x: unknown) => Math.round(Number(x ?? 0) * 100);
const lordoDi = (r: RigaVeloce) =>
  typeof r.gross_total_cents === 'number' ? r.gross_total_cents : centesimi(r.total_price) + Number(r.wallet_applied_cents ?? 0);

/**
 * Quanto deve restare, almeno, di una fascia di oggi per proporla al posto della veloce: un'ora,
 * il tempo che la veloce stessa si prende dopo la conferma. Collaudo del 30/10: alle 17:50 il
 * freno metteva «15:00–18:00», cioè 10 minuti per un ordine che il negozio non ha ancora confermato.
 */
export const MINUTI_MINIMI_DI_FASCIA = 60;

/**
 * La prima fascia che la cassa offrirebbe adesso a questo carrello: le stesse funzioni della cassa
 * (`fasceAncoraPossibili` per oggi, `FASCE_DI_DOMANI`, `negozioPuoServire` sugli orari di ogni
 * negozio), tenendo di oggi solo quelle che finiscono almeno `MINUTI_MINIMI_DI_FASCIA` dopo adesso.
 * `null` se non ce n'è nessuna: sabato sera col negozio chiuso la domenica non esiste un'etichetta
 * vera da scrivere, e «Domani · 9:00–12:00» sarebbe una promessa che il negozio non può mantenere.
 */
export function fasciaDopoLaVeloce(oraDiPiacenza: Date, orari: unknown[]): string | null {
  const tutti = (f: string) => orari.every((h) => negozioPuoServire(h, f, oraDiPiacenza));
  const adesso = oraDiPiacenza.getHours() * 60 + oraDiPiacenza.getMinutes();
  const fine = new Map(FASCE_DI_OGGI.map((f) => [f.etichetta, f.oraDiFine * 60]));
  const oggi = fasceAncoraPossibili(oraDiPiacenza.getHours())
    .filter((f) => (fine.get(f) ?? 0) - adesso >= MINUTI_MINIMI_DI_FASCIA);
  return oggi.find(tutti) ?? FASCE_DI_DOMANI.find(tutti) ?? null;
}

const TITOLO_NON_SPOSTATO = 'Il negozio non ha ancora confermato la consegna veloce';

/**
 * La frase per il cliente quando il freno non può spostare il carrello (orari non letti, nessuna
 * fascia oggi o domani). Dice il vero: quando l'ordine si annulla da solo, senza promettere un
 * contatto che nessuno ha in agenda. L'ora è quella del giro notturno (`scadenzaAccettazione`).
 */
export function fraseNonSpostato(scadenza: Date, adesso: Date, carta = false): string {
  const quando = scadenzaLeggibile(scadenza, adesso);
  const soldi = carta ? 'ti rendiamo tutto quello che hai pagato' : 'non paghi niente';
  return `Il negozio non ha ancora confermato. Se non conferma entro ${quando}, l’ordine si annulla e ${soldi}.`;
}

export type ComeVaLEuro = 'tolto-contanti' | 'tolto-carta' | 'compresa' | 'a-mano';

/** La frase per il cliente: la stessa nella campanella e nell'email. «Non lo paghi» solo se è tolto davvero. */
export function fraseDelFreno(a: { fascia: string; euro: ComeVaLEuro; totaleCents: number; sulCreditoCents?: number }): string {
  const inizio = `Il negozio non ha confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti: la tua spesa arriva nella fascia ${a.fascia}`;
  // Il limite è quello della rotta di annullo (app/api/orders/[id]/cancel): il cliente annulla solo
  // un ordine NEW. Prima la frase lo prometteva senza condizioni: alle 12:58 il forno accettava la
  // fascia nuova e alle 13:10 il tasto Annulla non c'era più, mentre la campanella diceva di sì.
  const fine = 'Se non ti va bene, puoi annullarlo senza costi dalla sua pagina finché il negozio non lo conferma.';
  if (a.euro === 'compresa') return `${inizio}. La consegna veloce era già compresa nel prezzo, quindi il totale non cambia. ${fine}`;
  if (a.euro === 'tolto-contanti') {
    // L'euro pagato col credito MyCity torna sul credito: alla porta non si toglie quello che non c'era.
    const credito = a.sulCreditoCents ?? 0;
    if (credito > 0) {
      const porta = a.totaleCents > 0 ? `alla porta paghi ${formatPriceFromCents(a.totaleCents)}` : 'alla porta non paghi niente';
      return `${inizio} e l’euro della veloce non lo paghi: ${formatPriceFromCents(credito)} ti torna sul credito MyCity e ${porta}. ${fine}`;
    }
    return `${inizio} e l’euro della veloce non lo paghi: alla porta paghi ${formatPriceFromCents(a.totaleCents)}. ${fine}`;
  }
  if (a.euro === 'tolto-carta') return `${inizio} e l’euro della veloce non lo paghi: ti torna sulla carta. ${fine}`;
  return `${inizio}. L’euro della veloce te lo rendiamo a mano entro un giorno. ${fine}`;
}

async function ordiniDelCarrello(admin: SupabaseClient, o: RigaVeloce): Promise<RigaVeloce[] | null> {
  let righe: RigaVeloce[] | null = null;
  const sessione = o.stripe_session_id?.trim();
  if (sessione) {
    const { data, error } = await leggi('sessione', (c) => admin.from('orders').select(c).eq('stripe_session_id', sessione));
    if (error || !Array.isArray(data)) return null;
    righe = data as unknown as RigaVeloce[];
  } else {
    const { data: tentativi, error: errT } = await admin
      .from('cod_checkout_attempts')
      .select('order_ids')
      .eq('user_id', o.user_id)
      .contains('order_ids', JSON.stringify([{ id: o.id }]))
      .limit(1);
    if (errT || !Array.isArray(tentativi) || tentativi.length === 0) return null;
    const elenco = (tentativi[0] as { order_ids: unknown }).order_ids;
    const ids = Array.isArray(elenco)
      ? elenco.map((x) => (x && typeof x === 'object' ? String((x as { id?: unknown }).id ?? '') : String(x))).filter(Boolean)
      : [];
    if (ids.length < 2) return null;
    const { data, error } = await leggi('carrello', (c) => admin.from('orders').select(c).in('id', ids));
    if (error || !Array.isArray(data)) return null;
    righe = data as unknown as RigaVeloce[];
  }
  if (!righe.some((r) => r.id === o.id)) return null;
  return righe.sort((x, y) => String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')) || x.id.localeCompare(y.id));
}

async function avvisaIlCliente(admin: SupabaseClient, o: RigaVeloce, frase: string, nonSpostato = false): Promise<void> {
  if (!o.user_id) return;
  const { error } = await admin.from('notifications').insert({
    category: 'order',
    user_id: o.user_id,
    title: nonSpostato ? TITOLO_NON_SPOSTATO : 'La consegna veloce non è partita',
    body: frase,
    link: `/orders/${o.id}`,
  });
  if (error) {
    logger.error('[veloce-non-confermata] campanella al cliente NON scritta', { orderId: o.id, message: error.message });
    // Quando il carrello non si sposta, la campanella è l'unico segno che al cliente se n'è già parlato
    // (nonSiSposta la rilegge a ogni giro). Senza, l'email ripartiva ogni 5 minuti fino all'annullo.
    // Si aspetta il giro in cui la campanella si scrive: l'email parte una volta sola. Gli
    // amministratori lo sanno già, nonSiSposta li avvisa prima, una volta per ordine.
    if (nonSpostato) return;
  }
  try {
    const { data, error: errU } = await admin.auth.admin.getUserById(o.user_id);
    const email = data?.user?.email;
    if (errU || !email) {
      logger.error('[veloce-non-confermata] email al cliente non spedita: indirizzo non letto', { orderId: o.id });
      return;
    }
    const t = veloceNonConfermataTemplate({ orderId: o.id, frase, senzaFascia: nonSpostato });
    const res = await sendEmail({
      to: email,
      subject: t.subject,
      html: t.html,
      text: t.text,
      tipo: 'transazionale',
      tags: [{ name: 'template', value: 'veloce_non_confermata' }],
    });
    if (!res.ok) logger.error('[veloce-non-confermata] email al cliente NON partita', { orderId: o.id });
  } catch (err) {
    logger.error('[veloce-non-confermata] email al cliente NON partita', { orderId: o.id, err });
  }
}

type EsitoDelCarrello = 'spostato' | 'accettato' | 'a-mano';

const codiceDi = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

/**
 * Il freno non può spostare il carrello: gli orari dei negozi non si leggono, oppure né oggi né
 * domani c'è una fascia servibile. L'ordine resta com'è, col suo conto; il cliente legge l'ora vera
 * in cui si annulla da solo, gli amministratori lo sanno. Una volta sola: l'avviso già scritto nella
 * campanella è il segno che se n'è già parlato. Il giro dopo riprova comunque a trovare la fascia.
 */
async function nonSiSposta(admin: SupabaseClient, o: RigaVeloce, adesso: Date, perche: string): Promise<EsitoDelCarrello> {
  const { data: gia, error } = await admin
    .from('notifications')
    .select('id')
    .eq('link', `/orders/${o.id}`)
    .eq('title', TITOLO_NON_SPOSTATO)
    .limit(1);
  if (error) throw new Error(`ordine ${o.id}: avvisi già spediti non letti: ${error.message}`);
  if (Array.isArray(gia) && gia.length > 0) return 'a-mano';
  const scadenza = scadenzaAccettazione(o) ?? new Date(adesso.getTime() + 3 * 3_600_000);
  await notifyAdmins(
    '⚠️ Veloce non confermata: il carrello non si è potuto spostare',
    `L'ordine ${codiceDi(o.id)} non è stato confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti e il freno non l'ha spostato: ${perche}. È rimasto com'era, con la veloce nel conto, e si annulla da solo alle ${scadenzaLeggibile(scadenza, adesso).replace(/^le /, '')}: senti il negozio, e se serve scegli tu la fascia col cliente.`,
    '/admin/orders',
    { unaVoltaPer: `veloce-ferma-${o.id}` },
  ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
  await avvisaIlCliente(admin, o, fraseNonSpostato(scadenza, adesso, o.payment_method !== 'cod'), true);
  logger.warn('[veloce-non-confermata] carrello non spostato', { orderId: o.id, perche });
  return 'a-mano';
}

/** Avvisa i negozi che avevano già accettato e il fattorino assegnato: la fascia è cambiata. */
async function avvisaNegoziEFattorino(admin: SupabaseClient, o: RigaVeloce, spostati: RigaVeloce[], fascia: string): Promise<void> {
  const righe: Record<string, unknown>[] = [];
  for (const c of spostati) {
    if (c.id === o.id || !c.seller_id) continue;
    righe.push({
      category: 'order',
      user_id: c.seller_id,
      title: 'Il carrello ha cambiato fascia',
      body: `L'ordine ${codiceDi(c.id)} non è più una consegna veloce: un altro negozio dello stesso carrello non l'ha confermata. Va consegnato nella fascia ${fascia}.`,
      link: `/seller/orders/${c.id}`,
    });
  }
  const fattorini = [...new Set(spostati.map((c) => c.rider_id).filter((x): x is string => !!x))];
  for (const r of fattorini) {
    const suoi = spostati.filter((c) => c.rider_id === r).map((c) => codiceDi(c.id)).join(', ');
    righe.push({
      category: 'order',
      user_id: r,
      title: 'Consegna spostata in una fascia',
      body: `${suoi}: non è più una consegna veloce. Va consegnato nella fascia ${fascia}.`,
      link: '/rider',
    });
  }
  if (righe.length === 0) return;
  const { error } = await admin.from('notifications').insert(righe);
  if (error) logger.error('[veloce-non-confermata] avviso a negozi/fattorino NON scritto', { orderId: o.id, message: error.message });
}

/**
 * ⑨ L'euro della veloce pagato col credito MyCity torna sul credito. Prima si toglieva dai contanti
 * con `max(0, …)`: su una spesa pagata tutta col credito l'euro spariva (lordo 18 €, credito speso
 * 19 €) e il cliente leggeva «alla porta paghi -1,00 €». Una volta sola anche se il giro si ripete:
 * la coppia (`cod_refund`, `veloce_non_confermata_<id>`) è unica nel diario del credito (migrazioni
 * 098 e 143), e 23505 vuol dire che un giro di prima l'ha già accreditata.
 */
async function rendiSulCredito(admin: SupabaseClient, c: RigaVeloce, cents: number): Promise<boolean> {
  if (!c.user_id) return false;
  try {
    const { error } = await admin.rpc('wallet_credit', {
      p_user: c.user_id,
      p_cents: cents,
      p_reason: 'cod_refund',
      p_ref: `veloce_non_confermata_${c.id}`,
    });
    if (!error || (error as { code?: string }).code === '23505') return true;
    logger.error('[veloce-non-confermata] euro della veloce NON tornato sul credito', { orderId: c.id, message: error.message });
  } catch (err) {
    logger.error('[veloce-non-confermata] euro della veloce NON tornato sul credito', { orderId: c.id, err });
  }
  return false;
}

/**
 * `fatto`: quello che il giro ha già fatto sul carrello e non si disfa (l'euro reso sulla carta o sul
 * credito, un ordine già spostato). Se dopo una scrittura cade, il giro lo legge agli amministratori.
 * Le frasi dipendono dallo stato, non dal giro: lo stesso stato dà lo stesso avviso, una volta sola.
 */
async function spostaIlCarrello(
  admin: SupabaseClient, o: RigaVeloce, carrello: RigaVeloce[], adesso: Date, fatto: string[] = [],
): Promise<EsitoDelCarrello> {
  const vivi = carrello.filter((c) => !FUORI_DAL_GIRO.includes(String(c.delivery_status)));
  // ② Un ordine del carrello già partito col fattorino (o consegnato): spostare il resto spezzerebbe
  // il giro e l'euro della veloce starebbe su un conto che non si può più riscrivere. Non si tocca
  // niente, il cliente non riceve una promessa a metà, e decide una persona.
  const partiti = vivi.filter((c) => !NON_ANCORA_PARTITI.includes(String(c.delivery_status)));
  if (partiti.length > 0) {
    const tutti = vivi.map((c) => `${codiceDi(c.id)} (${c.delivery_status})`).join(', ');
    await notifyAdmins(
      '⚠️ Veloce non confermata con un ordine già partito',
      `L'ordine ${codiceDi(o.id)} non è stato confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti, ma nello stesso carrello ${partiti.map((c) => codiceDi(c.id)).join(', ')} è già partito col fattorino. Il freno non ha spostato niente e non ha scritto al cliente. Carrello: ${tutti}. Da fare: senti il negozio di ${codiceDi(o.id)}; se non conferma, annullalo o mettilo in una fascia col cliente, e se la veloce cade togli l'euro della veloce dal conto.`,
      '/admin/orders',
      { unaVoltaPer: `veloce-partita-${o.id}` },
    ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
    logger.warn('[veloce-non-confermata] carrello con un ordine già partito: non spostato', { orderId: o.id });
    return 'a-mano';
  }

  const altri = vivi.filter((c) => c.id !== o.id && c.delivery_slot === ETICHETTA_ADESSO && !c.pickup_in_store);
  // Prima l'ordine che il negozio non ha confermato: se nel frattempo l'ha accettato, non si tocca niente.
  const daSpostare = [o, ...altri];

  const venditori = [...new Set(daSpostare.map((c) => c.seller_id).filter((x): x is string => !!x))];
  let orari: unknown[] = [];
  if (venditori.length > 0) {
    const { data: negozi, error } = await admin.from('profiles').select('id, store_hours').in('id', venditori);
    const letti = Array.isArray(negozi) ? (negozi as Array<{ id: string; store_hours: unknown }>) : [];
    // ③ Senza gli orari di TUTTI i negozi non si sceglie nessuna fascia: con `orari = []` ogni
    // fascia sembrava buona (every() su una lista vuota è vero).
    if (error || venditori.some((v) => !letti.some((n) => n.id === v))) {
      logger.error('[veloce-non-confermata] orari dei negozi non letti', { orderId: o.id, message: error?.message });
      return nonSiSposta(admin, o, adesso, 'gli orari dei negozi non si sono potuti leggere');
    }
    orari = venditori.map((v) => letti.find((n) => n.id === v)?.store_hours ?? null);
  }
  const fascia = fasciaDopoLaVeloce(romeNow(adesso), orari);
  if (!fascia) return nonSiSposta(admin, o, adesso, 'né oggi né domani c’è una fascia in cui tutti i negozi del carrello siano aperti');

  const conto = consegnaSenzaLaVeloce(carrello.map((r) => {
    const consegna = Number(r.delivery_fee_cents ?? 0);
    const spedizione = centesimi(r.shipping_cost);
    const merce = lordoDi(r) - consegna - spedizione;
    return {
      id: r.id,
      spesaCents: merce + centesimi(r.discount_amount),
      merceCents: merce,
      shippingCents: spedizione,
      deliveryFeeCents: consegna,
      riderFeeCents: Number(r.rider_fee_cents ?? 0),
      giaAnnullato: FUORI_DAL_GIRO.includes(String(r.delivery_status)),
    };
  }));
  const carta = carrello.some((c) => c.payment_method !== 'cod');
  const euro: ComeVaLEuro = !conto ? 'a-mano' : conto.toltaCents === 0 ? 'compresa' : carta ? 'tolto-carta' : 'tolto-contanti';

  // ⑥ Con la carta il rimborso parte PRIMA di scrivere la fascia. Al contrario, un giro che moriva fra
  // le due (la funzione che scade dentro la chiamata a Stripe) lasciava l'ordine in fascia senza
  // l'euro reso: il giro dopo cerca solo le «Adesso» e non lo ritrovava più, e non lo sapeva nessuno.
  // Così il giro dopo ritrova l'ordine ancora «Adesso» e richiede lo stesso rimborso: la chiave
  // `veloce_non_confermata_<id>` fa sì che Stripe lo esegua una volta sola.
  // ⑦ Il rimborso è fatto solo se `refundOrder` dice di aver reso tutto l'euro (`importoCents`).
  const conLEuro = (conto?.righe ?? []).filter((r) => r.deltaCents !== 0);
  const rimborsoNonFatto: typeof conLEuro = [];
  let resiCents = 0;
  if (euro === 'tolto-carta') {
    const { refundOrder } = await import('@/lib/stripe/payout');
    for (const r of conLEuro) {
      // ⑧ Un giro di prima ha già reso l'euro e poi è morto, o la fascia non si è scritta: l'ordine è
      // ancora «Adesso». Richiamare `refundOrder` con la stessa chiave non rifà il rimborso su Stripe,
      // ma `accumula_rimborso` non ha chiave e lo prenotava di nuovo: il libro diceva 2 €, ne era
      // uscito 1, e all'annullo il cliente ne riaveva 1 in meno. Già reso = esattamente l'euro e il
      // rimborso nell'elenco dell'ordine (si scrive a Stripe riuscito). Ogni altro rimborso già sopra
      // non si sa di chi è: non se ne prenota un altro, e lo guarda una persona.
      const lui = carrello.find((c) => c.id === r.id);
      const giaResi = Number(lui?.refunded_amount_cents ?? 0);
      if (giaResi > 0) {
        if (giaResi === -r.deltaCents && String(lui?.stripe_refund_id ?? '').trim() !== '') {
          resiCents += giaResi;
          fatto.push(`${formatPriceFromCents(giaResi)} già reso sulla carta per l’ordine ${codiceDi(r.id)}`);
          continue;
        }
        logger.error('[veloce-non-confermata] sull ordine c è già un rimborso che non è l euro della veloce: non se ne prenota un altro', {
          orderId: r.id, giaResi, chiesti: -r.deltaCents,
        });
        // Stessa frase del giro che l'ha reso: se poi una scrittura cade, l'avviso non si ripete.
        fatto.push(`${formatPriceFromCents(giaResi)} già reso sulla carta per l’ordine ${codiceDi(r.id)}`);
        rimborsoNonFatto.push(r);
        continue;
      }
      try {
        const esito = await refundOrder({
          orderId: r.id,
          amountCents: -r.deltaCents,
          // L'euro della veloce è di MyCity (lib/constants.ts): dal negozio non si toglie niente.
          quotaNegozioCents: 0,
          reason: 'consegna veloce non confermata dal negozio in 10 minuti',
          idempotencyKey: `veloce_non_confermata_${r.id}`,
          notifyBuyer: false,
          metadata: { motivo: 'veloce_non_confermata' },
        });
        const reso = Number(esito?.importoCents ?? 0);
        resiCents += Number.isFinite(reso) && reso > 0 ? reso : 0;
        if (Number.isFinite(reso) && reso > 0) fatto.push(`${formatPriceFromCents(reso)} già reso sulla carta per l’ordine ${codiceDi(r.id)}`);
        if (!(reso >= -r.deltaCents)) {
          logger.error('[veloce-non-confermata] rimborso dell euro della veloce partito solo in parte', {
            orderId: r.id, chiesti: -r.deltaCents, resi: reso,
          });
          rimborsoNonFatto.push(r);
        }
      } catch (err) {
        logger.error('[veloce-non-confermata] rimborso dell euro della veloce NON partito', { orderId: r.id, err });
        rimborsoNonFatto.push(r);
      }
    }
  }

  let aMeta = false;
  const deltaScritti = new Map<string, number>();
  const contantiScritti = new Map<string, number>();
  const accreditati = new Set<string>();
  let creditoResoCents = 0;
  let sulCreditoCents = 0;
  const scritti: RigaVeloce[] = [];
  for (const [i, c] of daSpostare.entries()) {
    const riga = euro === 'tolto-contanti' ? conto?.righe.find((r) => r.id === c.id) : undefined;
    let delta = riga?.deltaCents ?? 0;
    const valori: Record<string, unknown> = { delivery_slot: fascia };
    // La parte dell'euro che i contanti non coprono è stata pagata col credito: torna lì (⑨).
    const cassa = Math.max(0, centesimi(c.total_price));
    const dalCredito = Math.max(0, -delta - cassa);
    if (dalCredito > 0 && !(await rendiSulCredito(admin, c, dalCredito))) delta = 0;
    if (dalCredito > 0 && delta !== 0) {
      fatto.push(`${formatPriceFromCents(dalCredito)} già tornato sul credito MyCity per l’ordine ${codiceDi(c.id)}`);
      accreditati.add(c.id);
      creditoResoCents += dalCredito;
      valori.wallet_applied_cents = Number(c.wallet_applied_cents ?? 0) - dalCredito;
    }
    if (riga && delta !== 0) {
      valori.delivery_fee_cents = riga.deliveryFeeCents;
      valori.gross_total_cents = lordoDi(c) + delta;
      valori.total_price = Math.max(0, cassa + delta + dalCredito) / 100;
    }
    const scrivi = (v: Record<string, unknown>) => {
      let q = admin
        .from('orders')
        .update(v)
        .eq('id', c.id)
        .eq('delivery_slot', ETICHETTA_ADESSO)
        .eq('delivery_status', String(c.delivery_status));
      if (c.delivery_fee_cents != null) q = q.eq('delivery_fee_cents', Number(c.delivery_fee_cents));
      return q.select('id') as unknown as PromiseLike<Risposta>;
    };
    // Prima della 124 il lordo non si scrive (la colonna non c'è): fascia, consegna e totale sì.
    const { data: righeScritte, error } = await conRipiegoSchema<Risposta>(
      'veloce-non-confermata.sposta', () => scrivi(valori), () => scrivi(senzaCampi(valori, CAMPI_124)));
    if (error) throw new Error(`ordine ${c.id}: ${error.message}`);
    if (!Array.isArray(righeScritte) || righeScritte.length === 0) {
      // Il primo è l'ordine non confermato: se non si scrive, il negozio l'ha accettato adesso
      // (o un altro giro l'ha già spostato). Vince lui, e non si avvisa nessuno.
      if (i === 0) {
        // Con la carta l'euro è già tornato: se l'ordine è ancora «Adesso» l'ha confermato il negozio
        // in quell'istante e la veloce resta. Al cliente va bene, ma il conto va saputo. Se invece l'ha
        // già spostato un altro giro, era lo stesso rimborso (stessa chiave) e non c'è niente da dire.
        if (resiCents + creditoResoCents > 0) {
          // «Zero righe scritte» ha tre cause: il negozio ha accettato, il cliente ha annullato (o il
          // negozio ha rifiutato), oppure un altro negozio del carrello ha cambiato la consegna. Si
          // rilegge anche lo stato: prima si guardava solo la fascia, e a un ordine annullato mentre
          // l'euro tornava sulla carta gli amministratori leggevano «il negozio ha confermato».
          const reso = formatPriceFromCents(resiCents + creditoResoCents);
          const { data: ora, error: errOra } = await admin
            .from('orders').select('delivery_slot, delivery_status').eq('id', c.id).maybeSingle();
          const vero = ora as { delivery_slot?: string | null; delivery_status?: string | null } | null;
          const stato = String(vero?.delivery_status ?? '');
          if (errOra || !vero) {
            await notifyAdmins(
              '⚠️ Veloce: euro reso e ordine non riletto',
              `Mentre il freno della veloce rendeva al cliente ${reso} (sulla carta o sul credito MyCity), l'ordine ${codiceDi(o.id)} è cambiato e non si è potuto rileggere${errOra ? ` (${errOra.message})` : ''}. Guarda tu com'è adesso: se è annullato, controlla che al cliente sia tornato in tutto quello che ha pagato, non di più; se è confermato, la veloce resta e l'euro è già reso.`,
              '/admin/orders',
              { unaVoltaPer: `veloce-resa-non-riletto-${o.id}` },
            ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
            return 'a-mano';
          }
          if (FUORI_DAL_GIRO.includes(stato)) {
            await notifyAdmins(
              stato === 'CANCELED' ? '⚠️ Ordine annullato mentre il freno rendeva l’euro' : '⚠️ Ordine rifiutato mentre il freno rendeva l’euro',
              `L'ordine ${codiceDi(o.id)} risulta ${stato === 'CANCELED' ? 'annullato' : 'rifiutato dal negozio'} (stato riletto adesso: ${stato}) mentre il freno della veloce rendeva al cliente ${reso} (sulla carta o sul credito MyCity). Il negozio non l'ha confermato e la fascia non è cambiata. Controlla che in tutto al cliente sia tornato quello che ha pagato, non di più e non di meno: l'euro della veloce è già fra quello che gli è tornato.`,
              '/admin/orders',
              { unaVoltaPer: `veloce-resa-annullato-${o.id}` },
            ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
            return 'a-mano';
          }
          // Ancora «Adesso» e non più NEW: l'ha confermato il negozio in quell'istante e la veloce resta.
          // Ancora «Adesso» e NEW: è cambiata la consegna, e il giro dopo riprova con la stessa chiave.
          if (vero.delivery_slot === ETICHETTA_ADESSO && stato !== 'NEW') {
            await notifyAdmins(
              '⚠️ Veloce confermata dopo il rimborso dell’euro',
              `Il negozio ha confermato l'ordine ${codiceDi(o.id)} mentre il freno della veloce rendeva al cliente ${reso} (sulla carta o sul credito MyCity). La veloce resta e il cliente ha già avuto indietro l'euro: non serve fare niente, ma la consegna di questo carrello è costata al cliente 1 € in meno di quello scritto.`,
              '/admin/orders',
              { unaVoltaPer: `veloce-resa-${o.id}` },
            ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
          }
        }
        return 'accettato';
      }
      aMeta = true;
      continue;
    }
    fatto.push(`ordine ${codiceDi(c.id)} già passato alla fascia ${fascia}`);
    deltaScritti.set(c.id, delta);
    if (delta !== 0) {
      contantiScritti.set(c.id, delta + dalCredito);
      if (dalCredito > 0) sulCreditoCents += dalCredito;
    }
    scritti.push(c);
  }

  const totaleCents = carrello
    .filter((c) => !FUORI_DAL_GIRO.includes(String(c.delivery_status)))
    .reduce((s, c) => s + Math.max(0, centesimi(c.total_price) + (contantiScritti.get(c.id) ?? 0)), 0);

  // ④ L'euro è tolto davvero solo se OGNI ordine che lo portava è stato riscritto (contanti) o il
  // rimborso parziale è tornato per intero (carta, sopra). Altrimenti il cliente non legge «non lo paghi».
  let rimasti: typeof conLEuro = [];
  if (euro === 'tolto-contanti') rimasti = conLEuro.filter((r) => deltaScritti.get(r.id) !== r.deltaCents);
  if (euro === 'tolto-carta') rimasti = rimborsoNonFatto;
  const euroFinale: ComeVaLEuro = rimasti.length > 0 ? 'a-mano' : euro;

  const daFare: string[] = [];
  if (rimasti.length > 0) {
    const codici = rimasti.map((r) => codiceDi(r.id)).join(', ');
    daFare.push(carta
      ? `Il rimborso automatico di 1 € sull’ordine ${codici} non è tornato per intero, o sull’ordine c’era già un altro rimborso: guarda su Stripe se l’euro è già uscito e, se no, rendilo a mano al cliente entro un giorno.`
      : `L’euro della veloce sta sull’ordine ${codici}, cambiato nel frattempo o pagato col credito MyCity che non si è potuto riaccreditare, e non si è potuto togliere: rendilo a mano al cliente entro un giorno.${rimasti.some((r) => accreditati.has(r.id)) ? ' Su questo ordine l’euro è già tornato sul credito MyCity: non va reso di nuovo.' : ''}`);
  } else if (euroFinale === 'a-mano') {
    daFare.push('Il conto della consegna non è quello della regola: rendi a mano al cliente l’euro della veloce entro un giorno, se c’era.');
  }
  if (aMeta) daFare.push('Un altro ordine dello stesso carrello è cambiato nel frattempo ed è rimasto sulla veloce: mettilo nella stessa fascia.');
  if (daFare.length > 0) {
    await notifyAdmins(
      '⚠️ Veloce non confermata da sistemare',
      `L'ordine ${codiceDi(o.id)} non è stato confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti ed è passato alla fascia ${fascia}. ${daFare.join(' ')}`,
      '/admin/orders',
    ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
  }

  await avvisaNegoziEFattorino(admin, o, scritti, fascia);
  await avvisaIlCliente(admin, o, fraseDelFreno({ fascia, euro: euroFinale, totaleCents, sulCreditoCents }));
  logger.info('[veloce-non-confermata] carrello passato in fascia', { orderId: o.id, fascia, euro: euroFinale, ordini: deltaScritti.size });
  return aMeta || euroFinale === 'a-mano' ? 'a-mano' : 'spostato';
}

export type EsitoDelFreno =
  /** `guasti`: carrelli in cui una scrittura è caduta a metà (sono anche fra quelli da sistemare a mano). */
  | { ok: true; spostati: number; accettatiNelFrattempo: number; daSistemareAMano: number; guasti: number }
  | { ok: false; error: string };

/** Il giro del freno: lo chiama app/api/cron/veloce-non-confermata ogni cinque minuti. */
export async function frenoDellaVeloce(admin: SupabaseClient, adesso: Date = new Date()): Promise<EsitoDelFreno> {
  const soglia = new Date(adesso.getTime() - MINUTI_PER_CONFERMARE_LA_VELOCE * 60_000).toISOString();
  const { data, error } = await leggi('ricerca', (c) =>
    admin
      .from('orders')
      .select(c)
      .eq('delivery_status', 'NEW')
      .eq('delivery_slot', ETICHETTA_ADESSO)
      .lt('created_at', soglia)
      .limit(100));
  if (error) {
    logger.error('[veloce-non-confermata] ricerca fallita', { message: error.message });
    return { ok: false, error: error.message };
  }

  let spostati = 0;
  let accettatiNelFrattempo = 0;
  let daSistemareAMano = 0;
  let guasti = 0;
  const visti = new Set<string>();
  for (const o of (data ?? []) as unknown as RigaVeloce[]) {
    if (visti.has(o.id) || o.pickup_in_store) continue;
    const fatto: string[] = [];
    try {
      const carrello = (await ordiniDelCarrello(admin, o)) ?? [o];
      for (const c of carrello) visti.add(c.id);
      const lui = carrello.find((c) => c.id === o.id) ?? o;
      const esito = await spostaIlCarrello(admin, lui, carrello, adesso, fatto);
      if (esito === 'spostato') spostati++;
      else if (esito === 'accettato') accettatiNelFrattempo++;
      else daSistemareAMano++;
    } catch (err) {
      // Una scrittura è caduta a metà. Prima il carrello si contava «da sistemare a mano» e la cosa
      // restava nei log: con la carta l'euro era già tornato, l'ordine restava «Adesso» e nessuna
      // persona lo sapeva (tre giri di fila, zero avvisi). Adesso gli amministratori leggono cosa è già
      // fatto e cosa resta; la chiave dipende da quello che è fatto, così lo stesso guasto ogni 5 minuti
      // arriva una volta, e se il giro dopo fa un passo in più arriva l'avviso aggiornato.
      guasti++;
      daSistemareAMano++;
      const perche = err instanceof Error ? err.message : String(err);
      logger.error('[veloce-non-confermata] carrello NON spostato', { orderId: o.id, err, fatto });
      await notifyAdmins(
        '⚠️ Freno della veloce fermo a metà',
        `Il freno della veloce non è riuscito a finire il carrello dell'ordine ${codiceDi(o.id)}: ${perche}. ` +
          `Già fatto: ${fatto.length > 0 ? fatto.join('; ') : 'niente'}. ` +
          'Il freno riprova da solo ogni 5 minuti e non rende due volte quello che è già reso. Se l’ordine resta «Adesso», ' +
          'senti il negozio e mettilo tu in una fascia col cliente, avvisandolo.',
        '/admin/orders',
        { unaVoltaPer: `veloce-guasto-${o.id}:${fatto.join('|') || 'niente'}` },
      ).catch((e) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err: e }));
    }
  }
  return { ok: true, spostati, accettatiNelFrattempo, daSistemareAMano, guasti };
}
