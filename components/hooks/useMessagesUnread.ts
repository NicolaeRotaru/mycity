'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

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
    queryKey: queryKeys.messages.unreadByUser(userId ?? ''),
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
      type ConvRow = { buyer_id: string; seller_id: string; buyer_unread_count: number | null; seller_unread_count: number | null };
      return (data ?? []).reduce((sum: number, c: ConvRow) => {
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
    // Channel name unico per effect run: previene il caso in cui Supabase JS
    // riusa un'istanza già subscribed (race condition tra cleanup async e
    // re-mount sincrono). Date.now() garantisce unicità.
    // Try/catch difensivo: se Supabase rifiuta il subscribe per qualsiasi
    // motivo (es. Realtime non abilitato sul DB, migration non applicata),
    // logghiamo ma non crashiamo l'app — il polling ogni 60s resta attivo.
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel(`msg-unread-${userId}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
          refetchRef.current();
        })
        .subscribe();
    } catch (err) {
      console.warn('[useMessagesUnread] realtime subscribe failed:', err);
    }
    return () => { if (ch) { try { supabase.removeChannel(ch); } catch { /* noop */ } } };
  }, [userId]); // solo userId — refetch via ref

  return unread;
};
