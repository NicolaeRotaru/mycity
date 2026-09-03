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

import { env } from '@/lib/env';
// 27/8/2026 (R011) — Il filtro dell'HTML era riscritto qui dentro, uguale ma
// scritto in un altro modo, mentre `lib/html-escape.ts` dichiarava nel proprio
// commento di essere quella condivisa. Tre copie della stessa regola sono tre
// regole: il giorno in cui va aggiunto un carattere da filtrare, due restano
// indietro — e restano indietro senza dirlo a nessuno.
import { escapeHtml } from '@/lib/html-escape';
import { recapitoPrivacy } from '@/lib/legal/titolare';

const BRAND = 'MyCity';
const BRAND_COLOR = '#4f46e5';

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
<body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="padding:24px 32px;background:${BRAND_COLOR};color:#ffffff">
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.01em">${BRAND}</div>
      </td></tr>
      <tr><td style="padding:32px">
        ${body}
      </td></tr>
      <tr><td style="padding:24px 32px;background:#f1f5f9;color:#64748b;font-size:12px;line-height:1.5">
        ${footer ?? `Hai ricevuto questa email perché hai un account su ${BRAND}. <br>
        <a href="${appUrl()}/profile/settings" style="color:${BRAND_COLOR}">Gestisci preferenze</a> ·
        <a href="${appUrl()}/privacy" style="color:${BRAND_COLOR}">Privacy</a> ·
        <a href="${appUrl()}/cookies" style="color:${BRAND_COLOR}">Cookie</a>`}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a>`;
}

// ---------- Template specifici ----------

export function orderConfirmedBuyerTemplate(args: { name?: string | null; orderId: string; total: number; storeName: string }) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">Ordine ricevuto</h1>
    <p style="margin:0 0 12px;line-height:1.6">Ciao ${escapeHtml(args.name ?? '')}, abbiamo ricevuto il tuo ordine da <strong>${escapeHtml(args.storeName)}</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0">
      <tr><td style="padding:8px 0;color:#64748b">Ordine</td><td style="padding:8px 0;text-align:right;font-family:monospace">#${escapeHtml(args.orderId.slice(0, 8))}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Totale</td><td style="padding:8px 0;text-align:right;font-weight:600">€${args.total.toFixed(2)}</td></tr>
    </table>
    <p style="margin:24px 0">${btn(orderUrl, 'Vedi ordine')}</p>
    <p style="margin:0;font-size:13px;color:#64748b">Riceverai aggiornamenti quando il negozio prepara e il rider ritira l'ordine.</p>
  `;
  return {
    subject: `Ordine #${args.orderId.slice(0, 8)} ricevuto — ${BRAND}`,
    html: shell('Ordine ricevuto', body),
    text: `Ordine ricevuto. Totale €${args.total.toFixed(2)}. Dettaglio: ${orderUrl}`,
  };
}

export function newOrderSellerTemplate(args: { sellerName?: string | null; orderId: string; total: number; itemsCount: number }) {
  const orderUrl = `${appUrl()}/seller/orders/${args.orderId}`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">🛒 Nuovo ordine</h1>
    <p style="margin:0 0 12px;line-height:1.6">Hai ricevuto un nuovo ordine di ${args.itemsCount} articol${args.itemsCount === 1 ? 'o' : 'i'} per <strong>€${args.total.toFixed(2)}</strong>.</p>
    <p style="margin:0 0 12px;line-height:1.6;color:#dc2626;font-weight:600">Accetta o rifiuta l'ordine entro 15 minuti.</p>
    <p style="margin:24px 0">${btn(orderUrl, 'Gestisci ordine')}</p>
  `;
  return {
    subject: `🛒 Nuovo ordine — €${args.total.toFixed(2)}`,
    html: shell('Nuovo ordine', body),
    text: `Nuovo ordine per €${args.total.toFixed(2)}. Gestiscilo qui: ${orderUrl}`,
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
    <p style="margin:0 0 12px;line-height:1.6">Il tuo ordine e&#39; pronto: puoi passare a ritirarlo${negozio ? ` da <strong>${escapeHtml(negozio)}</strong>` : ''}.</p>
    ${dove ? `<p style="margin:0 0 12px;line-height:1.6">Indirizzo: <strong>${escapeHtml(dove)}</strong></p>` : ''}
    ${codice ? `<p style="margin:0 0 12px;line-height:1.6">Mostra questo codice al negozio: <span style="font-family:monospace;font-size:18px;font-weight:700">${escapeHtml(codice)}</span></p>` : ''}
  `;
  const corpoConsegna = `
    <p style="margin:0 0 12px;line-height:1.6">Il tuo ordine e&#39; pronto${negozio ? ` da <strong>${escapeHtml(negozio)}</strong>` : ''}: un rider lo ritira a breve e te lo porta a casa.</p>
    <p style="margin:0 0 12px;line-height:1.6">Ti avvisiamo appena parte. Il codice che il fattorino ti chiedera&#39; alla consegna lo trovi nella pagina dell&#39;ordine.</p>
  `;

  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">📦 Il tuo ordine e&#39; pronto</h1>
    ${args.pickupInStore ? corpoRitiro : corpoConsegna}
    <p style="margin:24px 0">${btn(orderUrl, 'Vedi l&#39;ordine')}</p>
  `;
  return {
    subject: args.pickupInStore
      ? '📦 Il tuo ordine ti aspetta in negozio'
      : '📦 Il tuo ordine e\' pronto',
    html: shell('Ordine pronto', body),
    text: args.pickupInStore
      ? `Il tuo ordine e' pronto${dove ? ` da ritirare in ${dove}` : ''}.${codice ? ` Mostra il codice ${codice}.` : ''} ${orderUrl}`
      : `Il tuo ordine e' pronto: un rider lo ritira a breve. ${orderUrl}`,
  };
}

