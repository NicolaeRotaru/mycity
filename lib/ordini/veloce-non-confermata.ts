import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { veloceNonConfermataTemplate } from '@/lib/email/templates';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { consegnaSenzaLaVeloce } from '@/lib/ordini/prezzi';
import { MINUTI_PER_CONFERMARE_LA_VELOCE } from '@/lib/ordini/scadenza-accettazione';
import { EXPRESS_ETA_MAX } from '@/lib/delivery';
import { ETICHETTA_ADESSO, FASCE_DI_DOMANI, FASCE_DI_OGGI } from '@/lib/quando-arriva';
import { negozioPuoServire, romeNow } from '@/lib/store-hours';

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
 * ① tutti gli ordini del carrello non ancora partiti col fattorino passano alla stessa fascia,
 *   la prima ancora possibile per tutti i negozi (oggi, se ne resta almeno un'ora, o la prima di
 *   domani); se nessuna va bene per tutti, l'ordine non si sposta e ci pensano gli amministratori;
 * ② l'euro della veloce si toglie dalla consegna dell'ordine che lo porta, tranne quando la veloce
 *   era compresa (spesa piccola): lì cambia solo la fascia;
 * ③ il compenso del fattorino resta quello scritto;
 * ④ il cliente lo sa subito, per email e nella campanella, e può annullare senza costi;
 * ⑤ la scrittura è condizionata su `delivery_status` e su `delivery_slot` = «Adesso»: se il negozio
 *   accetta mentre il freno lavora vince una sola delle due, e un secondo giro non trova niente.
 * Maria: alle 18:16 passa a «Stasera · 18:00–20:00» e alla porta paga 18 € invece di 19.
 * Poi la scadenza delle tre ore (scadenza-accettazione.ts) si conta sulla fascia nuova.
 *
 * ⚠️ Con la CARTA il conto scritto sull'ordine non si tocca qui: 1 € va reso con un rimborso
 * parziale, e il libro dei rimborsi è di lib/stripe/payout.ts. Il freno sposta la fascia e avvisa
 * gli amministratori di rendere l'euro. Al lancio la carta è spenta.
 */

const COLONNE =
  'id, user_id, seller_id, delivery_status, delivery_slot, pickup_in_store, payment_method, payment_status, ' +
  'total_price, gross_total_cents, wallet_applied_cents, shipping_cost, delivery_fee_cents, rider_fee_cents, ' +
  'discount_amount, stripe_session_id, created_at';

/** Gli stati di un ordine che il fattorino non ha ancora portato via dal negozio. */
const NON_ANCORA_PARTITI = ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED'];

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
  created_at: string | null;
};

const centesimi = (x: unknown) => Math.round(Number(x ?? 0) * 100);
const lordoDi = (r: RigaVeloce) =>
  typeof r.gross_total_cents === 'number' ? r.gross_total_cents : centesimi(r.total_price) + Number(r.wallet_applied_cents ?? 0);

/**
 * Quanto deve restare, almeno, di una fascia di oggi per proporla al posto della veloce: i minuti
 * che la veloce stessa si prende dopo la conferma. Collaudo del 30/10: alle 17:50 il freno metteva
 * «15:00–18:00», cioè 10 minuti per un ordine che il negozio non ha ancora nemmeno confermato.
 */
export const MINUTI_MINIMI_DI_FASCIA = EXPRESS_ETA_MAX;

/**
 * La prima fascia che tutti i negozi del carrello possono servire davvero: prima quelle di oggi con
 * almeno `MINUTI_MINIMI_DI_FASCIA` davanti, poi quelle di domani. `null` se non ce n'è nessuna:
 * sabato sera col negozio chiuso la domenica non esiste un'etichetta vera da scrivere, e
 * «Domani · 9:00–12:00» sarebbe una promessa che il negozio non può mantenere.
 */
export function fasciaDopoLaVeloce(oraDiPiacenza: Date, orari: unknown[]): string | null {
  const tutti = (f: string) => orari.every((h) => negozioPuoServire(h, f, oraDiPiacenza));
  const adesso = oraDiPiacenza.getHours() * 60 + oraDiPiacenza.getMinutes();
  const oggi = FASCE_DI_OGGI.filter((f) => f.oraDiFine * 60 - adesso >= MINUTI_MINIMI_DI_FASCIA).map((f) => f.etichetta);
  return oggi.find(tutti) ?? FASCE_DI_DOMANI.find(tutti) ?? null;
}

