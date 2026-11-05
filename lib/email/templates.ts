/**
 * Template HTML/testo per le email transazionali.
 *
 * Tutti i template sono semplici (inline CSS, no immagini esterne)
 * per massimizzare la deliverability. Lingua italiana hardcoded; in
 * fase i18n diventeranno funzioni che ricevono il locale.
 *
 * Il link «annulla l'iscrizione» NON si scrive qui: lo attacca `sendEmail`, che
 * e' l'unico punto che conosce il destinatario, e solo alle email di marketing
 * (R067). Qui il piede porta «Gestisci preferenze» e i link legali.
 *
 * Questo file e' l'UNICA casa dei template: anche i sei del ciclo di vita, che
 * prima vivevano dentro la rotta del cron, stanno qui in fondo (R007).
 */

import { rigaScadenzaPerIlNegozio } from '@/lib/ordini/scadenza-accettazione';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
// 27/8/2026 (R011) — Il filtro dell'HTML era riscritto qui dentro, uguale ma
// scritto in un altro modo, mentre `lib/html-escape.ts` dichiarava nel proprio
// commento di essere quella condivisa. Tre copie della stessa regola sono tre
// regole: il giorno in cui va aggiunto un carattere da filtrare, due restano
// indietro — e restano indietro senza dirlo a nessuno.
import { escapeHtml } from '@/lib/html-escape';
import { recapitoPrivacy } from '@/lib/legal/titolare';
import { formatPrice } from '@/lib/format';
import { cartaAlCheckoutDisponibile } from '@/lib/promesse-pubbliche';
// 27/10/2026 — Il ritiro in negozio si nomina in una email solo se c'e' davvero (`comeArrivaLaSpesa`).
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';

const BRAND = 'MyCity';

/**
 * 3/9/2026 — LA RICEVUTA ARRIVAVA BLU MENTRE IL SITO E' TERRACOTTA.
 *
 * L'unico colore dichiarato qui era `BRAND_COLOR = '#4f46e5'`, l'indigo della
 * vecchia veste «SaaS» che tailwind.config.ts dichiara abbandonata dal giorno
 * del passaggio a terracotta e panna. Intorno c'erano altri sette grigi e verdi
 * copiati a mano dalla stessa vecchia tavolozza. Chi pagava sul sito riceveva
 * la conferma nei colori di un altro sito: e' il primo segnale che si insegna a
 * riconoscere per distinguere una email vera da una truffa.
 *
 * Non e' una correzione di otto numeri: era il MODO. I colori stavano scritti
 * dentro le stringhe, uno per uno, senza nome e senza nessuno che li
 * confrontasse con la tavolozza vera. Adesso stanno qui, hanno un nome, e una
 * prova (`tests/unit/la-ricevuta-veste-i-colori-del-sito.test.ts`) LEGGE la
 * tavolozza da `tailwind.config.ts` e pretende che ogni colore che esce da
 * questo file sia uno di quelli. Il prossimo colore inventato diventa rosso.
 *
 * `tailwind.config.ts` non si puo' importare da qui (il server della posta non
 * ha il CSS): la fonte unica resta lui, ed e' la prova a tenerli agganciati.
 */
const COLORI = {
  marchio: '#A03B25',   // primary-700 — testata, pulsanti, link (= --color-cta)
  sfondo: '#FBF7F0',    // cream-100 — lo sfondo della pagina, come sul sito
  foglio: '#FFFFFF',    // surface-0 — il riquadro del messaggio
  suFoglio: '#FFFFFF',  // il testo sopra il marchio
  testo: '#2C2A28',     // ink-800
  titolo: '#1C1A18',    // ink-900
  tenue: '#57534E',     // ink-500 — etichette e note secondarie
  piede: '#F5EDD9',     // cream-200 — la fascia in fondo
  citazione: '#3C3835', // ink-700 — il messaggio scritto da chi regala
  buono: '#5A7C42',     // olive-600 — «consegnato»
  attenzione: '#B82A28',// secondary-600 — la riga della scadenza per accettare, nell'email al negozio
} as const;

/** Il carattere del sito e' Inter: in posta arriva solo a chi ce l'ha, gli altri scendono la lista. */
const CARATTERE = "Inter,-apple-system,'Segoe UI',Roboto,sans-serif";

function appUrl() {
  return env.appUrl().replace(/\/$/, '');
}

function shell(title: string, body: string, footer?: string): string {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:${COLORI.sfondo};font-family:${CARATTERE};color:${COLORI.testo}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORI.sfondo};padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLORI.foglio};border-radius:12px;overflow:hidden">
      <tr><td style="padding:24px 32px;background:${COLORI.marchio};color:${COLORI.suFoglio}">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.01em">${BRAND}</div>
      </td></tr>
      <tr><td style="padding:32px">
        ${body}
      </td></tr>
      <tr><td style="padding:24px 32px;background:${COLORI.piede};color:${COLORI.tenue};font-size:12px;line-height:1.5">
        ${footer ?? `Hai ricevuto questa email perché hai un account su ${BRAND}. <br>
        <a href="${appUrl()}/profile/settings" style="color:${COLORI.marchio}">Gestisci preferenze</a> ·
        <a href="${appUrl()}/privacy" style="color:${COLORI.marchio}">Privacy</a> ·
        <a href="${appUrl()}/cookies" style="color:${COLORI.marchio}">Cookie</a>`}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${COLORI.marchio};color:${COLORI.suFoglio};text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a>`;
}

/**
 * IL SALUTO CHE NON RESTA A META' QUANDO IL NOME NON C'E'.
 *
 * 6/9/2026 — La prima email dopo un ordine apriva con «Ciao ${nome ?? ''},»: se
 * sul profilo il nome manca — registrazione senza nome, accesso con Google che
 * non lo passa, profilo vecchio — al cliente arrivava «Ciao , abbiamo ricevuto
 * il tuo ordine da Pane Quotidiano». E' il primo messaggio che riceve dopo aver
 * pagato: e' li' che decide se siamo un negozio serio o un sito raffazzonato.
 *
 * La cura giusta era gia' in questo file, nell'email di benvenuto: quando il
 * nome manca non si lascia il buco, si cambia la frase. Qui diventa un aiutante
 * solo, cosi' il prossimo template nasce gia' giusto.
 *
 * Torna la frase INTERA di saluto, virgola compresa, con il nome ripulito
 * (e' testo scritto da un'altra persona: va sempre filtrato).
 */
function saluto(nome?: string | null): string {
  const n = nome?.trim();
  return n ? `Ciao ${escapeHtml(n)},` : 'Ciao,';
}

/**
 * 5/11/2026 — Il numero d'ordine si scrive in un modo solo, come nella pagina «I miei ordini»:
 * «#3F9A12». La conferma scriveva «#3f9a12bc» e l'annullo «#3F9A12»: lo stesso ordine sembrava due.
 */
export const numeroOrdine = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

// ---------- Template specifici ----------

export function orderConfirmedBuyerTemplate(args: {
  name?: string | null;
  orderId: string;
  total: number;
  storeName: string;
  /** 5/11/2026 — La fascia scelta, il ritiro e il modo di pagare: la conferma dice quando e quanto. */
  deliverySlot?: string | null;
  pickupInStore?: boolean;
  paymentMethod?: 'cod' | 'card' | null;
}) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  const fascia = args.deliverySlot?.trim() || null;
  const quando = args.pickupInStore
    ? `Ritiro in negozio${fascia ? `, ${fascia}` : ''}`
    : fascia;
  const pagamento =
    args.paymentMethod === 'cod'
      ? args.pickupInStore
        ? `In contanti al ritiro: tieni pronti ${formatPrice(args.total)}`
        : `In contanti alla consegna: tieni pronti ${formatPrice(args.total)}`
      : args.paymentMethod === 'card'
        ? 'Pagato con la carta'
        : null;
  const riga = (etichetta: string, valore: string) =>
    `<tr><td style="padding:8px 0;color:${COLORI.tenue}">${etichetta}</td><td style="padding:8px 0;text-align:right">${escapeHtml(valore)}</td></tr>`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Ordine ricevuto</h1>
    <p style="margin:0 0 12px;line-height:1.6">${saluto(args.name)} abbiamo ricevuto il tuo ordine da <strong>${escapeHtml(args.storeName)}</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0">
      <tr><td style="padding:8px 0;color:${COLORI.tenue}">Ordine</td><td style="padding:8px 0;text-align:right;font-family:monospace">${escapeHtml(numeroOrdine(args.orderId))}</td></tr>
      <tr><td style="padding:8px 0;color:${COLORI.tenue}">Totale</td><td style="padding:8px 0;text-align:right;font-weight:600">${formatPrice(args.total)}</td></tr>
      ${quando ? riga(args.pickupInStore ? 'Ritiro' : 'Consegna', quando) : ''}
      ${pagamento ? riga('Pagamento', pagamento) : ''}
    </table>
    <p style="margin:24px 0">${btn(orderUrl, 'Vedi ordine')}</p>
    <p style="margin:0;font-size:13px;color:${COLORI.tenue}">Se il negozio non può accettarlo ti scriviamo qui. Lo stato aggiornato lo trovi sempre in «I miei ordini».</p>
  `;
  return {
    subject: `Ordine ${numeroOrdine(args.orderId)} ricevuto — ${BRAND}`,
    html: shell('Ordine ricevuto', body),
    text:
      `Ordine ricevuto. Totale ${formatPrice(args.total)}.` +
      (quando ? ` ${args.pickupInStore ? '' : 'Consegna: '}${quando}.` : '') +
      (pagamento ? ` ${pagamento}.` : '') +
      ` Dettaglio: ${orderUrl}`,
  };
}