export function orderDeliveredTemplate(args: { orderId: string; name?: string | null; total: number }) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#059669">✅ Ordine consegnato</h1>
    <p style="margin:0 0 12px;line-height:1.6">Ciao ${escapeHtml(args.name ?? '')}, il tuo ordine è stato consegnato.</p>
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

export function refundIssuedTemplate(args: { orderId: string; amount: number; reason?: string | null }) {
  const orderUrl = `${appUrl()}/orders/${args.orderId}`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">💶 Rimborso emesso</h1>
    <p style="margin:0 0 12px;line-height:1.6">Abbiamo emesso un rimborso di <strong>€${args.amount.toFixed(2)}</strong> sul tuo ordine.</p>
    ${args.reason ? `<p style="margin:0 0 12px;color:#64748b">Motivo: ${escapeHtml(args.reason)}</p>` : ''}
    <p style="margin:0 0 12px;line-height:1.6">Il rimborso arriverà sul tuo metodo di pagamento entro 5-10 giorni lavorativi.</p>
    <p style="margin:24px 0">${btn(orderUrl, 'Vedi dettaglio')}</p>
  `;
  return {
    subject: `💶 Rimborso emesso — €${args.amount.toFixed(2)}`,
    html: shell('Rimborso emesso', body),
    text: `Rimborso di €${args.amount.toFixed(2)} emesso. Dettaglio: ${orderUrl}`,
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
    <a href="${appUrl()}/privacy" style="color:${BRAND_COLOR}">Come trattiamo i tuoi dati</a> ·
    per farli cancellare subito scrivi a
    <a href="${link}" style="color:${BRAND_COLOR}">${escapeHtml(dove.testo)}</a>.`;
}

