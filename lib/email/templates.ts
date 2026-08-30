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

export function orderReadyTemplate(args: { orderId: string; pickupCode: string; storeAddress: string }) {
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">📦 Ordine pronto per il pickup</h1>
    <p style="margin:0 0 12px;line-height:1.6">Un ordine ti aspetta in negozio. Indirizzo: <strong>${escapeHtml(args.storeAddress)}</strong>.</p>
    <p style="margin:0 0 12px;line-height:1.6">Codice ritiro: <span style="font-family:monospace;font-size:18px;font-weight:700">${escapeHtml(args.pickupCode)}</span></p>
    <p style="margin:24px 0">${btn(`${appUrl()}/rider/orders/${args.orderId}`, 'Apri ordine')}</p>
  `;
  return {
    subject: `📦 Ordine pronto — pickup richiesto`,
    html: shell('Ordine pronto', body),
    text: `Ordine pronto al pickup. Codice ${args.pickupCode}. ${appUrl()}/rider/orders/${args.orderId}`,
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

export function passwordResetTemplate(args: { resetUrl: string }) {
  const body = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a">Reset password</h1>
    <p style="margin:0 0 12px;line-height:1.6">Per impostare una nuova password clicca qui sotto (link valido 1 ora):</p>
    <p style="margin:24px 0">${btn(args.resetUrl, 'Reimposta password')}</p>
    <p style="margin:0;font-size:13px;color:#64748b">Se non hai richiesto il reset ignora questa email.</p>
  `;
  return {
    subject: `Reset password — ${BRAND}`,
    html: shell('Reset password', body),
    text: `Reset password: ${args.resetUrl}`,
  };
}

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
  return {
    subject: `🎁 ${from} ti ha regalato €${args.amountEuro.toFixed(2)} su ${BRAND}`,
    html: shell('Hai ricevuto una gift card', body),
    text: `${from} ti ha regalato una gift card MyCity da €${args.amountEuro.toFixed(2)}. Codice: ${args.code}. Riscattalo su ${redeemUrl}`,
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

export type DatiCicloDiVita = { name?: string | null };
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
        <li>Invita un amico: €5 a testa</li>
      </ul>
      <p style="margin:24px 0">${btn(appUrl(), `Vai su ${BRAND}`)}</p>
    `;
    return {
      subject: `3 cose da sapere su ${BRAND}`,
      html: shell('3 cose da sapere', body),
      text: 'Tre cose da sapere: paghi alla consegna, spedizione gratis sopra €30, referral €5.',
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
} satisfies Record<string, (d: DatiCicloDiVita) => EmailPronta>;

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
  return TEMPLATE_CICLO_DI_VITA[nome as NomeTemplateCicloDiVita](dati);
}