/**
 * 5/11/2026 — «oggi» e «domani» valgono solo il giorno in cui l'email parte: chi la legge la mattina
 * dopo capiva un giorno sbagliato. Qui accanto alla parola si scrive il giorno vero, contato
 * sull'orologio di Piacenza a partire da `rispettoA` (quando l'ordine è nato).
 */
export function conLaData(testo: string, rispettoA: Date): string {
  if (Number.isNaN(rispettoA.getTime())) return testo;
  // Il giorno di Piacenza di `rispettoA`, poi +1 a mezzogiorno UTC: niente scivoloni col cambio d'ora.
  const [a, m, g] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(rispettoA).split('-').map(Number);
  const giorno = (piu: number) => {
    const d = new Date(Date.UTC(a, m - 1, g + piu, 12));
    const nome = d.toLocaleDateString('it-IT', { timeZone: 'UTC', weekday: 'long' });
    return `${nome} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  };
  return testo.replace(/\b(oggi|domani)\b/gi, (w) => `${w} (${giorno(w.toLowerCase() === 'domani' ? 1 : 0)})`);
}

export function newOrderSellerTemplate(args: {
  sellerName?: string | null;
  orderId: string;
  total: number;
  itemsCount: number;
  /** Quando è nato l'ordine. Se manca vale adesso: l'email parte quando l'ordine nasce. */
  createdAt?: string | Date | null;
  /** La fascia scritta sull'ordine. Se chi chiama non la passa, la scadenza non si inventa. */
  deliverySlot?: string | null;
  /**
   * Gli orari del negozio (`profiles.store_hours`), letti dal database da chi manda l'email.
   * Senza, la scadenza resta la fine della fascia: lunedì alle 12:00 Pane Quotidiano leggeva
   * «entro le 16:30» per la 13:00–16:30, con l'ultimo ritiro alle 12:45.
   */
  storeHours?: unknown;
}) {
  const orderUrl = `${appUrl()}/seller/orders/${args.orderId}`;
  // 30/10/2026 — Qui c'era «Accetta o rifiuta l'ordine entro 15 minuti», mentre il sito aspetta
  // almeno tre ore o la fine della fascia (lib/ordini/scadenza-accettazione.ts). La riga viene
  // dalla stessa funzione che leggono le pagine ordini del negoziante.
  const nato = args.createdAt ? new Date(args.createdAt) : new Date();
  const senzaFascia = 'Accettalo o rifiutalo appena puoi: entro quando, lo trovi sulla pagina dell’ordine.';
  let scadenza = senzaFascia;
  if (args.deliverySlot !== undefined) {
    try {
      scadenza = rigaScadenzaPerIlNegozio({ created_at: nato, delivery_slot: args.deliverySlot }, nato, args.storeHours) ?? senzaFascia;
    } catch (err) {
      // L'avviso «Nuovo ordine» parte comunque: senza la riga della scadenza, mai senza l'email.
      logger.error('[email] scadenza per il negozio non calcolata', { orderId: args.orderId, err });
    }
  }
  // 5/11/2026 — L'email si legge anche il giorno dopo: «oggi» e «domani» portano la data
  // (rispetto a quando l'ordine è nato), e la fascia da servire è scritta, non solo la scadenza.
  scadenza = conLaData(scadenza, nato);
  const fascia = args.deliverySlot?.trim() ? conLaData(args.deliverySlot.trim(), nato) : null;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">🛒 Nuovo ordine</h1>
    <p style="margin:0 0 12px;line-height:1.6">Hai ricevuto un nuovo ordine di ${args.itemsCount} articol${args.itemsCount === 1 ? 'o' : 'i'} per <strong>${formatPrice(args.total)}</strong>.</p>
    ${fascia ? `<p style="margin:0 0 12px;line-height:1.6">Consegna: <strong>${escapeHtml(fascia)}</strong></p>` : ''}
    <p style="margin:0 0 12px;line-height:1.6;color:${COLORI.attenzione};font-weight:600">${escapeHtml(scadenza)}</p>
    <p style="margin:24px 0">${btn(orderUrl, 'Gestisci ordine')}</p>
  `;
  return {
    subject: `🛒 Nuovo ordine — ${formatPrice(args.total)}`,
    html: shell('Nuovo ordine', body),
    text: `Nuovo ordine per ${formatPrice(args.total)}.${fascia ? ` Consegna: ${fascia}.` : ''} ${scadenza} Gestiscilo qui: ${orderUrl}`,
  };
}

/**
 * 30/10/2026 — IL NEGOZIO NON HA CONFERMATO LA VELOCE IN 10 MINUTI (carta #220).
 *
 * Al cliente: la spesa passa a una fascia, l'euro della veloce non lo paga, e può annullare
 * finché il negozio non accetta la spesa nella fascia nuova (la rotta di annullo,
 * app/api/orders/[id]/cancel, accetta solo un ordine NEW; dopo il tasto Annulla sparisce).
 * La frase arriva da lib/ordini/veloce-non-confermata.ts, la stessa della campanella.
 *
 * 1/11/2026 — L'EMAIL SI LEGGE DOPO, E DOPO «SENZA COSTI» NON E' PIU' VERO.
 * La campanella si legge subito; l'email spesso ore dopo, quando il forno ha già accettato la
 * fascia nuova. La frase chiudeva con «puoi annullarlo senza costi dalla sua pagina finché il
 * negozio non lo conferma»: chi la leggeva alle 13:10 capiva «il negozio non ha confermato (la
 * veloce), quindi posso annullare», e sulla pagina il tasto non c'era più. Nell'email quella
 * chiusura si sostituisce con `CHIUSURA_ANNULLO_EMAIL`, che dice il limite in modo che regga anche
 * letta tardi. La frase della campanella non cambia (sta in lib/ordini).
 */
export const CHIUSURA_ANNULLO_EMAIL =
  'Se non ti va bene, puoi annullarlo dalla pagina dell’ordine, ma solo finché il negozio non lo conferma nella fascia nuova: fino a quel momento l’annullo non ti costa niente. ' +
  'Quando il negozio l’ha confermato, il tasto Annulla non c’è più e l’ordine non si annulla.';

/** La chiusura «puoi annullarlo…» della frase del freno, se c'è: è sempre l'ultima frase. */
const CHIUSURA_ANNULLO_DELLA_CAMPANELLA = /\s*Se non ti va bene, puoi annullarlo[^.]*\.\s*$/;

export function veloceNonConfermataTemplate(args: { orderId: string; frase: string; senzaFascia?: boolean }) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  // Chi scorre tutti i modelli del file li chiama anche con argomenti a metà: niente frase, niente crash.
  const grezza = String(args.frase ?? '');
  // Senza fascia (fraseNonSpostato) la frase non promette nessun annullo: resta com'è.
  const frase = CHIUSURA_ANNULLO_DELLA_CAMPANELLA.test(grezza)
    ? `${grezza.replace(CHIUSURA_ANNULLO_DELLA_CAMPANELLA, '')} ${CHIUSURA_ANNULLO_EMAIL}`
    : grezza;
  // Senza una fascia possibile (sabato sera, negozio chiuso la domenica) il titolo non ne promette una,
  // e non promette nemmeno un contatto: la frase dice l'ora vera in cui l'ordine si annulla.
  const titolo = args.senzaFascia ? 'Il negozio non ha ancora confermato' : 'La tua spesa arriva in una fascia oraria';
  // 5/11/2026 — Senza fascia la frase apre con le stesse parole del titolo: nel corpo dell'email non
  // si ripetono (nel testo semplice restano, lì il titolo non c'è).
  const corpo = frase.startsWith(`${titolo}. `) ? frase.slice(titolo.length + 2) : frase;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">${titolo}</h1>
    <p style="margin:0 0 12px;line-height:1.6">${escapeHtml(corpo)}</p>
    <p style="margin:24px 0">${btn(orderUrl, 'Vedi il tuo ordine')}</p>
  `;
  return {
    subject: args.senzaFascia
      ? 'La consegna veloce non è ancora confermata dal negozio'
      : 'La consegna veloce non è partita: la tua spesa arriva in una fascia oraria',
    html: shell(titolo, body),
    text: `${frase} Il tuo ordine: ${orderUrl}`,
  };
}

/**
 * 1/11/2026 — UN CLIENTE HA SCRITTO AL NEGOZIO.
 *
 * Il negozio non apre l'app per vedere se qualcuno gli ha scritto: senza un
 * avviso, il messaggio restava li' finche' non passava per caso. Qui c'e' solo
 * il fatto e il link alla chat: NIENTE testo del messaggio e niente nome del
 * cliente. La posta passa per server di altri e resta nelle caselle per anni;
 * quello che il cliente ha scritto lo legge il negozio dentro MyCity.
 */
export function messaggioNuovoAlNegozioTemplate(args: { conversationId: string }) {
  const chatUrl = `${appUrl()}/messages/${encodeURIComponent(String(args.conversationId ?? ''))}`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Hai un messaggio nuovo da un cliente</h1>
    <p style="margin:0 0 12px;line-height:1.6">Un cliente ti ha scritto nella chat di MyCity. Rispondi da lì: il messaggio lo trovi aprendo la conversazione.</p>
    <p style="margin:0 0 12px;line-height:1.6">Se ti scrive ancora prima che tu abbia letto, non ti mandiamo altre email: le trovi tutte nella stessa chat.</p>
    <p style="margin:24px 0">${btn(chatUrl, 'Apri la chat')}</p>
  `;
  return {
    subject: 'Hai un messaggio nuovo da un cliente',
    html: shell('Messaggio nuovo', body),
    text: `Un cliente ti ha scritto nella chat di MyCity. Rispondi da qui: ${chatUrl}`,
  };
}

