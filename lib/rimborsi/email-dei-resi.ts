import { escapeHtml } from '@/lib/html-escape';
import { env } from '@/lib/env';

/**
 * 5/11/2026 — LE EMAIL DEI RESI.
 *
 * Il nuovo reso arrivava al negozio solo come campanella (che si vede solo
 * riaprendo il sito), e al cliente a cui il reso veniva rifiutato non arrivava
 * nessuna email: leggeva «✕ Reso rifiutato», senza motivo se il negozio non
 * l'aveva scritto. Il reso ferma anche il bonifico dell'ordine: va saputo
 * subito, non dopo i 7 giorni dell'allarme RESO_FERMO.
 */
const MOTIVI: Record<string, string> = {
  DAMAGED: 'prodotto danneggiato',
  WRONG_ITEM: 'prodotto sbagliato',
  NOT_AS_DESCRIBED: 'non come descritto',
  CHANGED_MIND: 'ripensamento (recesso)',
  LATE: 'consegna in ritardo',
  OTHER: 'altro',
};
const numero = (id: string) => `#${id.slice(0, 8)}`;
const base = () => env.appUrl().replace(/\/$/, '');
const p = (t: string) => `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(t)}</p>`;

export function resoRichiestoAlNegozioTemplate(a: { orderId: string; motivo: string }) {
  const link = `${base()}/seller/orders/${a.orderId}`;
  const righe = [
    `Il cliente ha chiesto il reso per l'ordine ${numero(a.orderId)}. Motivo: ${MOTIVI[a.motivo] ?? a.motivo}.`,
    'Aprilo dal pannello per approvarlo o rifiutarlo: finché il reso è aperto il bonifico di quell\'ordine resta fermo.',
  ];
  return {
    subject: `↩️ Nuova richiesta di reso per l'ordine ${numero(a.orderId)}`,
    html: `${righe.map(p).join('')}<p style="margin:24px 0"><a href="${escapeHtml(link)}">Apri l'ordine</a></p>`,
    text: `${righe.join(' ')} ${link}`,
  };
}

export function resoRifiutatoAlClienteTemplate(a: { orderId: string; nota?: string | null }) {
  const link = `${base()}/orders/${a.orderId}`;
  const nota = (a.nota ?? '').trim();
  const righe = [
    `Il negozio ha rifiutato la richiesta di reso per l'ordine ${numero(a.orderId)}.`,
    nota
      ? `Il motivo che ha scritto: «${nota}».`
      : 'Il negozio non ha scritto un motivo: se non ti è chiaro perché, rispondi a questa email o scrivi all\'assistenza.',
  ];
  return {
    subject: `Reso rifiutato per l'ordine ${numero(a.orderId)}`,
    html: `${righe.map(p).join('')}<p style="margin:24px 0"><a href="${escapeHtml(link)}">Apri l'ordine</a></p>`,
    text: `${righe.join(' ')} ${link}`,
  };
}
