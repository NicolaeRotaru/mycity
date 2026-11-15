import { fasciaAlGiornoDellOrdine, giornoDiPiacenza } from '@/lib/ordini/fascia-leggibile';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email/client';
import { veloceNonConfermataTemplate } from '@/lib/email/templates';
import { formatPriceFromCents } from '@/lib/format';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { consegnaSenzaLaVeloce } from '@/lib/ordini/prezzi';
import { SUPPLEMENTO_VELOCE_CENTS } from '@/lib/constants';
import { MINUTI_PER_CONFERMARE_LA_VELOCE, scadenzaAccettazione, scadenzaLeggibile } from '@/lib/ordini/scadenza-accettazione';
import { ETICHETTA_ADESSO, fasceAncoraPossibili, fasceDiDomaniPossibili, fasciaFuoriTempo } from '@/lib/quando-arriva';
import { romeNow } from '@/lib/store-hours';
import { CAMPI_124, conRipiegoSchema, senzaCampi, senzaColonne } from '@/lib/db/migrazione-124';

/**
 * 30/10/2026 — IL SECONDO FRENO DELLA VELOCE (carta #220 approvata il 29/10; la variante B,
 * «il secondo propone una fascia senza l'euro se il negozio non conferma entro 10 minuti», scelta da
 * Nicola il 30/10 fra le 14:49 e le 14:54. Le 16:13 sono del 29/10: il prezzo della veloce).
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
 * Maria: alle 18:16 passa a «Oggi · 18:00–19:30» e alla porta paga 18 € invece di 19.
 * Poi la scadenza delle tre ore (scadenza-accettazione.ts) si conta sulla fascia nuova.
 *
 * ⚠️ Con la CARTA il conto scritto sull'ordine non si tocca qui: 1 € torna con un rimborso
 * parziale chiesto a `refundOrder` (lib/stripe/payout.ts, il libro dei rimborsi) PRIMA di scrivere
 * la fascia, così un giro che muore a metà non perde l'euro (il giro dopo lo richiede con la stessa
 * chiave). Se non parte, o torna meno di 1 €, il
 * cliente legge «te lo rendiamo a mano entro un giorno» e gli amministratori lo sanno. Al lancio
 * la carta è spenta. I negozi che avevano accettato e il fattorino assegnato ricevono la fascia nuova.
 * 13/11/2026 (R17-010) — Se la parte pagata con la carta non copre l'euro (spesa pagata tutta o quasi
 * col credito MyCity), l'euro torna sul credito e il conto dell'ordine si riscrive come sui contanti.
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
// 5/11/2026 — Solo CANCELED: lo stato REJECTED nel database non esiste (il vincolo della 011 non
// lo ammette, e il rifiuto del negozio scrive CANCELED), come in lib/ordini/annulla.ts.
const FUORI_DAL_GIRO = ['CANCELED'];

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
 * La prima fascia che la cassa offrirebbe adesso a questo carrello: la regola unica della cassa e
 * delle rotte (`fasceAncoraPossibili` e `fasceDiDomaniPossibili`, lib/quando-arriva.ts), con i 60
 * minuti prima della fine e la regola del ritiro sugli orari di ogni negozio. Collaudo del 30/10:
 * alle 17:50 il freno metteva «15:00–18:00», cioè 10 minuti per un ordine che il negozio non ha
 * ancora confermato.
 *
 * 30/10/2026 (ondata 22) — Qui c'era una seconda copia dei 60 minuti (`MINUTI_MINIMI_DI_FASCIA`):
 * tolta, così il freno sposta la spesa solo su fasce che la cassa e le rotte accettano.
 * `null` se non ce n'è nessuna: sabato sera col negozio chiuso la domenica non esiste un'etichetta
 * vera da scrivere, e «Domani · 9:00–11:00» sarebbe una promessa che il negozio non può mantenere.
 */
export function fasciaDopoLaVeloce(oraDiPiacenza: Date, orari: unknown[]): string | null {
  return fasceAncoraPossibili(oraDiPiacenza, orari)[0] ?? fasceDiDomaniPossibili(oraDiPiacenza, orari)[0] ?? null;
}

/**
 * 5/11/2026 — «OGGI» E «DOMANI» SI CONTANO DAL GIORNO IN CUI L'ORDINE È NATO.
 *
 * Tutti i lettori (la scadenza, il giro degli scaduti, le pagine di cliente, negozio e fattorino)
 * contano l'etichetta dal giorno di `created_at`. Il freno la sceglieva col giorno del giro: dopo
 * mezzanotte «Domani» voleva dire lunedì per il cliente e domenica per tutti gli altri. Qui
 * l'etichetta scelta col giorno del giro si riporta al giorno di nascita: «Oggi» del giro diventa
 * «Domani» se il giro è il giorno dopo; un giorno che dalla nascita non ha nome (dopodomani) dà
 * `null`, e il carrello non si sposta su una fascia che nessuno saprebbe leggere.
 */