/**
 * 30/8/2026 (R007) — «IL TUO ORDINE E' PRONTO», AL CLIENTE.
 *
 * Questo messaggio esisteva, impaginato, e non lo chiamava nessuno: cercandone
 * il nome in tutto il progetto si trovava solo la riga che lo definisce. Era
 * anche scritto per il destinatario sbagliato — parlava al fattorino («un
 * ordine ti aspetta in negozio», col link all'area fattorini) — mentre il
 * fattorino, quando l'ordine diventa pronto, non e' ancora stato assegnato: a
 * quel punto la persona che aspetta una notizia e' il cliente.
 *
 * Sul RITIRO IN NEGOZIO il codice serve davvero al cliente: e' quello che
 * mostra al bancone e che il negoziante digita per chiudere il ritiro
 * (`confirm_pickup_by_seller`). Su una consegna a domicilio invece non c'entra
 * niente: quel codice lo legge il negoziante al fattorino, e mandarlo al
 * cliente sarebbe consegnare una chiave a chi non deve usarla.
 */
export function orderReadyTemplate(args: {
  orderId: string;
  pickupInStore: boolean;
  storeName?: string | null;
  storeAddress?: string | null;
  pickupCode?: string | null;
}) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  const negozio = args.storeName?.trim();
  const dove = args.storeAddress?.trim();
  const codice = args.pickupCode?.trim();

  const corpoRitiro = `
    <p style="margin:0 0 12px;line-height:1.6">Il tuo ordine è pronto: puoi passare a ritirarlo${negozio ? ` da <strong>${escapeHtml(negozio)}</strong>` : ''}.</p>
    ${dove ? `<p style="margin:0 0 12px;line-height:1.6">Indirizzo: <strong>${escapeHtml(dove)}</strong></p>` : ''}
    ${codice ? `<p style="margin:0 0 12px;line-height:1.6">Mostra questo codice al negozio: <span style="font-family:monospace;font-size:18px;font-weight:700">${escapeHtml(codice)}</span></p>` : ''}
  `;
  // 27/10/2026 — «un rider passa a prenderlo», non «lo ritira»: detto al cliente, «ritira» si
  // confonde col ritiro in negozio, che al lancio e' spento. Finche' e' spento nessuna email
  // nomina il ritiro (la prova scorre tutti i modelli di questo file).
  const corpoConsegna = `
    <p style="margin:0 0 12px;line-height:1.6">Il tuo ordine è pronto${negozio ? ` da <strong>${escapeHtml(negozio)}</strong>` : ''}: un rider passa a prenderlo e te lo porta a casa nella fascia che hai scelto.</p>
    <p style="margin:0 0 12px;line-height:1.6">La fascia e lo stato della consegna li trovi nella pagina dell’ordine, insieme al codice che il fattorino ti chiederà alla consegna.</p>
  `;

  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">📦 Il tuo ordine è pronto</h1>
    ${args.pickupInStore ? corpoRitiro : corpoConsegna}
    <p style="margin:24px 0">${btn(orderUrl, 'Vedi l’ordine')}</p>
  `;
  return {
    subject: args.pickupInStore
      ? '📦 Il tuo ordine ti aspetta in negozio'
      : '📦 Il tuo ordine è pronto',
    html: shell('Ordine pronto', body),
    text: args.pickupInStore
      ? `Il tuo ordine è pronto${dove ? ` da ritirare in ${dove}` : ''}.${codice ? ` Mostra il codice ${codice}.` : ''} ${orderUrl}`
      : `Il tuo ordine è pronto: un rider passa a prenderlo e te lo porta a casa nella fascia che hai scelto. ${orderUrl}`,
  };
}

export function orderDeliveredTemplate(args: { orderId: string; name?: string | null; total: number }) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.buono}">✅ Ordine consegnato</h1>
    <p style="margin:0 0 12px;line-height:1.6">${saluto(args.name)} il tuo ordine è stato consegnato.</p>
    <p style="margin:0 0 12px;line-height:1.6">Grazie per aver scelto ${BRAND}. Lascia una recensione per aiutare altri acquirenti.</p>
    <p style="margin:24px 0">${btn(orderUrl, 'Lascia recensione')}</p>
  `;
  return {
    subject: `✅ Ordine consegnato — lascia una recensione`,
    html: shell('Ordine consegnato', body),
    text: `Il tuo ordine è stato consegnato. Lascia recensione: ${orderUrl}`,
  };
}

