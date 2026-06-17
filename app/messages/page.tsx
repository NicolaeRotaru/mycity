'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { logger } from '@/lib/logger';

type Counterpart = {
  id: string;
  full_name: string | null;
  store_name: string | null;
};

type ConversationRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  last_message_at: string;
  last_message_preview: string | null;
  buyer_unread_count: number;
  seller_unread_count: number;
  buyer: Counterpart | null;
  seller: Counterpart | null;
};

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'adesso';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} min fa`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} h fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export default function MessagesListPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push('/sign-in?returnTo=/messages');
        return;
      }
      setUserId(data.user.id);
    });
  }, [router]);

  const { data: conversations = [], isLoading, refetch } = useQuery({
    queryKey: queryKeys.messages.conversationsByUser(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id, buyer_id, seller_id, last_message_at, last_message_preview,
          buyer_unread_count, seller_unread_count,
          buyer:profiles!conversations_buyer_id_fkey ( id, full_name, store_name ),
          seller:profiles!conversations_seller_id_fkey ( id, full_name, store_name )
        `)
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .order('last_message_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as ConversationRow[];
    },
  });

  // Realtime: re-fetch quando arriva un messaggio in una delle mie conversazioni.
  // `refetch` cambia identity ad ogni render → ref stabile per non ricreare
  // il channel (Supabase: "cannot add postgres_changes callbacks after subscribe").
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!userId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`conv-list-${userId}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
          refetchRef.current();
        })
        .subscribe();
    } catch (err) {
      logger.warn('[messages-list] realtime subscribe failed', err);
    }
    return () => { if (channel) { try { supabase.removeChannel(channel); } catch { /* noop */ } } };
  }, [userId]);

  if (!userId || isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <MessageCircle size={28} className="text-primary-700" />
        <div>
          <h1 className="text-2xl font-bold">Messaggi</h1>
          <p className="text-sm text-ink-500">Conversazioni con i negozi</p>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div className="bg-white border rounded-xl p-12 text-center">
          <MessageCircle size={48} className="mx-auto text-ink-500 mb-3" aria-hidden />
          <p className="text-ink-600 font-semibold mb-1">Nessuna conversazione</p>
          <p className="text-sm text-ink-400">
            Scrivi a un negozio dalla scheda prodotto per fare domande prima di acquistare.
          </p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl divide-y divide-cream-100 overflow-hidden">
          {conversations.map((c) => {
            const iAmBuyer = c.buyer_id === userId;
            const counterpart = iAmBuyer ? c.seller : c.buyer;
            const counterpartName =
              (iAmBuyer ? counterpart?.store_name : counterpart?.full_name) ??
              counterpart?.full_name ?? 'Utente';
            const unread = iAmBuyer ? c.buyer_unread_count : c.seller_unread_count;
            return (
              <Link
                key={c.id}
                href={`/messages/${c.id}`}
                className="block hover:bg-cream-50 transition-colors"
              >
                <div className="flex items-start gap-3 p-4">
                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                    iAmBuyer ? 'bg-secondary-100 text-secondary-700' : 'bg-primary-100 text-primary-800'
                  }`}>
                    {counterpartName[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <h3 className={`font-semibold truncate ${unread > 0 ? 'text-ink-900' : 'text-ink-700'}`}>
                        {counterpartName}
                      </h3>
                      <span className="text-xs text-ink-400 shrink-0">
                        {formatRelative(c.last_message_at)}
                      </span>
                    </div>
                    <p className={`text-sm truncate ${unread > 0 ? 'text-ink-900 font-medium' : 'text-ink-500'}`}>
                      {c.last_message_preview ?? '(nessun messaggio)'}
                    </p>
                  </div>
                  {unread > 0 && (
                    <span className="shrink-0 bg-rose-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
