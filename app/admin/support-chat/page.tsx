'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Headset, ArrowRight, Inbox } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';

type Row = {
  id: string;
  last_message_at: string;
  last_message_preview: string | null;
  seller_unread_count: number;
  buyer: { full_name: string | null; store_name: string | null } | null;
};

/**
 * Inbox supporto lato admin: tutte le conversazioni di assistenza, cioè quelle
 * in cui l'account admin è il destinatario (seller_id = admin). Riusa il thread
 * /messages/[id] per leggere e rispondere. Separata dalla normale inbox
 * /messages per non mescolare le chat buyer↔seller.
 */
export default function AdminSupportChatPage() {
  const [adminId, setAdminId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAdminId(data.user?.id ?? null));
  }, []);

  const { data: convos = [], isLoading } = useQuery({
    queryKey: ['admin', 'support-chats', adminId],
    enabled: !!adminId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id, last_message_at, last_message_preview, seller_unread_count,
          buyer:profiles!conversations_buyer_id_fkey ( full_name, store_name )
        `)
        .eq('seller_id', adminId!)
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 30_000,
  });

  if (isLoading || !adminId) return <LoadingState />;

  const totalUnread = convos.reduce((s, c) => s + (c.seller_unread_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
          <Headset size={22} className="text-primary-700" />
          Chat assistenza
          {totalUnread > 0 && (
            <span className="bg-primary-600 text-white text-xs font-bold rounded-full px-2 py-0.5">{totalUnread}</span>
          )}
        </h1>
        <p className="text-sm text-ink-500">Richieste di assistenza degli utenti. Apri una chat per rispondere.</p>
      </div>

      {convos.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-xl p-12 text-center text-ink-500">
          <Inbox size={40} className="mx-auto text-ink-300 mb-3" />
          Nessuna richiesta di assistenza al momento.
        </div>
      ) : (
        <div className="bg-white border border-cream-300 rounded-xl divide-y divide-cream-100 overflow-hidden">
          {convos.map((c) => {
            const name = c.buyer?.store_name || c.buyer?.full_name || 'Utente';
            const unread = (c.seller_unread_count ?? 0) > 0;
            return (
              <Link
                key={c.id}
                href={`/messages/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-cream-50 transition-colors"
              >
                <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                  unread ? 'bg-primary-600 text-white' : 'bg-cream-200 text-ink-700'
                }`}>
                  {name[0]?.toUpperCase() ?? '?'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`truncate ${unread ? 'font-bold text-ink-900' : 'font-semibold text-ink-800'}`}>{name}</p>
                    {unread && <span className="shrink-0 bg-primary-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{c.seller_unread_count}</span>}
                  </div>
                  <p className="text-sm text-ink-500 truncate">{c.last_message_preview ?? '—'}</p>
                </div>
                <span className="text-xs text-ink-400 shrink-0">
                  {new Date(c.last_message_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                </span>
                <ArrowRight size={16} className="text-ink-300 shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