/*
 * 30/8/2026 (R007) — IL TEMPLATE DEL «REIMPOSTA PASSWORD» NON C'E' PIU'.
 *
 * Stava qui, impaginato, e non lo chiamava nessuno. Non era una dimenticanza da
 * riparare collegandolo: la email del recupero password la manda Supabase
 * (`supabase.auth.resetPasswordForEmail`, in app/sign-in), col suo link a
 * scadenza, e noi quel link non lo possiamo nemmeno costruire. Un template che
 * non si puo' spedire e' un invito a spedirlo: il prossimo che lo trova crede
 * che il recupero password passi di qui, e cerca il difetto dove non e'.
 */

/**
 * R25 — I MOTIVI ARRIVANO COME CODICI, E AL CLIENTE VANNO DETTI A PAROLE.
 *
 * Quando il negozio approva un reso senza scrivere una nota, le rotte dei resi
 * passano il codice di Stripe `requested_by_customer`, e il cliente leggeva
 * «Motivo: requested_by_customer». Qui i codici noti diventano una frase, e un
 * codice che non conosciamo non si stampa: al cliente non direbbe niente.
 * Le note scritte da una persona (il negozio, l'amministratore) passano com'erano.
 */
const MOTIVI_IN_CHIARO: Record<string, string> = {
  requested_by_customer: 'reso richiesto da te',
  duplicate: 'pagamento addebitato due volte',
  fraudulent: 'pagamento non autorizzato',
  expired_uncaptured_charge: 'pagamento mai completato',
};

export function motivoDelRimborsoInChiaro(motivo?: string | null): string | null {
  const testo = (motivo ?? '').trim();
  if (!testo) return null;
  if (Object.prototype.hasOwnProperty.call(MOTIVI_IN_CHIARO, testo)) return MOTIVI_IN_CHIARO[testo];
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(testo)) return null;
  return testo;
}

/**
 * 27/10/2026 — L'ORDINE ANNULLATO, DETTO PER EMAIL A CHI L'AVEVA FATTO.
 *
 * Il negozio rifiuta, l'amministrazione annulla, o il giro notturno fa scadere
 * un ordine mai accettato. Sulla carta parte gia' «Rimborso emesso»; chi paga
 * alla consegna non riceveva niente, e aspettava un fattorino che non sarebbe
 * arrivato. Il messaggio dice tre cose: quale ordine, perche' (se lo sappiamo
 * dire a parole) e che non c'e' niente da pagare. Se aveva usato credito
 * MyCity, torna indietro, e lo si dice.
 */
export function ordineAnnullatoTemplate(args: {
  orderId: string;
  motivo?: string | null;
  /** Il credito MyCity speso sull'ordine e restituito con l'annullo, in euro. */
  creditoRestituitoEuro?: number;
  /** Il negozio dell'ordine: in un carrello con più negozi dice QUALE ordine se ne va. */
  storeName?: string | null;
}) {
  const ordine = numeroOrdine(args.orderId);
  const negozio = args.storeName?.trim() || null;
  const motivo = motivoDelRimborsoInChiaro(args.motivo);
  const credito = Number(args.creditoRestituitoEuro ?? 0);
  const negozi = `${appUrl()}/search`;
  const p = (testo: string) => `<p style="margin:0 0 12px;line-height:1.6">${testo}</p>`;
  const rigaCredito = credito > 0
    ? `Il credito MyCity che avevi usato (${formatPrice(credito)}) ti è stato restituito.`
    : '';
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Il tuo ordine è stato annullato</h1>
    ${p(`L'ordine <strong>${ordine}</strong>${negozio ? ` da <strong>${escapeHtml(negozio)}</strong>` : ''} è stato annullato e non verrà preparato né consegnato.`)}
    ${motivo ? `<p style="margin:0 0 12px;color:${COLORI.tenue}">Motivo: ${escapeHtml(motivo)}</p>` : ''}
    ${p('<strong>Non devi pagare niente.</strong>')}
    ${rigaCredito ? p(rigaCredito) : ''}
    <p style="margin:24px 0">${btn(negozi, 'Cerca in un altro negozio')}</p>
  `;
  return {
    subject: `Ordine ${ordine}${negozio ? ` da ${negozio}` : ''} annullato — non devi pagare niente`,
    html: shell('Ordine annullato', body),
    text:
      `L'ordine ${ordine}${negozio ? ` da ${negozio}` : ''} è stato annullato e non verrà preparato né consegnato.` +
      (motivo ? ` Motivo: ${motivo}.` : '') +
      ' Non devi pagare niente.' +
      (rigaCredito ? ` ${rigaCredito}` : '') +
      ` Altri negozi: ${negozi}`,
  };
}

/**
 * R25 — L'EMAIL DICE COME TORNANO DAVVERO I SOLDI.
 *
 * Il modello era uno solo, quello della carta: «il rimborso arriverà sul tuo
 * metodo di pagamento entro 5-10 giorni lavorativi». Lo riceveva anche chi
 * aveva pagato in contanti e aveva avuto credito MyCity: aspettava per giorni
 * dei soldi che non sarebbero arrivati, e non sapeva di avere gia' il credito.
 *
 * Adesso il modo lo dice chi ha mosso i soldi (`refundOrder` lo sa):
 *  · carta    → torna sulla carta, nei tempi della banca;
 *  · credito  → e' gia' disponibile, e si dice dove si vede e dove si spende;
 *  · bonifico → lo facciamo noi, a mano: il cliente risponde a questa email
 *               con IBAN e intestatario (il sito non chiede l'IBAN);
 *  · misto    → un ordine pagato in parte col credito: la parte del credito
 *               torna credito, quella dei contanti col bonifico.
 * Senza indicazione vale «carta», che e' l'unico caso del webhook di Stripe.
 * Sui contanti l'oggetto e il corpo portano il numero dell'ordine come lo vede
 * il cliente: chi risponde con l'IBAN lo attacca all'ordine giusto.
 */
