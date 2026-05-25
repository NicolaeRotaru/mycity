'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

/**
 * Somma dei messaggi non letti su tutte le conversazioni dell'utente.
 * Refetch ogni 60s + Realtime: si aggiorna quando una conversazione cambia.
 *
 * Nota: `refetch` cambia identity ad ogni render. Se lo mettiamo nelle deps
 * dell'effect Realtime, il channel viene ricreato e Supabase reagisce con
 * "cannot add postgres_changes callbacks after subscribe()" perché il channel
 * con lo stesso nome viene ri-usato già subscribed. Lo passiamo via ref.
 */
export const useMessagesUnread = () => {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data: unread = 0, refetch } = useQuery({
    queryKey: ['messages-unread', userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!userId) return 0;
      const { data, error } = await supabase
        .from('conversations')
        .select('buyer_id, seller_id, buyer_unread_count, seller_unread_count')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);
      // Tabella conversations creata dalla migration 026. Se non applicata
      // su Supabase, ritorniamo 0 silenziosamente invece di rompere la UI.
      if (error) return 0;
      return (data ?? []).reduce((sum, c: any) => {
        if (c.buyer_id === userId) return sum + (c.buyer_unread_count ?? 0);
        if (c.seller_id === userId) return sum + (c.seller_unread_count ?? 0);
        return sum;
      }, 0);
    },
  });

  // Ref stabile per refetch — l'effect Realtime non dipende da una funzione
  // che cambia identity ad ogni render.
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel('msg-unread-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        refetchRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]); // solo userId — refetch via ref

  return unread;
};