const TITOLO_SENZA_FASCIA = 'La consegna veloce non è partita: ti contattiamo noi';

/** La frase per il cliente quando nessuna fascia di oggi o di domani va bene per tutti i negozi. */
export function fraseSenzaFascia(): string {
  return (
    `Il negozio non ha confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti la tua consegna veloce, ` +
    'e né oggi né domani c’è una fascia oraria in cui possa consegnare. Ti contattiamo noi per decidere insieme. ' +
    'Se preferisci, puoi annullare l’ordine dalla sua pagina senza costi.'
  );
}

export type ComeVaLEuro = 'tolto-contanti' | 'tolto-carta' | 'compresa' | 'a-mano';

/** La frase per il cliente: la stessa nella campanella e nell'email. */
export function fraseDelFreno(a: { fascia: string; euro: ComeVaLEuro; totaleCents: number }): string {
  const inizio = `Il negozio non ha confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti: la tua spesa arriva nella fascia ${a.fascia}`;
  const fine = 'Se non ti va bene, puoi annullare l’ordine dalla sua pagina senza costi.';
  if (a.euro === 'compresa') return `${inizio}. La consegna veloce era già compresa nel prezzo, quindi il totale non cambia. ${fine}`;
  if (a.euro === 'tolto-contanti') {
    return `${inizio} e l’euro della veloce non lo paghi: alla porta paghi ${formatPriceFromCents(a.totaleCents)}. ${fine}`;
  }
  if (a.euro === 'tolto-carta') return `${inizio} e l’euro della veloce non lo paghi: ti torna sulla carta. ${fine}`;
  return `${inizio} e l’euro della veloce non lo paghi: lo togliamo noi dal conto. ${fine}`;
}

