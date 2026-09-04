import { getAdminSupabase } from '@/lib/supabase/server';

/**
 * CHI COMANDA SU UN RESO LO DICE L'ORDINE, NON IL RESO.
 *
 * 3/9/2026 — LA RIGA CHE FACEVA USCIRE I SOLDI SENZA CHE NESSUNO APPROVASSE.
 *
 * Le due rotte che muovono un reso (`decide` e `[id]/avanza`) leggevano la riga
 * del reso e poi decidevano cosi':
 *
 *     if (ret.seller_id !== user.id) { ...403... }
 *
 * `returns.seller_id` e' una colonna della riga del reso, e la riga del reso il
 * cliente se la poteva scrivere da solo: la regola di inserimento della
 * migrazione 024 chiedeva soltanto `auth.uid() = buyer_id`, lasciando liberi
 * stato, importo e venditore. Quindi il cliente scriveva un reso con
 * `seller_id` = se stesso e stato «merce ricevuta», chiamava `avanza` con
 * «rimborsato», e la rotta lo riconosceva come il negozio. Quarantadue euro
 * fuori, il negozio che non ha mai visto una richiesta, e il termine dei
 * quattordici giorni saltato.
 *
 * La malattia non e' la riga sbagliata: e' l'aver fatto dipendere un RUOLO da
 * un dato che scrive la controparte. Il negozio di un reso e' il negozio del
 * suo ORDINE — un dato che il cliente non tocca — e si legge qui, dal server,
 * con la chiave di servizio, una volta sola per tutte le rotte dei resi.
 *
 * Anche il ruolo di amministratore si legge da qui e non piu' con la sessione
 * di chi chiama: stesso principio, la risposta la da' il server.
 */
export type ComandoSulReso =
  | { autorizzato: true; sellerOrdine: string | null }
  | { autorizzato: false; motivo: 'ordine-mancante' | 'non-tuo' };

export async function chiComandaIlReso(orderId: string, utenteId: string): Promise<ComandoSulReso> {
  const admin = getAdminSupabase();

  const { data: ordine } = await admin
    .from('orders')
    .select('seller_id')
    .eq('id', orderId)
    .single();

  if (!ordine) return { autorizzato: false, motivo: 'ordine-mancante' };

  const sellerOrdine = (ordine.seller_id as string | null) ?? null;
  if (sellerOrdine !== null && sellerOrdine === utenteId) {
    return { autorizzato: true, sellerOrdine };
  }

  const { data: profilo } = await admin
    .from('profiles')
    .select('role')
    .eq('id', utenteId)
    .single();

  if (profilo?.role === 'admin') return { autorizzato: true, sellerOrdine };

  return { autorizzato: false, motivo: 'non-tuo' };
}