export function giftCardRecipientTemplate(args: { code: string; amountEuro: number; senderName?: string | null; message?: string | null }) {
  const redeemUrl = `${appUrl()}/profile/gift-cards`;
  const from = args.senderName?.trim() ? escapeHtml(args.senderName.trim()) : 'Qualcuno';
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">🎁 Hai ricevuto una gift card</h1>
    <p style="margin:0 0 12px;line-height:1.6"><strong>${from}</strong> ti ha regalato una gift card MyCity da <strong>€${args.amountEuro.toFixed(2)}</strong>, spendibile nei negozi di Piacenza.</p>
    ${args.message?.trim() ? `<p style="margin:0 0 16px;padding:12px 16px;background:#f1f5f9;border-radius:8px;font-style:italic;color:#334155">«${escapeHtml(args.message.trim())}»</p>` : ''}
    <p style="margin:0 0 8px;color:#64748b">Il tuo codice</p>
    <p style="margin:0 0 20px;font-family:monospace;font-size:24px;font-weight:700;letter-spacing:2px;color:${BRAND_COLOR}">${escapeHtml(args.code)}</p>
    <p style="margin:0 0 12px;line-height:1.6">Accedi a MyCity, vai su <strong>Gift Card</strong> e inserisci il codice: il credito verrà aggiunto al tuo account.</p>
    <p style="margin:24px 0">${btn(redeemUrl, 'Riscatta ora')}</p>
    <p style="margin:0;font-size:13px;color:#64748b">La gift card è valida 2 anni dall'acquisto.</p>
  `;
  const dove = recapitoPrivacy();
  const doveTesto = dove.eUnaCasella ? dove.testo : `${appUrl()}${dove.href}`;
  return {
    subject: `🎁 ${from} ti ha regalato €${args.amountEuro.toFixed(2)} su ${BRAND}`,
    html: shell('Hai ricevuto una gift card', body, piedeDelDestinatarioDelRegalo(from)),
    text:
      `${from} ti ha regalato una gift card MyCity da €${args.amountEuro.toFixed(2)}. Codice: ${args.code}. ` +
      `Riscattalo su ${redeemUrl}\n\n` +
      `Hai ricevuto questa email perché ${from} ha comprato un buono regalo per te e ci ha lasciato il tuo indirizzo: ` +
      `non hai un account ${BRAND} e non ti abbiamo iscritto a nulla. Conserviamo nome, email e messaggio solo per ` +
      `recapitarti il regalo (${appUrl()}/privacy). Per farli cancellare subito: ${doveTesto}`,
  };
}

export function giftCardBuyerTemplate(args: { code: string; amountEuro: number; recipientName?: string | null }) {
  const url = `${appUrl()}/profile/gift-cards`;
  const to = args.recipientName?.trim() ? escapeHtml(args.recipientName.trim()) : 'il destinatario';
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">Gift card acquistata ✓</h1>
    <p style="margin:0 0 12px;line-height:1.6">Grazie! La tua gift card da <strong>€${args.amountEuro.toFixed(2)}</strong> per <strong>${to}</strong> è pronta e gli abbiamo inviato il codice via email.</p>
    <p style="margin:0 0 8px;color:#64748b">Codice (in caso voglia condividerlo tu)</p>
    <p style="margin:0 0 20px;font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:${BRAND_COLOR}">${escapeHtml(args.code)}</p>
    <p style="margin:24px 0">${btn(url, 'Le mie gift card')}</p>
  `;
  return {
    subject: `Gift card da €${args.amountEuro.toFixed(2)} acquistata — ${BRAND}`,
    html: shell('Gift card acquistata', body),
    text: `Gift card da €${args.amountEuro.toFixed(2)} acquistata per ${to}. Codice: ${args.code}.`,
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
};
export type EmailPronta = { subject: string; html: string; text: string };

const TEMPLATE_CICLO_DI_VITA = {
  welcome: (d: DatiCicloDiVita): EmailPronta => {
    // Il nome arriva da `profiles.full_name`: lo scrive la persona nel proprio
    // profilo, quindi e' testo di un altro e va filtrato.
    const nome = d.name?.trim();
    const saluto = nome ? `Ciao ${escapeHtml(nome)}, grazie` : 'Grazie';
    const body = `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a">Benvenuto su ${BRAND}</h1>
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

  tutorial_day2: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">3 cose da sapere</h1>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.8">
        <li>Paghi alla consegna: la carta non e' obbligatoria</li>
        <li>Spedizione gratis sopra €30</li>
        <li>Invita un amico: quando riceve il primo ordine, tu ricevi €5 di credito</li>
      </ul>
      <p style="margin:24px 0">${btn(appUrl(), `Vai su ${BRAND}`)}</p>
    `;
    return {
      subject: `3 cose da sapere su ${BRAND}`,
      html: shell('3 cose da sapere', body),
      text: 'Tre cose da sapere: paghi alla consegna, spedizione gratis sopra €30, e se inviti un amico ricevi €5 di credito quando lui riceve il primo ordine.',
    };
  },

  first_order_promo: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">Hai €5 di benvenuto</h1>
      <p style="margin:0 0 16px;line-height:1.6">Usali al primo ordine: lo sconto si applica da solo alla cassa.</p>
      <p style="margin:24px 0">${btn(`${appUrl()}/search`, 'Vai allo shopping')}</p>
    `;
    return {
      subject: 'Sblocca €5 al primo ordine',
      html: shell('€5 al primo ordine', body),
      text: `Hai €5 di sconto al primo ordine. Usali su ${BRAND}.`,
    };
  },

  reengagement_14d: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">Cosa succede in citta</h1>
      <p style="margin:0 0 16px;line-height:1.6">Eventi, novita dai negozi e gli sconti del momento.</p>
      <p style="margin:24px 0">${btn(`${appUrl()}/events`, 'Vedi gli eventi')}</p>
    `;
    return {
      subject: 'Cosa succede in città questa settimana',
      html: shell('Cosa succede in citta', body),
      text: `Eventi della settimana su ${BRAND}.`,
    };
  },

  winback_60d: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">Ci manchi</h1>
      <p style="margin:0 0 16px;line-height:1.6">Non ti vediamo da un po'. Usa il codice <strong>RITORNO10</strong> per il -10% sul prossimo ordine.</p>
      <p style="margin:24px 0">${btn(`${appUrl()}/search`, 'Torna a fare la spesa')}</p>
    `;
    return {
      subject: 'Ci manchi! Torna con uno sconto',
      html: shell('Ci manchi', body),
      text: 'Codice RITORNO10 per -10% sul prossimo ordine.',
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

  abandoned_cart_4h: (): EmailPronta => {
    const body = `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">Il tuo carrello ti aspetta</h1>
      <p style="margin:0 0 16px;line-height:1.6">Hai lasciato qualcosa nel carrello: e' ancora li'.</p>
      <p style="margin:24px 0">${btn(`${appUrl()}/cart`, 'Vai al carrello')}</p>
    `;
    return {
      subject: 'Hai dimenticato qualcosa nel carrello',
      html: shell('Il tuo carrello ti aspetta', body),
      text: `Il tuo carrello ti aspetta su ${BRAND}.`,
    };
  },
} satisfies Record<string, (d: DatiCicloDiVita) => EmailPronta | null>;

export type NomeTemplateCicloDiVita = keyof typeof TEMPLATE_CICLO_DI_VITA;

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
