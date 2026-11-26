'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { useUtente, CHIAVE_UTENTE } from '@/components/hooks/useUtente';

/**
 * 26/11/2026 — Le categorie che la persona ha spento nelle impostazioni (promozioni e
 * newsletter, `notif_promos` e `notif_newsletter`): non le riceve in push
 * (`vuole_notifica`), e il campanello non le deve contare. Prima le contava, e il
 * pallino si accendeva per un avviso che la persona aveva chiesto di non avere.
 * Lo stesso per i gruppi (`notif_groups`). Gli aggiornamenti d'ordine (`notif_order_updates`)
 * invece no: nella categoria 'order' finiscono anche avvisi che non sono aggiornamenti d'ordine
 * (il pagamento dell'abbonamento non riuscito, l'abbonamento attivo, la sponsorizzazione, il premio
 * invito, l'SOS del fattorino agli amministratori, l'ordine pronto per il ritiro al fattorino), e
 * spegnendo gli aggiornamenti d'ordine il campanello li nasconderebbe.
 * Se la preferenza non si legge si conta senza promozioni e newsletter, come il
 * campanello del negozio (SellerShell): un guasto sulla preferenza non deve spegnere
 * il pallino degli ordini.
 */
export async function categorieDiNotificheSpente(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('notif_promos, notif_newsletter, notif_groups')
    .eq('id', userId)
    .limit(1);
  type Preferenze = {
    notif_promos?: boolean | null;
    notif_newsletter?: boolean | null;
    notif_groups?: boolean | null;
  };
  const preferenze = error ? null : ((data ?? []) as Preferenze[])[0] ?? null;
  const spente: string[] = [];
  if (preferenze?.notif_promos !== true) spente.push('promo');
  if (preferenze?.notif_newsletter !== true) spente.push('newsletter');
  // I gruppi sono accesi di serie (`vuole_notifica` li legge con coalesce a true): restano fuori dal
  // conto solo se la persona li ha spenti davvero. Se la preferenza non si legge si contano.
  // 'order' non si toglie mai dal conto: vedi sopra.
  if (preferenze?.notif_groups === false) spente.push('group');
  return spente;
}

/**
 * Conta le notifiche non lette dell'utente corrente.
 * Si re-fetcha ogni 60s e quando lo stato auth cambia.
 */
export const useNotificationsCount = () => {
  // #88 — L'identita' arriva dalla cache condivisa (una lettura per tutta la
  // pagina). Il cambio di stato lo si ascolta comunque, per svuotare i conti
  // quando qualcuno esce.
  const { userId } = useUtente();
  const qc = useQueryClient();
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void qc.invalidateQueries({ queryKey: CHIAVE_UTENTE });
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const { data: count = 0 } = useQuery({
    queryKey: [...queryKeys.notifications.count, userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!userId) return 0;
      let conta = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      // Le categorie spente restano fuori dal conto: category NOT IN (…).
      const spente = await categorieDiNotificheSpente(userId);
      if (spente.length > 0) conta = conta.or(`category.not.in.(${spente.join(',')})`);
      const { count, error } = await conta;
      // Non `return 0`: quello marcava la lettura come riuscita con un numero falso, e react-query
      // non riprova una query riuscita. Il pallino delle notifiche restava spento per sempre dopo
      // un guasto di un secondo. Chi legge il numero ha gia' il suo valore di riserva (`= 0` qui
      // sotto), quindi a schermo non cambia niente: cambia che adesso ci riprova.
      if (error) throw error;
      return count ?? 0;
    },
  });

  return count;
};
