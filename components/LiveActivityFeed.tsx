'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';

type Activity = {
  id: string;
  created_at: string;
  delivery_status: string;
  delivery_city: string | null;
  delivery_full_name: string | null;
  seller: { store_name: string | null; id: string } | null;
};

// Anonimizza il nome: "Mario Rossi" → "Mario R."
function anonName(name: string | null | undefined): string {
  if (!name) return 'Qualcuno';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ora';
  if (mins < 60) return `${mins} min fa`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  return `${d}g fa`;
}

const LiveActivityFeed = () => {
  const [pulse, setPulse] = useState(false);

  const { data: activities = [], refetch } = useQuery({
    queryKey: ['live-feed'],
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select(`
          id, created_at, delivery_status, delivery_city, delivery_full_name,
          seller:profiles!orders_seller_id_fkey ( id, store_name )
        `)
        .in('delivery_status', ['NEW', 'ACCEPTED', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'])
        .order('created_at', { ascending: false })
        .limit(8);
      return (data ?? []) as unknown as Activity[];
    },
    refetchInterval: 30_000,
  });

  // Subscribe a nuovi ordini in tempo reale
  useEffect(() => {
    const channel = supabase
      .channel('live-feed-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        () => {
          setPulse(true);
          refetch();
          setTimeout(() => setPulse(false), 1500);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  if (activities.length === 0) return null;

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900 flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full bg-emerald-500 ${pulse ? 'animate-ping' : 'animate-pulse'}`} />
          Cosa sta succedendo ora
        </h2>
        <span className="text-xs text-gray-400">In tempo reale</span>
      </div>
      <ul className="space-y-2">
        {activities.map((a) => {
          const verb = a.delivery_status === 'DELIVERED'
            ? 'ha ricevuto un ordine da'
            : 'ha appena ordinato da';
          return (
            <li key={a.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-lg shrink-0">
                {a.delivery_status === 'DELIVERED' ? '✅' :
                 a.delivery_status === 'OUT_FOR_DELIVERY' ? '🚚' :
                 a.delivery_status === 'READY' ? '📦' : '🛒'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate">
                  <strong className="text-gray-900">{anonName(a.delivery_full_name)}</strong>
                  <span className="text-gray-500"> {verb} </span>
                  {a.seller?.id ? (
                    <Link href={`/store/${a.seller.id}`} className="font-semibold text-indigo-600 hover:underline">
                      {a.seller.store_name ?? 'un negozio'}
                    </Link>
                  ) : (
                    <span className="font-semibold text-gray-700">{a.seller?.store_name ?? 'un negozio'}</span>
                  )}
                </p>
              </div>
              <span className="text-xs text-gray-400 shrink-0">{timeAgo(a.created_at)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default LiveActivityFeed;