export function refundIssuedTemplate(args: {
  orderId: string;
  amount: number;
  reason?: string | null;
  modo?: 'carta' | 'credito' | 'bonifico' | 'misto';
  /** Per i contanti: quanto torna come credito MyCity e quanto col bonifico, in euro. */
  creditoEuro?: number;
  bonificoEuro?: number;
}) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  const importo = formatPrice(args.amount);
  const motivo = motivoDelRimborsoInChiaro(args.reason);
  const rigaMotivo = motivo
    ? `<p style="margin:0 0 12px;color:${COLORI.tenue}">Motivo: ${escapeHtml(motivo)}</p>`
    : '';
  const testoMotivo = motivo ? ` Motivo: ${motivo}.` : '';
  const modo = args.modo ?? 'carta';
  const p = (testo: string) => `<p style="margin:0 0 12px;line-height:1.6">${testo}</p>`;

  if (modo === 'carta') {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">💶 Rimborso emesso</h1>
      ${p(`Abbiamo emesso un rimborso di <strong>${importo}</strong> sul tuo ordine.`)}
      ${rigaMotivo}
      ${p('Il rimborso arriverà sulla carta che hai usato per pagare, di solito entro 5-10 giorni lavorativi: i tempi li decide la tua banca.')}
      <p style="margin:24px 0">${btn(orderUrl, 'Vedi dettaglio')}</p>
    `;
    return {
      subject: `💶 Rimborso emesso — ${importo}`,
      html: shell('Rimborso emesso', body),
      text: `Rimborso di ${importo} emesso sulla carta che hai usato per pagare.${testoMotivo} Dettaglio: ${orderUrl}`,
    };
  }

  // Contanti: credito, bonifico, o tutti e due.
  const ordine = `#${args.orderId.slice(0, 6).toUpperCase()}`;
  const creditoUrl = `${appUrl()}/profile/gift-cards`;
  const credito = formatPrice(args.creditoEuro ?? (modo === 'credito' ? args.amount : 0));
  const bonifico = formatPrice(args.bonificoEuro ?? (modo === 'bonifico' ? args.amount : 0));

  const righe: string[] = [];
  const testi: string[] = [];
  if (modo === 'credito') {
    righe.push(p(`Per l'ordine ${ordine} ti abbiamo restituito <strong>${importo}</strong> come credito MyCity, perché avevi pagato con il credito MyCity.`));
    testi.push(`Per l'ordine ${ordine} ti abbiamo restituito ${importo} come credito MyCity, perché avevi pagato con il credito MyCity.`);
  } else if (modo === 'bonifico') {
    righe.push(p(`Per l'ordine ${ordine} ti restituiamo <strong>${importo}</strong> con un bonifico, senza costi per te.`));
    testi.push(`Per l'ordine ${ordine} ti restituiamo ${importo} con un bonifico, senza costi per te.`);
  } else {
    righe.push(p(`Per l'ordine ${ordine} ti restituiamo <strong>${importo}</strong>: <strong>${credito}</strong> come credito MyCity, perché li avevi pagati con il credito, e <strong>${bonifico}</strong> con un bonifico, senza costi per te.`));
    testi.push(`Per l'ordine ${ordine} ti restituiamo ${importo}: ${credito} come credito MyCity, perché li avevi pagati con il credito, e ${bonifico} con un bonifico, senza costi per te.`);
  }
  if (modo !== 'bonifico') {
    // Collaudo del 15/10 — qui c'era «alla voce Buoni regalo», ma nel menu del
    // profilo quella voce si chiama «Gift card» (components/account/AccountSidebar.tsx):
    // il cliente cercava una parola che non trovava. Ora il nome e' quello vero, e
    // nell'email in HTML e' anche il collegamento.
    righe.push(p(`Il credito è già disponibile: lo vedi nel tuo profilo, alla voce <a href="${creditoUrl}" style="color:${COLORI.marchio};font-weight:600">«Gift card»</a>, e lo usi sui prossimi ordini pagati alla consegna.`));
    testi.push(`Il credito è già disponibile nel tuo profilo, alla voce «Gift card» (${creditoUrl}), e si usa sui prossimi ordini pagati alla consegna.`);
  }
  if (modo !== 'credito') {
    // Il sito non chiede l'IBAN: lo chiede questa email, e la risposta arriva a chi fa il bonifico.
    const comeRiceverlo =
      "Per il bonifico ci servono l'IBAN e il nome dell'intestatario del conto: rispondi a questa email con questi due dati. " +
      'Il bonifico lo facciamo a mano, appena riceviamo la tua risposta. ' +
      'Se nel frattempo cancelli il tuo account, il rimborso resta valido: rispondi comunque a questa email.';
    righe.push(p(comeRiceverlo));
    testi.push(comeRiceverlo);
  }

  // Collaudo finale del 17/10 — sul misto il titolo diceva «Rimborso in arrivo»,
  // ma la parte di credito e' gia' arrivata: il titolo dice i due modi veri.
  const titolo =
    modo === 'credito' ? 'Rimborso in credito MyCity' : modo === 'bonifico' ? 'Rimborso con bonifico' : 'Rimborso in credito MyCity e con bonifico';
  const [bottoneUrl, bottone] = modo === 'credito' ? [creditoUrl, 'Vedi il tuo credito'] : [orderUrl, 'Vedi dettaglio'];
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">💶 ${titolo}</h1>
    ${righe[0]}
    ${rigaMotivo}
    ${righe.slice(1).join('\n    ')}
    <p style="margin:24px 0">${btn(bottoneUrl, bottone)}</p>
  `;
  const oggetto =
    modo === 'credito'
      ? `💶 Rimborso in credito MyCity per l'ordine ${ordine} — ${importo}`
      : modo === 'bonifico'
        ? `💶 Rimborso di ${importo} per l'ordine ${ordine}: rispondi con il tuo IBAN`
        : `💶 Rimborso di ${importo} per l'ordine ${ordine}: credito MyCity e bonifico`;
  return {
    subject: oggetto,
    html: shell(titolo, body),
    text: `${testi[0]}${testoMotivo} ${testi.slice(1).join(' ')} Dettaglio: ${orderUrl}`,
  };
}

/**
 * L'AVVISO DEL BONIFICO DA FARE, PER EMAIL (semplificazione del 17/10/2026).
 *
 * Lo stesso testo che `refundOrder` scrive fra le notifiche degli amministratori
 * va anche alla casella dei contatti pubblici, dove arrivano le risposte dei
 * clienti con l'IBAN: la campanella mostra le ultime 50 notifiche, la casella no.
 */
