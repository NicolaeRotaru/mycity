/**
 * Template HTML/testo per le email transazionali.
 *
 * Tutti i template sono semplici (inline CSS, no immagini esterne)
 * per massimizzare la deliverability. Lingua italiana hardcoded; in
 * fase i18n diventeranno funzioni che ricevono il locale.
 *
 * Tutti i template includono il link di unsubscribe (obbligatorio
 * GDPR per email marketing; per le transazionali e' best practice).
 */

import { env } from '@/lib/env';

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

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

// ---------- Template specifici ----------

export function welcomeTemplate(args: { name?: string | null; confirmUrl: string }) {
  const name = args.name?.trim() || 'ciao';
  const body = `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a">Benvenuto, ${escapeHtml(name)}!</h1>
    <p style="margin:0 0 16px;line-height:1.6">Conferma la tua email per attivare l'account su <strong>${BRAND}</strong>:</p>
    <p style="margin:24px 0">${btn(args.confirmUrl, 'Conferma email')}</p>
    <p style="margin:0;font-size:13px;color:#64748b">Se non riconosci questa registrazione ignora pure questa email.</p>
  `;
  return {
    subject: `Conferma la tua email su ${BRAND}`,
    html: shell('Conferma email', body),
    text: `Conferma la tua email cliccando: ${args.confirmUrl}`,
  };
}

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