export function fasciaDalGiornoDellOrdine(fascia: string, giro: Date, natoIl: string | null | undefined): string | null {
  const m = /^(Oggi|Domani)( · .+)$/.exec(fascia);
  if (!m || !natoIl) return fascia;
  const nato = giornoDiPiacenza(natoIl);
  const oggi = giornoDiPiacenza(giro);
  if (!nato || !oggi) return fascia;
  const dopo = Math.round((Date.parse(`${oggi}T00:00:00Z`) - Date.parse(`${nato}T00:00:00Z`)) / 86_400_000);
  const giorni = (m[1] === 'Domani' ? 1 : 0) + dopo;
  if (giorni === 0) return `Oggi${m[2]}`;
  if (giorni === 1) return `Domani${m[2]}`;
  return null;
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
export function fraseDelFreno(a: { fascia: string; euro: ComeVaLEuro; totaleCents: number; sulCreditoCents?: number; giaConfermati?: number }): string {
  const inizio = `Il negozio non ha confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti: la tua spesa arriva nella fascia ${a.fascia}`;
  // Il limite è quello della rotta di annullo (app/api/orders/[id]/cancel): il cliente annulla solo
  // un ordine NEW. Prima la frase lo prometteva senza condizioni: alle 12:58 il forno accettava la
  // fascia nuova e alle 13:10 il tasto Annulla non c'era più, mentre la campanella diceva di sì.
  // 12/11/2026 (R09-001) — Con più negozi nel carrello, gli ordini che un negozio aveva già accettato
  // passano alla fascia nuova ma non si annullano: la frase lo dice prima della chiusura (che resta
  // l'ultima frase: l'email la sostituisce con la sua).
  const confermati = a.giaConfermati ?? 0;
  const giaFermi = confermati > 0
    ? `${confermati === 1 ? `L’ordine che un negozio ha già confermato non si annulla più: arriva anche lui nella fascia ${a.fascia}` : `I ${confermati} ordini che i negozi hanno già confermato non si annullano più: arrivano anche loro nella fascia ${a.fascia}`}. `
    : '';
  const fine = `${giaFermi}Se non ti va bene, puoi annullarlo senza costi dalla sua pagina finché il negozio non lo conferma.`;
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
  // 13/11/2026 (R17-010) — Con la carta che non copriva l'euro, l'euro è tornato sul credito MyCity.
  if (a.euro === 'tolto-carta' && (a.sulCreditoCents ?? 0) > 0) {
    return `${inizio} e l’euro della veloce non lo paghi: ${formatPriceFromCents(a.sulCreditoCents ?? 0)} ti torna sul credito MyCity. ${fine}`;
  }
  if (a.euro === 'tolto-carta') return `${inizio} e l’euro della veloce non lo paghi: ti torna sulla carta. ${fine}`;
  return `${inizio}. L’euro della veloce te lo rendiamo a mano entro un giorno. ${fine}`;
}

async function ordiniDelCarrello(admin: SupabaseClient, o: RigaVeloce): Promise<RigaVeloce[] | null> {
  let righe: RigaVeloce[] | null = null;
  const sessione = o.stripe_session_id?.trim();
  if (sessione) {
    const { data, error } = await leggi('sessione', (c) => admin.from('orders').select(c).eq('stripe_session_id', sessione));
    // 5/11/2026 — Una lettura caduta non è «carrello di un negozio»: si lancia, e il giro dopo riprova.
    if (error) throw new Error(`carrello dell'ordine ${o.id} non letto: ${error.message}`);
    if (!Array.isArray(data)) return null;
    righe = data as unknown as RigaVeloce[];
  } else {
    const { data: tentativi, error: errT } = await admin
      .from('cod_checkout_attempts')
      .select('order_ids')
      .eq('user_id', o.user_id)
      .contains('order_ids', JSON.stringify([{ id: o.id }]))
      .limit(1);
    if (errT) throw new Error(`carrello dell'ordine ${o.id} non letto: ${errT.message}`);
    if (!Array.isArray(tentativi) || tentativi.length === 0) return null;
    const elenco = (tentativi[0] as { order_ids: unknown }).order_ids;
    const ids = Array.isArray(elenco)
      ? elenco.map((x) => (x && typeof x === 'object' ? String((x as { id?: unknown }).id ?? '') : String(x))).filter(Boolean)
      : [];
    if (ids.length < 2) return null;
    const { data, error } = await leggi('carrello', (c) => admin.from('orders').select(c).in('id', ids));
    if (error) throw new Error(`carrello dell'ordine ${o.id} non letto: ${error.message}`);
    if (!Array.isArray(data)) return null;
    righe = data as unknown as RigaVeloce[];
  }
  if (!righe.some((r) => r.id === o.id)) return null;
  return righe.sort((x, y) => String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')) || x.id.localeCompare(y.id));
}

/** 5/11/2026 — Dice se almeno campanella o email sono arrivate: chi sposta il carrello lo deve sapere. */
async function avvisaIlCliente(admin: SupabaseClient, o: RigaVeloce, frase: string, nonSpostato = false): Promise<boolean> {
  if (!o.user_id) return false;
  let arrivato = false;
  const { error } = await admin.from('notifications').insert({
    category: 'order',
    user_id: o.user_id,
    title: nonSpostato ? TITOLO_NON_SPOSTATO : 'La consegna veloce non è partita',
    body: frase,
    link: `/orders/${o.id}`,
  });
  if (!error) arrivato = true;
  if (error) {
    logger.error('[veloce-non-confermata] campanella al cliente NON scritta', { orderId: o.id, message: error.message });
    // Quando il carrello non si sposta, la campanella è l'unico segno che al cliente se n'è già parlato
    // (nonSiSposta la rilegge a ogni giro). Senza, l'email ripartiva ogni 5 minuti fino all'annullo.
    // Si aspetta il giro in cui la campanella si scrive: l'email parte una volta sola. Gli
    // amministratori lo sanno già, nonSiSposta li avvisa prima, una volta per ordine.
    if (nonSpostato) return false;
  }
  try {
    const { data, error: errU } = await admin.auth.admin.getUserById(o.user_id);
    const email = data?.user?.email;
    if (errU || !email) {
      logger.error('[veloce-non-confermata] email al cliente non spedita: indirizzo non letto', { orderId: o.id });
      return arrivato;
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
    else arrivato = true;
  } catch (err) {
    logger.error('[veloce-non-confermata] email al cliente NON partita', { orderId: o.id, err });
  }
  return arrivato;
}

// 5/11/2026 — 'gia-segnalato': il carrello che non si sposta, già detto agli amministratori a un giro
// di prima. Non è un problema nuovo: il giro non risponde 500 a ogni passaggio fino all'annullo.
// 5/11/2026 — 'annullato': l'ordine è uscito dal giro (annullato) mentre il freno lavorava, senza
// euro reso: non è «accettato nel frattempo». 'riprova': la fascia non si è scritta su un ordine
// ancora NEW e «Adesso»: il giro dopo riprova, e se succede gli amministratori lo sanno (una volta).
type EsitoDelCarrello = 'spostato' | 'accettato' | 'annullato' | 'riprova' | 'a-mano' | 'gia-segnalato' | 'scaduto';

const codiceDi = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

/**
 * Il freno non può spostare il carrello: gli orari dei negozi non si leggono, oppure né oggi né
 * domani c'è una fascia servibile. L'ordine resta com'è, col suo conto; il cliente legge l'ora vera
 * in cui si annulla da solo, gli amministratori lo sanno. Una volta sola: l'avviso già scritto nella
 * campanella è il segno che se n'è già parlato. Il giro dopo riprova comunque a trovare la fascia.
 */
// 31/10/2026 (ondata 5) — `orari` = gli orari del negozio dell'ordine: con quelli l'ora detta è la chiusura,
// la stessa del giro notturno (scadenza-accettazione.ts), non le tre ore.
async function nonSiSposta(admin: SupabaseClient, o: RigaVeloce, adesso: Date, perche: string, orari?: unknown): Promise<EsitoDelCarrello> {
  // 12/11/2026 (R09-013) — Il giorno che i lavori si riaccendono il freno trova ordini «Adesso» nati
  // giorni prima: la loro scadenza è già passata, e la frase «se non conferma entro le 13:00 di
  // venerdì 30/10…» arrivava al cliente il 20/11. Un ordine già scaduto non si scrive a nessuno:
  // lo annulla expire-stale-orders, che avvisa lui.
  const scadutaGia = scadenzaAccettazione(o, undefined, orari);
  if (scadutaGia && scadutaGia.getTime() <= adesso.getTime()) {
    logger.info('[veloce-non-confermata] ordine già scaduto: lo lascio a expire-stale-orders', { orderId: o.id });
    return 'scaduto';
  }
  const { data: gia, error } = await admin
    .from('notifications')
    .select('id')
    .eq('link', `/orders/${o.id}`)
    .eq('title', TITOLO_NON_SPOSTATO)
    .limit(1);
  if (error) throw new Error(`ordine ${o.id}: avvisi già spediti non letti: ${error.message}`);
  if (Array.isArray(gia) && gia.length > 0) return 'gia-segnalato';
  const scadenza = scadenzaAccettazione(o, undefined, orari) ?? new Date(adesso.getTime() + 3 * 3_600_000);
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
    if (!c.seller_id) continue;
    // 5/11/2026 — Anche il negozio che non ha confermato: prima saltava proprio lui, e se accettava
    // dopo leggeva ancora «Adesso» senza sapere che la consegna era passata alla fascia.
    righe.push({
      category: 'order',
      user_id: c.seller_id,
      title: 'Il carrello ha cambiato fascia',
      body: c.id === o.id
        ? `L'ordine ${codiceDi(c.id)} non è stato confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti: non è più una consegna veloce. Se lo accetti, va consegnato nella fascia ${fascia}.`
        : `L'ordine ${codiceDi(c.id)} non è più una consegna veloce: un altro negozio dello stesso carrello non l'ha confermata. Va consegnato nella fascia ${fascia}.`,
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

/** La chiave del rimborso dell'euro della veloce: la stessa per Stripe e per il libro dei rimborsi (412). */
const chiaveDelFreno = (orderId: string) => `veloce_non_confermata_${orderId}`;

/**
 * 13/11/2026 (R17-016) — Il rimborso già prenotato sull'ordine è quello del freno?
 *
 * Il libro dei rimborsi (migrazione 412) tiene la chiave di ogni prenotazione: `rimborso_gia_prenotato`
 * risponde vero se quella del freno c'è. Falso, una risposta che non è un sì (il database senza la
 * 412 risponde «funzione non trovata»), o una lettura caduta: non si sa di chi sia, e si fa come prima.
 */
async function laPrenotazioneEDelFreno(admin: SupabaseClient, orderId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('rimborso_gia_prenotato', { p_order_id: orderId, p_chiave: chiaveDelFreno(orderId) });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * 12/11/2026 (R09-001, collaudo K01) — Gli ordini del carrello già confermati da un negozio e passati
 * alla fascia: quelli spostati in questo giro, e quelli spostati da un giro di prima caduto a metà
 * (sono già in fascia, e il cliente non era stato avvisato). Non si annullano più: la frase lo dice.
 */
function confermatiSpostati(o: RigaVeloce, scritti: RigaVeloce[], vivi: RigaVeloce[]): number {
  const idScritti = new Set(scritti.map((c) => c.id));
  return vivi.filter((c) => c.id !== o.id && String(c.delivery_status) !== 'NEW'
    && (idScritti.has(c.id) || /^(Oggi|Domani) · /.test(String(c.delivery_slot ?? '')))).length;
}

/**
 * 13/11/2026 (R17-012) — IL CONTO DI UN CARRELLO RISCRITTO A META' DA UN GIRO DI PRIMA.
 *
 * Contanti, due negozi: un giro riscrive l'ordine 1 (consegna 4 € -> 3 €, l'euro della veloce tolto)
 * e cade sulla scrittura dell'ordine 2. Al giro dopo `consegnaSenzaLaVeloce` non riconosceva più il
 * conto, perché l'ordine 1 era già senza la veloce: l'euro andava «a mano», il cliente leggeva «te lo
 * rendiamo a mano» e gli amministratori «rendi l'euro se c'era», ma l'euro era già tolto e poteva
 * tornare due volte. Qui si rifà il conto com'era prima di quel giro: a un ordine già spostato dal
 * freno (in fascia, mentre il carrello nasce tutto «Adesso») si rimette l'euro della veloce, e la
 * regola deve riconoscere quel conto e ridare esattamente la consegna scritta adesso su ogni ordine
 * già spostato. Se torna, l'euro è già tolto da quell'ordine: le righe dicono quanto resta da togliere
 * agli altri (di solito niente). `null` se nessun conto torna: allora resta «a mano», come prima.
 */
function contoGiaRiscrittoAMeta(
  ordini: Parameters<typeof consegnaSenzaLaVeloce>[0],
  giaSpostati: ReadonlySet<string>,
): { righe: NonNullable<ReturnType<typeof consegnaSenzaLaVeloce>>['righe']; toltaCents: number; giaToltoDa: string } | null {
  for (const s of ordini) {
    if (!giaSpostati.has(s.id) || s.giaAnnullato) continue;
    const comEra = ordini.map((x) => (x.id === s.id ? { ...x, deliveryFeeCents: x.deliveryFeeCents + SUPPLEMENTO_VELOCE_CENTS } : x));
    const conto = consegnaSenzaLaVeloce(comEra);
    if (!conto || conto.toltaCents === 0) continue;
    const adesso = (id: string) => ordini.find((x) => x.id === id)?.deliveryFeeCents;
    if (!conto.righe.every((r) => !giaSpostati.has(r.id) || r.deliveryFeeCents === adesso(r.id))) continue;
    return {
      righe: conto.righe.map((r) => (giaSpostati.has(r.id) ? { ...r, deltaCents: 0 } : r)),
      toltaCents: conto.toltaCents,
      giaToltoDa: s.id,
    };
  }
  return null;
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
  // 12/11/2026 (R09-008) — Un giro di prima ha già spostato una parte del carrello e poi è caduto: il
  // resto va nella STESSA fascia, non in quella che si ricalcolerebbe con l'ora nuova. Il carrello
  // nasce con una fascia sola («Adesso» per tutti), quindi un ordine fratello in fascia l'ha messo il freno.
  // Solo se è ancora in tempo (collaudo del 12/11): dopo un guasto lungo la fascia del carrello può
  // essere finita, o a meno di un'ora dalla fine; allora si sceglie da capo, come prima.
  const scrittaSulFratello = vivi.find((c) => c.id !== o.id && !c.pickup_in_store
    && /^(Oggi|Domani) · /.test(String(c.delivery_slot ?? '')))?.delivery_slot ?? null;
  const vistaDaOggi = scrittaSulFratello && o.created_at ? fasciaAlGiornoDellOrdine(scrittaSulFratello, o.created_at, adesso) : null;
  const fasciaDelCarrello = vistaDaOggi && fasciaFuoriTempo(vistaDaOggi, romeNow(adesso)) === null ? scrittaSulFratello : null;
  const fasciaDelGiro = fasciaDelCarrello ? null : fasciaDopoLaVeloce(romeNow(adesso), orari);
  const fascia = fasciaDelCarrello ?? (fasciaDelGiro ? fasciaDalGiornoDellOrdine(fasciaDelGiro, adesso, o.created_at) : null);
  if (!fascia) return nonSiSposta(admin, o, adesso, 'né oggi né domani c’è una fascia in cui tutti i negozi del carrello siano aperti', o.seller_id ? orari[venditori.indexOf(o.seller_id)] : undefined);

  const ordiniDelConto = carrello.map((r) => {
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
  });
  // R17-012 — Un giro di prima caduto a metà può aver già tolto l'euro da un ordine spostato in fascia.
  const giaSpostati = new Set(vivi.filter((c) => c.id !== o.id && !c.pickup_in_store
    && /^(Oggi|Domani) · /.test(String(c.delivery_slot ?? ''))).map((c) => c.id));
  const riscrittoAMeta = consegnaSenzaLaVeloce(ordiniDelConto) ? null : contoGiaRiscrittoAMeta(ordiniDelConto, giaSpostati);
  const conto = riscrittoAMeta ?? consegnaSenzaLaVeloce(ordiniDelConto);
  if (riscrittoAMeta) {
    fatto.push(`l’euro della veloce già tolto dalla consegna dell’ordine ${codiceDi(riscrittoAMeta.giaToltoDa)} da un giro di prima`);
  }
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
  // 13/11/2026 (R17-010) — Gli ordini con la carta il cui euro torna sul credito (vedi sotto).
  const sulCreditoConLaCarta = new Set<string>();
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
      //
      // 13/11/2026 (R17-016) — Il giro morto fra la prenotazione e Stripe lasciava 1 € prenotato senza
      // soldi usciti e senza rimborso nell'elenco: il giro dopo lo prendeva per «un altro rimborso», il
      // cliente leggeva «a mano», e il rimborso a mano dall'amministrazione portava il libro a 2 €. Dalla
      // 412 la prenotazione porta la chiave del freno: se è sua (`laPrenotazioneEDelFreno`) si richiama
      // `refundOrder` con la stessa chiave, che non la prenota di nuovo e rende l'euro una volta sola
      // (fra 10 minuti, se il giro di prima potrebbe essere ancora vivo: fino ad allora si riprova).
      const lui = carrello.find((c) => c.id === r.id);
      const giaResi = Number(lui?.refunded_amount_cents ?? 0);
      if (giaResi > 0) {
        if (giaResi === -r.deltaCents && String(lui?.stripe_refund_id ?? '').trim() !== '') {
          resiCents += giaResi;
          fatto.push(`${formatPriceFromCents(giaResi)} già reso sulla carta per l’ordine ${codiceDi(r.id)}`);
          continue;
        }
      }
      if (giaResi > 0 && !(await laPrenotazioneEDelFreno(admin, r.id))) {
        logger.error('[veloce-non-confermata] sull ordine c è già un rimborso che non è l euro della veloce: non se ne prenota un altro', {
          orderId: r.id, giaResi, chiesti: -r.deltaCents,
        });
        // 5/11/2026 — Non «già reso sulla carta» come se l'avesse reso il freno: è un rimborso di
        // un'altra causa, e l'avviso lo dice così (la frase dipende dallo stato: una volta sola).
        fatto.push(`sull’ordine ${codiceDi(r.id)} c’era già un rimborso di ${formatPriceFromCents(giaResi)} che non è l’euro della veloce: il freno non ne ha prenotato un altro`);
        rimborsoNonFatto.push(r);
        continue;
      }
      // 13/11/2026 (R17-010) — La parte di questo ordine pagata con la carta non copre l'euro: lordo
      // 19 €, credito MyCity 18,40 €, carta 0,60 €. Il rimborso di 1 € sulla carta Stripe lo rifiuta
      // (o lo prende dalla parte di un altro ordine del carrello), e finiva a mano. L'euro torna sul
      // credito, come la parte dei contanti che il credito copriva (⑨): lo fa la scrittura qui sotto.
      if (giaResi === 0 && lui && Math.max(0, centesimi(lui.total_price)) < -r.deltaCents) {
        sulCreditoConLaCarta.add(r.id);
        continue;
      }
      try {
        const esito = await refundOrder({
          orderId: r.id,
          amountCents: -r.deltaCents,
          // L'euro della veloce è di MyCity (lib/constants.ts): dal negozio non si toglie niente.
          quotaNegozioCents: 0,
          reason: 'consegna veloce non confermata dal negozio in 10 minuti',
          idempotencyKey: chiaveDelFreno(r.id),
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
        // 13/11/2026 (R17-011) — Due giri del freno sovrapposti (uno lento accavallato al successivo)
        // prenotavano tutti e due l'euro: Stripe con la stessa chiave lo rendeva una volta, il libro ne
        // segnava due. Dalla 412 il secondo trova la prenotazione del primo e `refundOrder` si ferma
        // (RimborsoGiaInCorso). Allora questo giro non tocca niente: niente fascia, niente «a mano» al
        // cliente né agli amministratori. Il carrello lo finisce il giro che sta rendendo l'euro; se
        // muore, l'ordine resta «Adesso» e lo riprende il giro dopo. (Per nome: chi prova il freno può
        // simulare `refundOrder` senza la classe.)
        if ((err as { name?: unknown } | null)?.name === 'RimborsoGiaInCorso') {
          logger.warn('[veloce-non-confermata] un altro giro sta già rendendo l euro: questo giro non tocca il carrello', { orderId: r.id });
          return 'riprova';
        }
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
    const conCredito = sulCreditoConLaCarta.has(c.id);
    const riga = euro === 'tolto-contanti' || conCredito ? conto?.righe.find((r) => r.id === c.id) : undefined;
    let delta = riga?.deltaCents ?? 0;
    const valori: Record<string, unknown> = { delivery_slot: fascia };
    // La parte dell'euro che i contanti non coprono è stata pagata col credito: torna lì (⑨).
    // R17-010 — Con la carta che non copre l'euro, torna lì tutto l'euro (la carta resta com'è).
    const cassa = Math.max(0, centesimi(c.total_price));
    const dalCredito = conCredito ? Math.max(0, -delta) : Math.max(0, -delta - cassa);
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
    if (error) {
      // 12/11/2026 (R09-008) — Gli ordini già passati alla fascia restano lì: i loro negozi e il
      // fattorino lo sanno subito, invece di leggere «Adesso» finché qualcuno non li chiama.
      if (scritti.length > 0) await avvisaNegoziEFattorino(admin, o, scritti, fascia);
      throw new Error(`ordine ${c.id}: ${error.message}`);
    }
    if (!Array.isArray(righeScritte) || righeScritte.length === 0) {
      // Il primo è l'ordine non confermato: se non si scrive, il negozio l'ha accettato adesso
      // (o un altro giro l'ha già spostato). Vince lui, e non si avvisa nessuno.
      if (i === 0) {
        // Con la carta l'euro è già tornato: se l'ordine è ancora «Adesso» l'ha confermato il negozio
        // in quell'istante e la veloce resta. Al cliente va bene, ma il conto va saputo. Se invece l'ha
        // già spostato un altro giro, era lo stesso rimborso (stessa chiave) e non c'è niente da dire.
        if (resiCents + creditoResoCents === 0) {
          // 5/11/2026 — Anche senza euro reso si rilegge lo stato: un annullo in gara non è
          // «accettato nel frattempo», e una fascia che non si scrive su un ordine ancora NEW e
          // «Adesso» non si conta come accettata in silenzio a ogni giro.
          const { data: ora, error: errOra } = await admin
            .from('orders').select('delivery_slot, delivery_status').eq('id', c.id).maybeSingle();
          const vero = ora as { delivery_slot?: string | null; delivery_status?: string | null } | null;
          if (!errOra && vero) {
            if (FUORI_DAL_GIRO.includes(String(vero.delivery_status ?? ''))) return 'annullato';
            if (vero.delivery_slot === ETICHETTA_ADESSO && vero.delivery_status === 'NEW') {
              await notifyAdmins(
                '⚠️ Veloce: la fascia non si scrive',
                `L'ordine ${codiceDi(o.id)} non è stato confermato in ${MINUTI_PER_CONFERMARE_LA_VELOCE} minuti, ma la fascia ${fascia} non si è potuta scrivere: è ancora «Adesso» e nuovo. Il freno riprova da solo ogni 5 minuti; se resta così, senti il negozio e metti tu la fascia col cliente.`,
                '/admin/orders',
                { unaVoltaPer: `veloce-non-scritta-${o.id}` },
              ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
              return 'riprova';
            }
          }
        }
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
              '⚠️ Ordine annullato mentre il freno rendeva l’euro',
              `L'ordine ${codiceDi(o.id)} risulta annullato, dal cliente o dal negozio che l'ha rifiutato (stato riletto adesso: ${stato}) mentre il freno della veloce rendeva al cliente ${reso} (sulla carta o sul credito MyCity). Il negozio non l'ha confermato e la fascia non è cambiata. Controlla che in tutto al cliente sia tornato quello che ha pagato, non di più e non di meno: l'euro della veloce è già fra quello che gli è tornato.`,
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
    // R17-012 — Se il giro cade dopo, gli amministratori leggono anche che l'euro qui è già tolto.
    fatto.push(`ordine ${codiceDi(c.id)} già passato alla fascia ${fascia}${riga && delta !== 0 ? ', con l’euro della veloce già tolto dalla sua consegna' : ''}`);
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
  // R17-010 — Anche l'euro che doveva tornare sul credito e non c'è tornato.
  if (euro === 'tolto-carta') rimasti = [...rimborsoNonFatto, ...conLEuro.filter((r) => sulCreditoConLaCarta.has(r.id) && deltaScritti.get(r.id) !== r.deltaCents)];
  const euroFinale: ComeVaLEuro = rimasti.length > 0 ? 'a-mano' : euro;

  const daFare: string[] = [];
  if (rimasti.length > 0) {
    const codici = rimasti.map((r) => codiceDi(r.id)).join(', ');
    const sulCredito = rimasti.filter((r) => sulCreditoConLaCarta.has(r.id)).map((r) => codiceDi(r.id)).join(', ');
    daFare.push(carta && sulCredito === codici
      ? `L’euro della veloce sull’ordine ${codici}, pagato con la carta solo in piccola parte, doveva tornare sul credito MyCity, ma il credito non si è potuto riaccreditare o l’ordine è cambiato nel frattempo: rendilo a mano al cliente entro un giorno.${rimasti.some((r) => accreditati.has(r.id)) ? ' Su questo ordine l’euro è già tornato sul credito MyCity: non va reso di nuovo.' : ''}`
      : carta
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

  // R17-012 — Con la carta un conto riscritto vuol dire l'euro tornato sul credito (R17-010).
  const giaSulCreditoCents = riscrittoAMeta && carta ? riscrittoAMeta.toltaCents : 0;
  const clienteAvvisato = await avvisaIlCliente(admin, o, fraseDelFreno({ fascia, euro: euroFinale, totaleCents, sulCreditoCents: sulCreditoCents + giaSulCreditoCents, giaConfermati: confermatiSpostati(o, scritti, vivi) }));
  await avvisaNegoziEFattorino(admin, o, scritti, fascia);
  logger.info('[veloce-non-confermata] carrello passato in fascia', { orderId: o.id, fascia, euro: euroFinale, ordini: deltaScritti.size });
  // 5/11/2026 — La promessa al cliente è cambiata (da 30-60 minuti a una fascia): se né campanella né
  // email gli sono arrivate, non è un giro pulito. Gli amministratori lo avvisano a voce.
  if (!clienteAvvisato) {
    await notifyAdmins(
      '⚠️ Veloce spostata ma il cliente non è stato avvisato',
      `L'ordine ${codiceDi(o.id)} è passato alla fascia ${fascia}, ma né la campanella né l'email al cliente sono partite. Avvisalo tu: la consegna non arriva più in 30-60 minuti.`,
      '/admin/orders',
      { unaVoltaPer: `veloce-cliente-non-avvisato-${o.id}` },
    ).catch((err) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err }));
    return 'a-mano';
  }
  return aMeta || euroFinale === 'a-mano' ? 'a-mano' : 'spostato';
}

export type EsitoDelFreno =
  /** `guasti`: carrelli in cui una scrittura è caduta a metà (sono anche fra quelli da sistemare a mano). */
  | {
      ok: true;
      spostati: number;
      accettatiNelFrattempo: number;
      daSistemareAMano: number;
      giaSegnalati?: number;
      guasti: number;
      /** 5/11/2026 — Annullati mentre il freno lavorava, e fasce non scritte su ordini ancora «Adesso». */
      annullatiNelFrattempo?: number;
      daRiprovare?: number;
      /** 12/11/2026 — Ordini già oltre la scadenza: li annulla expire-stale-orders, il freno non scrive. */
      giaScaduti?: number;
    }
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
  let giaSegnalati = 0;
  let guasti = 0;
  let annullatiNelFrattempo = 0;
  let daRiprovare = 0;
  let giaScaduti = 0;
  // 5/11/2026 — I guasti che non hanno fatto niente (per esempio il database giù alla prima lettura)
  // vanno in UN avviso per giro, non uno per ordine: un guasto passeggero ne mandava fino a 100.
  const fermiSenzaNiente: Array<{ id: string; perche: string; giaResiCents: number }> = [];
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
      else if (esito === 'gia-segnalato') giaSegnalati++;
      else if (esito === 'annullato') annullatiNelFrattempo++;
      else if (esito === 'riprova') daRiprovare++;
      else if (esito === 'scaduto') giaScaduti++;
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
      if (fatto.length === 0) {
        // 12/11/2026 (R09-025) — «Niente in questo giro» non vuol dire «niente sull'ordine»: un giro di
        // prima può aver già reso l'euro. Lo stato vero è quello letto dalla ricerca di questo giro.
        fermiSenzaNiente.push({ id: o.id, perche, giaResiCents: Number(o.refunded_amount_cents ?? 0) });
        continue;
      }
      // 5/11/2026 — Se un ordine è già passato alla fascia, cliente e negozi NON sono stati avvisati
      // (gli avvisi partono alla fine): l'avviso lo dice, invece di parlare solo dell'ordine «Adesso».
      const unoGiaSpostato = fatto.some((f) => f.includes('già passato alla fascia'));
      await notifyAdmins(
        '⚠️ Freno della veloce fermo a metà',
        `Il freno della veloce non è riuscito a finire il carrello dell'ordine ${codiceDi(o.id)}: ${perche}. ` +
          // 12/11/2026 (R09-025) — Le frasi dicono lo stato dell'ordine (anche quello lasciato da un giro di
          // prima), non solo cosa ha fatto questo giro: «in questo giro» era falso.
          `Lo stato adesso: ${fatto.join('; ')}. ` +
          (unoGiaSpostato
            ? 'I negozi e il fattorino degli ordini già spostati sono stati avvisati; il cliente NON ancora: lo avvisa il freno quando sposta il resto del carrello, al giro dopo, nella stessa fascia. Un ordine rimasto «Adesso» e già confermato dal suo negozio il freno non lo tocca: mettilo tu nella stessa fascia. '
            : '') +
          'Il freno riprova da solo ogni 5 minuti e non rende due volte quello che è già reso. Se l’ordine resta «Adesso», ' +
          'senti il negozio e mettilo tu in una fascia col cliente, avvisandolo.',
        '/admin/orders',
        { unaVoltaPer: `veloce-guasto-${o.id}:${fatto.join('|')}` },
      ).catch((e) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { orderId: o.id, err: e }));
    }
  }
  if (fermiSenzaNiente.length > 0) {
    const codici = fermiSenzaNiente.map((f) => codiceDi(f.id));
    await notifyAdmins(
      '⚠️ Freno della veloce fermo prima di cominciare',
      `In questo giro il freno della veloce non ha potuto lavorare ${fermiSenzaNiente.length === 1 ? "sull'ordine" : 'sugli ordini'} ${codici.join(', ')}: ${fermiSenzaNiente[0].perche}. ` +
        'In questo giro non ha fatto niente su quegli ordini. ' +
        // 12/11/2026 (R09-025, collaudo) — Si dice solo quello che la riga letta sa: i rimborsi sulla carta
        // di QUESTO ordine, per qualunque motivo. L'euro tornato sul credito MyCity o su un altro ordine
        // dello stesso carrello qui non si vede: lo si dice, invece di scrivere «nessun rimborso».
        fermiSenzaNiente.map((f) => f.giaResiCents > 0
          ? `Sull’ordine ${codiceDi(f.id)} risultano già resi ${formatPriceFromCents(f.giaResiCents)} sulla carta (per qualunque motivo, anche l’euro della veloce di un giro di prima): guarda l’ordine prima di rendere altro. `
          : `Sull’ordine ${codiceDi(f.id)} non risultano rimborsi sulla carta; l’euro della veloce può essere già tornato sul credito MyCity o stare su un altro ordine dello stesso carrello: guarda il carrello prima di rendere qualcosa. `).join('') +
        'Riprova da solo ogni 5 minuti; se gli ordini restano «Adesso», senti i negozi.',
      '/admin/orders',
      // Una volta l'ora: con un guasto che dura e ordini nuovi che entrano, l'insieme degli id cambia a ogni giro.
      { unaVoltaPer: `veloce-fermo-${adesso.toISOString().slice(0, 13)}` },
    ).catch((e) => logger.error('[veloce-non-confermata] avviso agli amministratori non partito', { err: e }));
  }
  return { ok: true, spostati, accettatiNelFrattempo, daSistemareAMano, giaSegnalati, guasti, annullatiNelFrattempo, daRiprovare, giaScaduti };
}
