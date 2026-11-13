'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { useUtente, CHIAVE_UTENTE } from '@/components/hooks/useUtente';

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
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
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
