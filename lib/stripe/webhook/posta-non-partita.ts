import { logger } from '@/lib/logger';
import { notifyAdmins } from './comune';

/**
 * 12/11/2026 (R03-003) — UN'EMAIL RIFIUTATA NON E' UN'EMAIL PARTITA.
 *
 * `sendEmail` non lancia mai: quando Resend rifiuta (quota superata, chiave revocata, dominio
 * non più verificato) o la rete cade risponde `{ ok: false, error }`. I ripari intorno agli
 * invii (`provaAMandare` qui, il `try` della cassa in contanti) guardavano solo le eccezioni:
 * nessun negozio riceveva «Nuovo ordine», il sito diceva «ordine fatto» e nei log restava una
 * riga senza numero d'ordine. Adesso l'esito si legge: su `ok:false` (non `skipped`, cioè la
 * posta spenta per configurazione, che guarda già /api/health) si scrive l'errore con l'ordine
 * e parte un avviso agli amministratori, una volta per invio. Non lancia mai.
 *
 * 27/11/2026 — LA POSTA SPENTA AVVISA ANCHE SULLA STRADA DELLA CARTA.
 *
 * Il `skipped` per chiave o mittente mancanti (RESEND_API_KEY, RESEND_FROM) saltava qui ogni
 * avviso: la strada dei contanti suonava la campanella «la posta del sito è spenta», quella della
 * carta (webhook di Stripe: conferma al cliente, «Nuovo ordine» al negozio, rimborsi, buoni) no.
 * Adesso, sul sito vero, parte la stessa campanella, una volta per ordine: con la stessa chiave
 * della strada dei contanti (`posta-spenta:<ordine>`), così lo stesso ordine non suona due volte.
 * In anteprima e in locale la posta può mancare apposta: nessuna campanella.
 */
export async function avvisaSeLaPostaNonParte(
  cosa: string,
  dati: Record<string, unknown>,
  esito: unknown,
): Promise<void> {
  const e = esito as { ok?: unknown; skipped?: unknown; error?: unknown; reason?: unknown } | null | undefined;
  if (!e || typeof e !== 'object' || e.ok !== false) return;
  if (e.skipped === true) {
    await avvisaSeLaPostaESpenta(cosa, dati, typeof e.reason === 'string' ? e.reason : '');
    return;
  }
  const errore = typeof e.error === 'string' ? e.error : 'errore';
  logger.error(`[email] ${cosa} non partita: destinatario non avvisato`, { ...dati, errore });
  const riferimento = riferimentoDi(dati);
  try {
    await notifyAdmins(
      '📭 Email non partita',
      `${cosa[0].toUpperCase()}${cosa.slice(1)} non è partita` +
        (dati.orderId ? ` (ordine #${String(dati.orderId).slice(0, 8)})` : '') +
        `: il servizio di posta ha risposto «${errore.slice(0, 120)}». Avvisa tu il destinatario.`,
      dati.orderId ? `/admin/orders` : '/admin',
      { unaVoltaPer: `posta-non-partita:${cosa}:${riferimento}` },
    );
  } catch (err) {
    logger.error('[email] avviso della posta non partita non inviato', { ...dati, cosa, err });
  }
}

function riferimentoDi(dati: Record<string, unknown>): string {
  return String(dati.orderId ?? dati.ordine ?? dati.pendingCheckoutId ?? dati.payoutId ?? dati.sessionId ?? 'senza-riferimento');
}

/** La campanella della posta spenta (chiave o mittente mancanti), solo sul sito vero. Non lancia mai. */
async function avvisaSeLaPostaESpenta(cosa: string, dati: Record<string, unknown>, motivo: string): Promise<void> {
  if (process.env.VERCEL_ENV !== 'production') return;
  if (!/RESEND_(API_KEY|FROM)/.test(motivo)) return;
  const ordine = dati.orderId ? String(dati.orderId) : null;
  const Cosa = `${cosa[0].toUpperCase()}${cosa.slice(1)}`;
  try {
    await notifyAdmins(
      '📭 Email non partita: la posta del sito è spenta',
      ordine
        ? `L'ordine #${ordine.slice(0, 8)} è nato, ma la posta non è partita (${motivo}): ${cosa} non è arrivata. ` +
            'Avvisa tu il negozio e il cliente; la posta si riaccende mettendo la variabile su Vercel (Production).'
        : `${Cosa} non è partita: la posta del sito è spenta (${motivo}). ` +
            'Avvisa tu il destinatario; la posta si riaccende mettendo la variabile su Vercel (Production).',
      ordine ? `/admin/orders/${ordine}` : '/admin',
      { unaVoltaPer: ordine ? `posta-spenta:${ordine}` : `posta-spenta:${cosa}:${riferimentoDi(dati)}` },
    );
  } catch (err) {
    logger.error('[email] campanella della posta spenta non partita', { ...dati, cosa, err });
  }
}