export function bonificoDaFareTemplate(args: { ordineId: string; bonificoCents: number; testo: string }) {
  const ordine = `#${args.ordineId.slice(0, 6).toUpperCase()}`;
  const cifra = formatPrice(args.bonificoCents / 100);
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">💶 Bonifico di rimborso da fare</h1>
    <p style="margin:0 0 12px;line-height:1.6">${escapeHtml(args.testo)}</p>
  `;
  return {
    subject: `Bonifico di rimborso da fare — ordine ${ordine} — ${cifra}`,
    html: shell('Bonifico di rimborso da fare', body, `Avviso interno di ${BRAND} per chi fa i rimborsi.`),
    text: args.testo,
  };
}

/**
 * 3/9/2026 — CHI RICEVE UN REGALO NON SI È MAI ISCRITTO A NIENTE.
 *
 * Questa è l'unica email che MyCity manda a una persona che non è nostra
 * cliente: nome, indirizzo e messaggio ce li ha dati qualcun altro. Lei non ha
 * mai letto la nostra informativa e, prima di questa riga, non aveva modo di
 * sapere né che abbiamo il suo indirizzo né come farselo togliere.
 *
 * L'articolo 14 del GDPR dice esattamente questo: quando i dati arrivano da
 * un terzo, chi li riceve va informato al primo contatto. Il piede standard
 * («hai ricevuto questa email perché hai un account su MyCity») per lei era
 * anche falso: un account non ce l'ha.
 */
function piedeDelDestinatarioDelRegalo(mittente: string): string {
  const dove = recapitoPrivacy();
  const link = dove.href.startsWith('mailto:') ? dove.href : `${appUrl()}${dove.href}`;
  return `Hai ricevuto questa email perché ${mittente} ha comprato un buono regalo per te e ci ha lasciato il tuo
    indirizzo. Non hai un account ${BRAND} e non ti abbiamo iscritto a nulla.<br>
    Conserviamo il tuo nome, la tua email e il messaggio solo per recapitarti il regalo.
    <a href="${appUrl()}/privacy" style="color:${COLORI.marchio}">Come trattiamo i tuoi dati</a> ·
    per farli cancellare subito scrivi a
    <a href="${link}" style="color:${COLORI.marchio}">${escapeHtml(dove.testo)}</a>.`;
}

export function giftCardRecipientTemplate(args: { code: string; amountEuro: number; senderName?: string | null; message?: string | null }) {
  const redeemUrl = `${appUrl()}/profile/gift-cards`;
  // 5/11/2026 — Il nome grezzo (una riga sola) per oggetto e testo semplice, filtrato solo nell'HTML:
  // «Maria D'Angelo», non «Maria D&#39;Angelo», nell'oggetto.
  const fromGrezzo = args.senderName?.trim() ? args.senderName.trim().replace(/[\r\n]+/g, ' ') : 'Qualcuno';
  const from = escapeHtml(fromGrezzo);
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">🎁 Hai ricevuto una gift card</h1>
    <p style="margin:0 0 12px;line-height:1.6"><strong>${from}</strong> ti ha regalato una gift card MyCity da <strong>${formatPrice(args.amountEuro)}</strong>, spendibile nei negozi di Piacenza.</p>
    ${args.message?.trim() ? `<p style="margin:0 0 16px;padding:12px 16px;background:${COLORI.piede};border-radius:8px;font-style:italic;color:${COLORI.citazione}">«${escapeHtml(args.message.trim())}»</p>` : ''}
    <p style="margin:0 0 8px;color:${COLORI.tenue}">Il tuo codice</p>
    <p style="margin:0 0 20px;font-family:monospace;font-size:24px;font-weight:700;letter-spacing:2px;color:${COLORI.marchio}">${escapeHtml(args.code)}</p>
    <p style="margin:0 0 12px;line-height:1.6">Accedi a MyCity, vai su <strong>Gift Card</strong> e inserisci il codice: il credito verrà aggiunto al tuo account.</p>
    <p style="margin:24px 0">${btn(redeemUrl, 'Riscatta ora')}</p>
    <p style="margin:0;font-size:13px;color:${COLORI.tenue}">La gift card è valida 2 anni dall'acquisto.</p>
  `;
  const dove = recapitoPrivacy();
  const doveTesto = dove.eUnaCasella ? dove.testo : `${appUrl()}${dove.href}`;
  return {
    subject: `🎁 ${fromGrezzo} ti ha regalato ${formatPrice(args.amountEuro)} su ${BRAND}`,
    html: shell('Hai ricevuto una gift card', body, piedeDelDestinatarioDelRegalo(from)),
    text:
      `${fromGrezzo} ti ha regalato una gift card MyCity da ${formatPrice(args.amountEuro)}. Codice: ${args.code}. ` +
      `Riscattalo su ${redeemUrl}\n\n` +
      `Hai ricevuto questa email perché ${fromGrezzo} ha comprato un buono regalo per te e ci ha lasciato il tuo indirizzo: ` +
      `non hai un account ${BRAND} e non ti abbiamo iscritto a nulla. Conserviamo nome, email e messaggio solo per ` +
      `recapitarti il regalo (${appUrl()}/privacy). Per farli cancellare subito: ${doveTesto}`,
  };
}

