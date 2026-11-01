import { sendEmail } from '@/lib/email/client';
import { messaggioNuovoAlNegozioTemplate } from '@/lib/email/templates';
import { logger } from '@/lib/logger';

/**
 * 1/11/2026 — IL CLIENTE SCRIVE AL NEGOZIO, E IL NEGOZIO LO SA.
 *
 * Prima il messaggio entrava nella tabella `messages` e basta: il negozio lo
 * vedeva solo se apriva la chat da solo. Questa funzione gli manda un'email.
 *
 * UN AVVISO PER CONVERSAZIONE, NON UNO PER MESSAGGIO. Le regole, con i dati che
 * esistono gia' (migrazione 026, niente colonne nuove):
 *  ① scrive il CLIENTE (`buyer_id` della conversazione). Quando scrive il
 *    negozio non si avvisa nessuno da qui;
 *  ② e' il PRIMO messaggio del cliente che il negozio non ha ancora letto:
 *    fra i messaggi del cliente con `read_at` vuoto c'e' solo questo. Se ce
 *    n'e' gia' un altro non letto, l'avviso e' gia' partito con quello: il
 *    cliente che manda cinque messaggi di fila fa partire UNA email. Quando il
 *    negozio apre la chat, /api/chat/mark-read scrive `read_at` e il giro
 *    ricomincia;
 *  ③ il negozio non ha scritto in questa chat negli ultimi 15 minuti: se sta
 *    rispondendo adesso, e' gia' davanti alla chat e l'email sarebbe rumore.
 *
 * Perche' `read_at` e non `seller_unread_count`: e' lo stesso segno (lo scrive
 * mark-read insieme), ma sta sul messaggio, quindi non dipende dal trigger che
 * aggiorna il contatore.
 *
 * Nell'email NIENTE testo del messaggio (vedi `messaggioNuovoAlNegozioTemplate`).
 * E' una email di servizio: il negozio non si e' iscritto a una promozione, gli
 * ha scritto un cliente. Esce senza il piede «annulla l'iscrizione» come «nuovo
 * ordine»; oggi non esiste una preferenza «avvisi della chat» da rispettare.
 *
 * Non lancia mai: un avviso che non parte non deve far fallire l'invio del
 * messaggio. Dice sempre perche' non e' partito.
 *
 * LIMITE DICHIARATO: due messaggi del cliente salvati nello stesso istante
 * possono vedersi a vicenda (nessuna email) o non vedersi (due email). Per una
 * persona che scrive a mano e' raro; chiuderlo davvero vuole un segno atomico
 * nel database (una colonna «avvisato alle» sulla conversazione: migrazione).
 *
 * Va chiamata con il client di servizio (`getAdminSupabase()`): serve leggere
 * l'indirizzo del negozio dall'autenticazione.
 */

export const FINESTRA_NEGOZIO_IN_CHAT_MIN = 15;

export type EsitoAvvisoNegozio =
  | { inviato: true }
  | {
      inviato: false;
      motivo:
        | 'conversazione-non-letta'
        | 'scrive-il-negozio'
        | 'gia-avvisato'
        | 'negozio-in-chat'
        | 'indirizzo-non-letto'
        | 'posta-non-pronta'
        | 'invio-fallito';
    };

type Errore = { message?: string } | null;

// Acceptable any: client Supabase senza Database type, come nel giro della coda.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function avvisaNegozioMessaggioNuovo(
  admin: any,
  args: { conversationId: string; senderId: string },
  adesso: Date = new Date(),
): Promise<EsitoAvvisoNegozio> {
  const { conversationId, senderId } = args;
  try {
    const { data: conv, error: errConv } = (await admin
      .from('conversations')
      .select('buyer_id, seller_id')
      .eq('id', conversationId)
      .maybeSingle()) as { data: { buyer_id: string; seller_id: string } | null; error: Errore };
    if (errConv || !conv) {
      logger.warn('[chat] avviso al negozio non partito: conversazione non letta', {
        conversationId, message: errConv?.message,
      });
      return { inviato: false, motivo: 'conversazione-non-letta' };
    }
    if (senderId !== conv.buyer_id) return { inviato: false, motivo: 'scrive-il-negozio' };

    const { count: nonLetti, error: errNL } = (await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('sender_id', conv.buyer_id)
      .is('read_at', null)) as { count: number | null; error: Errore };
    if (errNL) {
      // Non si sa se l'avviso e' gia' partito: meglio nessuna email che una ogni messaggio.
      logger.warn('[chat] avviso al negozio non partito: messaggi non letti non contati', {
        conversationId, message: errNL.message,
      });
      return { inviato: false, motivo: 'conversazione-non-letta' };
    }
    if ((nonLetti ?? 0) !== 1) return { inviato: false, motivo: 'gia-avvisato' };

    const da = new Date(adesso.getTime() - FINESTRA_NEGOZIO_IN_CHAT_MIN * 60_000).toISOString();
    const { count: delNegozio, error: errN } = (await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('sender_id', conv.seller_id)
      .gte('created_at', da)) as { count: number | null; error: Errore };
    if (errN) {
      logger.warn('[chat] avviso al negozio non partito: risposte del negozio non lette', {
        conversationId, message: errN.message,
      });
      return { inviato: false, motivo: 'conversazione-non-letta' };
    }
    if ((delNegozio ?? 0) > 0) return { inviato: false, motivo: 'negozio-in-chat' };

    let email: string | null | undefined;
    try {
      const { data, error } = await admin.auth.admin.getUserById(conv.seller_id);
      email = error ? null : data?.user?.email;
    } catch {
      email = null;
    }
    if (!email) {
      logger.error('[chat] avviso al negozio non partito: indirizzo del negozio non letto', { conversationId });
      return { inviato: false, motivo: 'indirizzo-non-letto' };
    }

    const t = messaggioNuovoAlNegozioTemplate({ conversationId });
    const res = await sendEmail({
      to: email,
      subject: t.subject,
      html: t.html,
      text: t.text,
      tipo: 'transazionale',
      tags: [{ name: 'template', value: 'chat_messaggio_nuovo' }],
    });
    if ('ok' in res && res.ok) return { inviato: true };
    if ('skipped' in res && res.skipped) {
      logger.warn('[chat] avviso al negozio non partito: posta non pronta', { conversationId, motivo: res.reason });
      return { inviato: false, motivo: 'posta-non-pronta' };
    }
    logger.error('[chat] avviso al negozio non partito: invio fallito', {
      conversationId, message: 'error' in res ? res.error : undefined,
    });
    return { inviato: false, motivo: 'invio-fallito' };
  } catch (e) {
    logger.error('[chat] avviso al negozio non partito', {
      conversationId, message: e instanceof Error ? e.message : String(e),
    });
    return { inviato: false, motivo: 'conversazione-non-letta' };
  }
}
