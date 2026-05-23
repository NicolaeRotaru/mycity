import { supabase } from './supabase/client';

export type NotifyInput = {
  userId: string;
  title: string;
  body?: string;
  link?: string;
};

/**
 * Inserisce una notifica per un utente. Best-effort: in caso di errore
 * (per esempio RLS che blocca l'insert) non lancia eccezione perche'
 * l'azione principale (es. accettare un ordine) deve riuscire comunque.
 */
export async function notify({ userId, title, body, link }: NotifyInput): Promise<void> {
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      title,
      body: body ?? null,
      link: link ?? null,
    });
  } catch (err) {
    // swallow, le notifiche sono best-effort
    console.warn('notify failed', err);
  }
}
