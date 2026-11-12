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
 */
export async function avvisaSeLaPostaNonParte(
  cosa: string,
  dati: Record<string, unknown>,
  esito: unknown,
): Promise<void> {
  const e = esito as { ok?: unknown; skipped?: unknown; error?: unknown } | null | undefined;
  if (!e || typeof e !== 'object' || e.ok !== false || e.skipped === true) return;
  const errore = typeof e.error === 'string' ? e.error : 'errore';
  logger.error(`[email] ${cosa} non partita: destinatario non avvisato`, { ...dati, errore });
  const riferimento = String(dati.orderId ?? dati.ordine ?? dati.pendingCheckoutId ?? dati.payoutId ?? dati.sessionId ?? 'senza-riferimento');
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
