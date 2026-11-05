import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * 5/11/2026 — L'ID DEL CONTO STRIPE SI SALVA, E SI CONTROLLA.
 *
 * Le rotte del collegamento a Stripe (negozio e fattorino) scrivevano
 * `stripe_account_id` senza leggere l'esito, e rimandavano a Stripe comunque:
 * il negozio faceva la verifica e restava «non collegato», perche'
 * `account.updated` non trovava nessun profilo con quel conto. Qui la scrittura
 * si fa appena il conto nasce (prima del link) e un errore, o zero righe, lancia
 * `ContoNonSalvato`: la rotta risponde 503 e non manda a Stripe.
 */
export class ContoNonSalvato extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = 'ContoNonSalvato';
  }
}

export async function salvaIlConto(utenteId: string, accountId: string): Promise<void> {
  const { data, error } = await getAdminSupabase()
    .from('profiles')
    .update({ stripe_account_id: accountId })
    .eq('id', utenteId)
    .select('id');
  if (error || !Array.isArray(data) || data.length === 0) {
    logger.error('[stripe] id del conto Connect non salvato sul profilo', {
      utenteId, accountId, message: error?.message ?? 'nessuna riga aggiornata',
    });
    throw new ContoNonSalvato('Il collegamento a Stripe non si è potuto salvare: riprova fra poco.');
  }
}