export function giftCardBuyerTemplate(args: { code: string; amountEuro: number; recipientName?: string | null }) {
  const url = `${appUrl()}/profile/gift-cards`;
  const toGrezzo = args.recipientName?.trim() ? args.recipientName.trim().replace(/[\r\n]+/g, ' ') : 'il destinatario';
  const to = escapeHtml(toGrezzo);
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Gift card acquistata ✓</h1>
    <p style="margin:0 0 12px;line-height:1.6">Grazie! La tua gift card da <strong>${formatPrice(args.amountEuro)}</strong> per <strong>${to}</strong> è pronta e gli abbiamo inviato il codice via email.</p>
    <p style="margin:0 0 8px;color:${COLORI.tenue}">Codice (in caso voglia condividerlo tu)</p>
    <p style="margin:0 0 20px;font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:${COLORI.marchio}">${escapeHtml(args.code)}</p>
    <p style="margin:24px 0">${btn(url, 'Le mie gift card')}</p>
  `;
  return {
    subject: `Gift card da ${formatPrice(args.amountEuro)} acquistata — ${BRAND}`,
    html: shell('Gift card acquistata', body),
    text: `Gift card da ${formatPrice(args.amountEuro)} acquistata per ${toGrezzo}. Codice: ${args.code}.`,
  };
}

// ---------- Ciclo di vita: i messaggi che spedisce il giro della coda ----------

/**
 * 27/8/2026 (R007) — I SEI TEMPLATE CHE VIVEVANO DENTRO UNA ROTTA.
 *
 * Stavano scritti a mano dentro `app/api/cron/send-emails/route.ts`: `<p>`
 * nudi, senza intestazione col marchio, senza piede, e con il nome dell'utente
 * interpolato grezzo dentro l'HTML. Erano un secondo elenco di template
 * parallelo a questo, e siccome e' il giro della coda a spedire il benvenuto,
 * il messaggio che la gente riceveva davvero era quello scritto peggio.
 *
 * Adesso stanno qui, e passano dalle stesse due cose di tutti gli altri:
 * l'impaginazione comune (`shell`) e il filtro sui campi scritti da qualcuno
 * (`escapeHtml`).
 */

/**
 * I dati che una riga della coda porta con se'.
 *
 * `name` viene dal profilo. Gli altri campi arrivano da `email_queue.metadata`,
 * che dal 30/8/2026 (R007) il trigger degli stati riempie per «ordine pronto» e
 * «ordine consegnato»: senza, quei due messaggi partirebbero vuoti — senza
 * numero d'ordine, senza indirizzo, senza codice di ritiro.
 */
export type DatiCicloDiVita = {
  name?: string | null;
  orderId?: string | null;
  pickupInStore?: boolean | null;
  storeName?: string | null;
  storeAddress?: string | null;
  pickupCode?: string | null;
  totalEuro?: number | null;
  /**
   * Cosa c'e' dentro il carrello lasciato indietro. I nomi li scrivono i
   * negozi, quindi sono testo di un altro: il template li filtra.
   * Il totale NON si passa apposta (vedi `abandoned_cart_4h`).
   */
  cartItems?: Array<{ name?: string | null; quantity?: number | null }> | null;
};
export type EmailPronta = { subject: string; html: string; text: string };

/**
 * 27/10/2026 — COME ARRIVA LA SPESA, detto nella guida del secondo giorno.
 *
 * La guida scriveva «oppure la ritiri tu se il negozio lo permette». Al lancio il ritiro in
 * negozio e' spento per tutti: `RITIRO_IN_NEGOZIO_ATTIVO` vale `false`, le due rotte che creano
 * l'ordine forzano `pickupInStore = false` e la cassa non mostra l'opzione. E nessun negozio ha
 * un'impostazione per «permetterlo». La mail parte a ogni nuovo cliente, anche senza consenso
 * alla pubblicita': ognuno cercava in cassa un'opzione che non c'e', e la frase dava la colpa
 * del no al negozio.
 *
 * Qui la frase NASCE dall'interruttore, come quelle di lib/promesse-pubbliche.ts: spento, il
 * ritiro non si nomina; acceso, si nomina senza condizioni, perche' oggi nessun negozio puo'
 * sceglierlo. Se un giorno il negozio potra' dire di no, la condizione torna insieme a quel dato.
 */
function comeArrivaLaSpesa(attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO): { riga: string; inBreve: string } {
  return attivo
    ? {
        riga: 'La spesa te la portiamo a casa, oppure la ritiri tu in negozio',
        inBreve: 'la spesa te la portiamo a casa (o la ritiri tu in negozio)',
      }
    : { riga: 'La spesa te la portiamo a casa', inBreve: 'la spesa te la portiamo a casa' };
}

const TEMPLATE_CICLO_DI_VITA = {
  welcome: (d: DatiCicloDiVita): EmailPronta => {
    // Il nome arriva da `profiles.full_name`: lo scrive la persona nel proprio
    // profilo, quindi e' testo di un altro e va filtrato.
    const nome = d.name?.trim();
    const saluto = nome ? `Ciao ${escapeHtml(nome)}, grazie` : 'Grazie';
    const body = `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:${COLORI.titolo}">Benvenuto su ${BRAND}</h1>
      <p style="margin:0 0 16px;line-height:1.6">${saluto} per esserti iscritto. Il marketplace dei negozi di Piacenza ti aspetta.</p>
      <p style="margin:24px 0">${btn(appUrl(), 'Inizia a esplorare')}</p>
    `;
    return {
      subject: `Benvenuto su ${BRAND} Piacenza 🎉`,
      html: shell('Benvenuto', body),
      text: nome
        ? `Ciao ${nome}, grazie per esserti iscritto a ${BRAND} Piacenza.`
        : `Grazie per esserti iscritto a ${BRAND} Piacenza.`,
    };
  },

  /**
   * 27/10/2026 — QUESTO MESSAGGIO PARTE ANCHE A CHI HA DETTO NO ALLA PUBBLICITA'.
   *
   * Sta in `TEMPLATE_DI_SERVIZIO`, quindi esce senza guardare `email_marketing`
   * e senza il piede di disiscrizione. Portava pero' «invita un amico, ricevi
   * €5 di credito» e la spedizione gratis sopra una soglia: incentivi
   * economici, cioe' pubblicita' (art. 130 Codice Privacy). E dal 26/10 al
   * lancio non c'e' nessun regalo in euro. Restano solo le tre cose che servono
   * per usare il servizio: come si paga, come arriva la spesa, dove si segue
   * l'ordine. Se un giorno torna un incentivo, va in un template commerciale.
   *
   * 27/10/2026 (notte) — Diceva anche «oppure la ritiri tu se il negozio lo permette», col ritiro
   * spento per tutti e nessun negozio che possa «permetterlo». Ora la frase su come arriva la
   * spesa nasce dall'interruttore (`comeArrivaLaSpesa`): spento, il ritiro non si nomina.
   */
  tutorial_day2: (): EmailPronta => {
    const comeArriva = comeArrivaLaSpesa();
    // 5/11/2026 — «la carta non è obbligatoria» faceva pensare alla carta alla porta, che non esiste.
    // La riga nasce dall'interruttore della cassa: a carta spenta si paga solo in contanti.
    const comePaghi = cartaAlCheckoutDisponibile()
      ? { riga: 'Paghi con la carta quando ordini, oppure in contanti alla consegna', inBreve: 'paghi con la carta o in contanti alla consegna' }
      : { riga: 'Paghi in contanti alla consegna: tieni pronto l’importo', inBreve: 'paghi in contanti alla consegna' };
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">3 cose da sapere</h1>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.8">
        <li>${comePaghi.riga}</li>
        <li>${comeArriva.riga}</li>
        <li>Ogni ordine e il suo stato li trovi in «I miei ordini»</li>
      </ul>
      <p style="margin:24px 0">${btn(appUrl(), `Vai su ${BRAND}`)}</p>
    `;
    return {
      subject: `3 cose da sapere su ${BRAND}`,
      html: shell('3 cose da sapere', body),
      text:
        `Tre cose da sapere: ${comePaghi.inBreve}, ${comeArriva.inBreve}, ` +
        'e ogni ordine col suo stato lo trovi in «I miei ordini».',
    };
  },

  /**
   * 27/10/2026 — «€5 DI BENVENUTO, LO SCONTO SI APPLICA DA SOLO ALLA CASSA».
   *
   * Non era vero: la cassa legge solo il credito, non i punti, e il credito
   * c'e' solo se la persona va da sola in Profilo → Punti e li converte. E dal
   * 26/10 la scelta firmata e' «nessun regalo in euro al lancio». Il messaggio
   * resta un invito al primo ordine, senza una cifra che in cassa non compare.
   */
  first_order_promo: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Il tuo primo ordine ti aspetta</h1>
      <p style="margin:0 0 16px;line-height:1.6">Scegli un negozio di Piacenza e ordina quello che ti serve: paghi alla consegna.</p>
      <p style="margin:24px 0">${btn(`${appUrl()}/search`, 'Vai ai negozi')}</p>
    `;
    return {
      subject: `Il tuo primo ordine su ${BRAND}`,
      html: shell('Il tuo primo ordine', body),
      text: `Il tuo primo ordine ti aspetta su ${BRAND}: scegli un negozio di Piacenza e paghi alla consegna. ${appUrl()}/search`,
    };
  },

  reengagement_14d: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Cosa succede in città</h1>
      <p style="margin:0 0 16px;line-height:1.6">Eventi e novità dai negozi di Piacenza.</p>
      <p style="margin:24px 0">${btn(`${appUrl()}/events`, 'Vedi gli eventi')}</p>
    `;
    return {
      subject: 'Cosa succede in città questa settimana',
      html: shell('Cosa succede in città', body),
      text: `Eventi della settimana su ${BRAND}.`,
    };
  },

  /**
   * 27/10/2026 — IL «CI MANCHI» COL CODICE CHE NON ESISTE.
   *
   * Partiva al sessantesimo giorno dall'iscrizione anche a chi ordina ogni
   * sabato («non ti vediamo da un po'»), e prometteva RITORNO10, un codice che
   * nessuna migrazione crea: in cassa «codice non valido» alla cliente migliore.
   * Senza codice e senza la frase falsa, resta un messaggio sulle novita' dei
   * negozi, vero per chiunque lo riceva. Lo sconto, se si fara', e' una scelta
   * di soldi di Nicola: va creato prima il codice, poi si scrive.
   */
  winback_60d: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Novità dai negozi di Piacenza</h1>
      <p style="margin:0 0 16px;line-height:1.6">Ecco cosa trovi oggi nei negozi di Piacenza su ${BRAND}.</p>
      <p style="margin:24px 0">${btn(`${appUrl()}/search`, 'Guarda i negozi')}</p>
    `;
    return {
      subject: `Novità dai negozi di Piacenza su ${BRAND}`,
      html: shell('Novita dai negozi', body),
      text: `Ecco cosa trovi oggi nei negozi di Piacenza su ${BRAND}: ${appUrl()}/search`,
    };
  },

  /**
   * 30/8/2026 (R007) — I DUE MOMENTI CHE MANCAVANO.
   *
   * Il cliente riceveva la conferma d'ordine e poi piu' niente: ne' quando la
   * spesa e' pronta, ne' quando e' stata consegnata. I due template erano gia'
   * scritti qui accanto e non li chiamava nessuno, perche' non c'era nessun
   * punto sul server dove agganciare l'invio — il passaggio di stato lo scrive
   * il browser del negoziante, e la consegna la chiudono due funzioni dentro il
   * database. Adesso la strada e' quella che il database usa gia' per le
   * notifiche: al cambio di stato un trigger (migrazione 150) scrive la riga in
   * coda, con dentro i dati che servono, e questo giro la spedisce.
   *
   * Senza `orderId` non si spedisce: un messaggio che dice «il tuo ordine e'
   * pronto» senza dire quale non serve a niente, e il link porterebbe nel vuoto.
   */
  order_ready: (d: DatiCicloDiVita): EmailPronta | null => {
    if (!d.orderId) return null;
    return orderReadyTemplate({
      orderId: d.orderId,
      pickupInStore: d.pickupInStore === true,
      storeName: d.storeName,
      storeAddress: d.storeAddress,
      pickupCode: d.pickupCode,
    });
  },

  order_delivered: (d: DatiCicloDiVita): EmailPronta | null => {
    if (!d.orderId) return null;
    return orderDeliveredTemplate({
      orderId: d.orderId,
      name: d.name,
      total: Number(d.totalEuro ?? 0),
    });
  },

  /**
   * 6/9/2026 — QUESTO MESSAGGIO AVEVA DUE CASE, E UNA DELLE DUE PARTIVA NUDA.
   *
   * Il cron dei carrelli (`app/api/cron/abandoned-carts`) si costruiva l'HTML a
   * mano: quattro paragrafi senza <html>, senza la testata col nome MyCity e
   * senza il piede coi link legali. Font e colori erano quelli di serie del
   * programma di posta. Le due versioni portavano lo stesso tag
   * «abandoned_cart_4h» e divergevano senza che nessuno se ne accorgesse: chi
   * lasciava il carrello riceveva l'unica email che non somigliava né al sito
   * né alle altre nostre.
   *
   * Adesso la casa e' una sola, questa. Il nome e la lista di cosa c'e' dentro
   * arrivano da fuori, cosi' il cron non ha piu' niente da scrivere da solo.
   *
   * IL TOTALE NON SI SCRIVE, ed e' voluto: `cart_total` e' la fotografia del
   * carrello al momento in cui e' stato lasciato: se il negozio ha ritoccato un
   * prezzo, o una promozione e' partita o finita, quella cifra non esiste piu'.
   * Il totale vero lo dice il carrello, che lo rilegge dal database.
   */
  abandoned_cart_4h: (d: DatiCicloDiVita): EmailPronta => {
    const articoli = (d.cartItems ?? []).slice(0, 5);
    const righe = articoli
      .map((i) => `<li>${i.quantity ?? 1}× ${escapeHtml(i.name ?? 'Prodotto')}</li>`)
      .join('');
    const inChiaro = articoli
      .map((i) => `${i.quantity ?? 1}× ${(i.name ?? 'Prodotto').trim()}`)
      .join(', ');
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:${COLORI.titolo}">Il tuo carrello ti aspetta</h1>
      <p style="margin:0 0 16px;line-height:1.6">${saluto(d.name)}</p>
      <p style="margin:0 0 16px;line-height:1.6">Hai lasciato qualcosa nel carrello: è ancora lì.</p>
      ${righe ? `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.8">${righe}</ul>` : ''}
      <p style="margin:24px 0">${btn(`${appUrl()}/cart`, 'Vai al carrello')}</p>
      <p style="margin:0;line-height:1.6;color:${COLORI.tenue}">Se hai cambiato idea, ignora questa email: non ti scriveremo più per questo carrello.</p>
    `;
    return {
      subject: 'Hai dimenticato qualcosa nel carrello',
      html: shell('Il tuo carrello ti aspetta', body),
      text: inChiaro
        ? `Il tuo carrello ti aspetta su ${BRAND}: ${inChiaro}. Vai su ${appUrl()}/cart.`
        : `Il tuo carrello ti aspetta su ${BRAND}. Vai su ${appUrl()}/cart.`,
    };
  },
} satisfies Record<string, (d: DatiCicloDiVita) => EmailPronta | null>;

export type NomeTemplateCicloDiVita = keyof typeof TEMPLATE_CICLO_DI_VITA;

/**
 * Tutti i nomi dei messaggi del ciclo di vita, letti dall'oggetto e non scritti a mano: servono a
 * chi deve controllarli TUTTI (la prova che a ritiro spento nessuna email nomina il ritiro). Un
 * elenco a mano dimenticherebbe il prossimo template che si aggiunge.
 */
export const NOMI_TEMPLATE_CICLO_DI_VITA: readonly NomeTemplateCicloDiVita[] = Object.freeze(
  Object.keys(TEMPLATE_CICLO_DI_VITA) as NomeTemplateCicloDiVita[],
);

/**
 * Prepara il messaggio del ciclo di vita che porta questo nome, o `null` se il
 * nome non e' uno dei nostri.
 *
 * Il nome arriva da una riga della coda, cioe' da un dato: cercarlo con la
 * parentesi quadra su un oggetto trovava anche `constructor` e `__proto__`, e
 * lasciava passare per «template» una funzione qualsiasi. Il giro moriva alla
 * riga dopo, portandosi dietro le email buone dello stesso lotto.
 */
export function preparaEmailCicloDiVita(nome: string, dati: DatiCicloDiVita): EmailPronta | null {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_CICLO_DI_VITA, nome)) return null;
  return TEMPLATE_CICLO_DI_VITA[nome as NomeTemplateCicloDiVita](dati) ?? null;
}

/**
 * 30/8/2026 (R007) — I messaggi che riguardano UN ORDINE DELLA PERSONA, non le
 * nostre offerte: partono anche a chi ha detto no al marketing. E' il suo
 * ordine; trattarli come pubblicita' vorrebbe dire che chi rifiuta le
 * promozioni smette di sapere quando la sua spesa e' pronta.
 *
 * Vive qui, accanto ai template, e non dentro la rotta del cron: e' il posto
 * dove si aggiunge un template, quindi e' il posto dove ci si ricorda di dire
 * di che natura e'.
 */
export const TEMPLATE_DI_SERVIZIO: ReadonlySet<string> = new Set([
  'welcome',
  'tutorial_day2',
  'order_ready',
  'order_delivered',
]);