async function ordiniDelCarrello(admin: SupabaseClient, o: RigaVeloce): Promise<RigaVeloce[] | null> {
  let righe: RigaVeloce[] | null = null;
  const sessione = o.stripe_session_id?.trim();
  if (sessione) {
    const { data, error } = await admin.from('orders').select(COLONNE).eq('stripe_session_id', sessione);
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
    const { data, error } = await admin.from('orders').select(COLONNE).in('id', ids);
    if (error || !Array.isArray(data)) return null;
    righe = data as unknown as RigaVeloce[];
  }
  if (!righe.some((r) => r.id === o.id)) return null;
  return righe.sort((x, y) => String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')) || x.id.localeCompare(y.id));
}

async function avvisaIlCliente(admin: SupabaseClient, o: RigaVeloce, frase: string, senzaFascia = false): Promise<void> {
  if (!o.user_id) return;
  const { error } = await admin.from('notifications').insert({
    category: 'order',
    user_id: o.user_id,
    title: senzaFascia ? TITOLO_SENZA_FASCIA : 'La consegna veloce non è partita',
    body: frase,
    link: `/orders/${o.id}`,
  });
  if (error) logger.error('[veloce-non-confermata] campanella al cliente NON scritta', { orderId: o.id, message: error.message });
  try {
    const { data, error: errU } = await admin.auth.admin.getUserById(o.user_id);
    const email = data?.user?.email;
    if (errU || !email) {
      logger.error('[veloce-non-confermata] email al cliente non spedita: indirizzo non letto', { orderId: o.id });
      return;
    }
    const t = veloceNonConfermataTemplate({ orderId: o.id, frase, senzaFascia });
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

/**
 * Nessuna fascia vera per tutti i negozi (sabato sera, negozio chiuso la domenica): l'ordine NON si
 * sposta su un'etichetta falsa. Resta com'è, col suo conto, e ci pensa una persona: gli
 * amministratori e il cliente lo sanno subito. L'ordine resta «Adesso» e il giro dopo lo ritrova:
 * l'avviso già scritto nella campanella è il segno che se n'è già parlato, e non si ripete.
 */
async function senzaFascia(admin: SupabaseClient, o: RigaVeloce): Promise<EsitoDelCarrello> {
  const { data: gia, error } = await admin
    .from('notifications')
    .select('id')
    .eq('link', `/orders/${o.id}`)
    .eq('title', TITOLO_SENZA_FASCIA)
    .limit(1);
  if (error) throw new Error(`ordine ${o.id}: avvisi già spediti non letti: ${error.message}`);
  if (Array.isArray(gia) && gia.length > 0) return 'a-mano';
  await notifyAdmins(
    '⚠️ Veloce non confermata senza una fascia possibile',
    `L'ordine #${o.id.slice(0, 6).toUpperCase()} non è stato confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti e né oggi né domani c'è una fascia in cui tutti i negozi del carrello siano aperti. È rimasto com'era, con la veloce nel conto: senti il negozio e il cliente, e decidete insieme il giorno o l'annullo.`,
    '/admin/orders',
  ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
  await avvisaIlCliente(admin, o, fraseSenzaFascia(), true);
  logger.warn('[veloce-non-confermata] nessuna fascia possibile: carrello lasciato agli amministratori', { orderId: o.id });
  return 'a-mano';
}

async function spostaIlCarrello(admin: SupabaseClient, o: RigaVeloce, carrello: RigaVeloce[], adesso: Date): Promise<EsitoDelCarrello> {
  const altri = carrello.filter(
    (c) => c.id !== o.id && c.delivery_slot === ETICHETTA_ADESSO && !c.pickup_in_store
      && NON_ANCORA_PARTITI.includes(String(c.delivery_status)),
  );
  // Prima l'ordine che il negozio non ha confermato: se nel frattempo l'ha accettato, non si tocca niente.
  const daSpostare = [o, ...altri];

  const venditori = [...new Set(daSpostare.map((c) => c.seller_id).filter((x): x is string => !!x))];
  let orari: unknown[] = [];
  if (venditori.length > 0) {
    const { data: negozi, error } = await admin.from('profiles').select('id, store_hours').in('id', venditori);
    // Senza gli orari non si sceglie nessuna fascia: con `orari = []` ogni fascia sembrava buona
    // (every() su una lista vuota è vero) e il sabato sera la veloce finiva su «Domani · 9:00–12:00»
    // col negozio chiuso la domenica. L'ordine resta «Adesso» e il prossimo giro del freno riprova.
    if (error || !Array.isArray(negozi)) {
      throw new Error(`ordine ${o.id}: orari dei negozi non letti: ${error?.message ?? 'risposta vuota'}`);
    }
    orari = venditori.map((v) => (negozi as Array<{ id: string; store_hours: unknown }>).find((n) => n.id === v)?.store_hours ?? null);
  }
  const fascia = fasciaDopoLaVeloce(romeNow(adesso), orari);
  if (!fascia) return senzaFascia(admin, o);

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
      giaAnnullato: r.delivery_status === 'CANCELED',
    };
  }));
  const carta = carrello.some((c) => c.payment_method !== 'cod');
  const euro: ComeVaLEuro = !conto ? 'a-mano' : conto.toltaCents === 0 ? 'compresa' : carta ? 'tolto-carta' : 'tolto-contanti';

  let aMeta = false;
  const deltaScritti = new Map<string, number>();
  for (const [i, c] of daSpostare.entries()) {
    const riga = euro === 'tolto-contanti' ? conto?.righe.find((r) => r.id === c.id) : undefined;
    const delta = riga?.deltaCents ?? 0;
    const valori: Record<string, unknown> = { delivery_slot: fascia };
    if (riga && delta !== 0) {
      valori.delivery_fee_cents = riga.deliveryFeeCents;
      valori.gross_total_cents = lordoDi(c) + delta;
      valori.total_price = Math.max(0, centesimi(c.total_price) + delta) / 100;
    }
    let q = admin
      .from('orders')
      .update(valori)
      .eq('id', c.id)
      .eq('delivery_slot', ETICHETTA_ADESSO)
      .eq('delivery_status', String(c.delivery_status));
    if (c.delivery_fee_cents != null) q = q.eq('delivery_fee_cents', Number(c.delivery_fee_cents));
    const { data: scritte, error } = await q.select('id');
    if (error) throw new Error(`ordine ${c.id}: ${error.message}`);
    if (!Array.isArray(scritte) || scritte.length === 0) {
      // Il primo è l'ordine non confermato: se non si scrive, il negozio l'ha accettato adesso
      // (o un altro giro l'ha già spostato). Vince lui, e non si avvisa nessuno.
      if (i === 0) return 'accettato';
      aMeta = true;
      continue;
    }
    deltaScritti.set(c.id, delta);
  }

  const totaleCents = carrello
    .filter((c) => c.delivery_status !== 'CANCELED')
    .reduce((s, c) => s + centesimi(c.total_price) + (deltaScritti.get(c.id) ?? 0), 0);

  // L'euro è tolto davvero solo se OGNI ordine che lo portava è stato riscritto. Collaudo del 30/10:
  // l'ordine del forno era già partito col fattorino (fuori da `daSpostare`), il conto restava 4 € e
  // il cliente leggeva «non lo paghi: alla porta paghi 32,00 €», euro compreso. Stesso caso se
  // l'ordine che lo porta cambia stato mentre il freno lavora.
  const rimasti = euro === 'tolto-contanti'
    ? (conto?.righe ?? []).filter((r) => r.deltaCents !== 0 && deltaScritti.get(r.id) !== r.deltaCents)
    : [];
  const euroFinale: ComeVaLEuro = rimasti.length > 0 ? 'a-mano' : euro;

  const daFare: string[] = [];
  if (euroFinale === 'tolto-carta') daFare.push('Rendi 1 € al cliente con un rimborso parziale sulla carta: è l’euro della veloce che non si paga.');
  if (rimasti.length > 0) {
    const codici = rimasti.map((r) => `#${r.id.slice(0, 6).toUpperCase()}`).join(', ');
    daFare.push(`L’euro della veloce sta sull’ordine ${codici}, già partito col fattorino o cambiato nel frattempo, e non si è potuto togliere: rendilo a mano al cliente.`);
  } else if (euroFinale === 'a-mano') {
    daFare.push('Il conto della consegna non è quello della regola: togli a mano l’euro della veloce, se c’era.');
  }
  if (aMeta) daFare.push('Un altro ordine dello stesso carrello è cambiato nel frattempo ed è rimasto sulla veloce: mettilo nella stessa fascia.');
  if (daFare.length > 0) {
    const codice = o.id.slice(0, 6).toUpperCase();
    await notifyAdmins(
      '⚠️ Veloce non confermata da sistemare',
      `L'ordine #${codice} non è stato confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti ed è passato alla fascia ${fascia}. ${daFare.join(' ')}`,
      '/admin/orders',
    ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
  }

  await avvisaIlCliente(admin, o, fraseDelFreno({ fascia, euro: euroFinale, totaleCents }));
  logger.info('[veloce-non-confermata] carrello passato in fascia', { orderId: o.id, fascia, euro: euroFinale, ordini: deltaScritti.size });
  return aMeta || euroFinale === 'a-mano' ? 'a-mano' : 'spostato';
}

export type EsitoDelFreno =
  | { ok: true; spostati: number; accettatiNelFrattempo: number; daSistemareAMano: number }
  | { ok: false; error: string };

/** Il giro del freno: lo chiama app/api/cron/veloce-non-confermata ogni cinque minuti. */
export async function frenoDellaVeloce(admin: SupabaseClient, adesso: Date = new Date()): Promise<EsitoDelFreno> {
  const soglia = new Date(adesso.getTime() - MINUTI_PER_CONFERMARE_LA_VELOCE * 60_000).toISOString();
  const { data, error } = await admin
    .from('orders')
    .select(COLONNE)
    .eq('delivery_status', 'NEW')
    .eq('delivery_slot', ETICHETTA_ADESSO)
    .lt('created_at', soglia)
    .limit(100);
  if (error) {
    logger.error('[veloce-non-confermata] ricerca fallita', { message: error.message });
    return { ok: false, error: error.message };
  }

  let spostati = 0;
  let accettatiNelFrattempo = 0;
  let daSistemareAMano = 0;
  const visti = new Set<string>();
  for (const o of (data ?? []) as unknown as RigaVeloce[]) {
    if (visti.has(o.id) || o.pickup_in_store) continue;
    try {
      const carrello = (await ordiniDelCarrello(admin, o)) ?? [o];
      for (const c of carrello) visti.add(c.id);
      const lui = carrello.find((c) => c.id === o.id) ?? o;
      const esito = await spostaIlCarrello(admin, lui, carrello, adesso);
      if (esito === 'spostato') spostati++;
      else if (esito === 'accettato') accettatiNelFrattempo++;
      else daSistemareAMano++;
    } catch (err) {
      daSistemareAMano++;
      logger.error('[veloce-non-confermata] carrello NON spostato', { orderId: o.id, err });
    }
  }
  return { ok: true, spostati, accettatiNelFrattempo, daSistemareAMano };
}
