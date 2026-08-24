'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

/**
 * "Segui negozio" — gestisce il follow di un negozio per l'utente autenticato.
 *
 * DATI REALI:
 * - `isFollowing` → riga dell'utente in `follows` (RLS own-row: select solo le
 *   proprie righe). Per il guest la query è disabilitata → resta false.
 * - `followerCount` → RPC pubblica `store_follower_count(p_store_id)` (conteggio
 *   visibile a tutti, senza esporre le righe altrui).
 *
 * Il toggle inserisce/elimina SOLO la riga dell'utente (own-row) con update
 * ottimistico + invalidation react-query. Il guest che tenta il toggle riceve
 * l'errore `AUTH_REQUIRED` (stesso pattern di useFavorites), così il chiamante
 * può proporre l'accesso.
 */

const followKeys = {
  state: (storeId: string) => ['follows', 'state', storeId] as const,
  count: (storeId: string) => ['follows', 'count', storeId] as const,
};

export function useFollowStore(storeId: string) {
  const qc = useQueryClient();

  const stateQ = useQuery({
    queryKey: followKeys.state(storeId),
    queryFn: async (): Promise<boolean> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data, error } = await supabase
        .from('follows')
        .select('store_id')
        .eq('user_id', user.id)
        .eq('store_id', storeId)
        .maybeSingle();
      // Senza questa riga la lettura non falliva mai: tornava «riuscita» con `data` a null, cioe'
      // «non lo segui». A chi il negozio lo segue gia' il bottone diceva «Segui»; premendolo si
      // tenta un inserimento doppio, che il database rifiuta — e li' l'errore c'e', ma il messaggio
      // esce solo per il caso «devi accedere». Il resto era un bottone che non fa niente.
      if (error) throw error;
      return !!data;
    },
    staleTime: 30_000,
    enabled: !!storeId,
  });

  const countQ = useQuery({
    queryKey: followKeys.count(storeId),
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('store_follower_count', { p_store_id: storeId });
      // `return 0` su un errore diceva «nessuno segue questo negozio» su un conto che nessuno era
      // riuscito a fare — e, siccome la query risultava a buon fine, non veniva piu' riprovata.
      // Un guasto di un secondo diventava uno zero permanente. Lanciando, react-query riprova.
      if (error) throw error;
      return Number(data ?? 0);
    },
    staleTime: 30_000,
    enabled: !!storeId,
  });

  const isFollowing = stateQ.data ?? false;
  const followerCount = countQ.data ?? 0;
  // «Ho in mano la risposta», non «la lettura e' finita»: con `isLoading` falso e `data` a
  // `undefined` la seconda direbbe di si' su una lettura fallita, e `isFollowing` uscirebbe falso —
  // cioe' «non lo segui» detto a chi lo segue.
  const statoLetto = stateQ.data !== undefined;
  const contoLetto = countQ.data !== undefined;

  const toggle = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('AUTH_REQUIRED');
      if (isFollowing) {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('user_id', user.id)
          .eq('store_id', storeId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({ user_id: user.id, store_id: storeId });
        if (error) throw error;
      }
    },
    // Update ottimistico: ribalta isFollowing e aggiusta il conteggio subito.
    onMutate: async () => {
      await Promise.all([
        qc.cancelQueries({ queryKey: followKeys.state(storeId) }),
        qc.cancelQueries({ queryKey: followKeys.count(storeId) }),
      ]);
      const prevState = qc.getQueryData<boolean>(followKeys.state(storeId)) ?? false;
      const prevCount = qc.getQueryData<number>(followKeys.count(storeId)) ?? 0;
      qc.setQueryData(followKeys.state(storeId), !prevState);
      qc.setQueryData(followKeys.count(storeId), Math.max(0, prevCount + (prevState ? -1 : 1)));
      return { prevState, prevCount };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) {
        qc.setQueryData(followKeys.state(storeId), ctx.prevState);
        qc.setQueryData(followKeys.count(storeId), ctx.prevCount);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: followKeys.state(storeId) });
      qc.invalidateQueries({ queryKey: followKeys.count(storeId) });
    },
  });

  return { isFollowing, followerCount, statoLetto, contoLetto, toggle, isLoading: stateQ.isLoading };
}
