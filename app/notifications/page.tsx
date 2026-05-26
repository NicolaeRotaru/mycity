'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

type Notification = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'adesso';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min fa`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ore fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: async (): Promise<Notification[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Quando la pagina si carica, segna tutte come lette
  const markAllRead = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  useEffect(() => {
    if (data && data.some((n) => !n.is_read)) {
      markAllRead.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isLoading) {
    return <div className="container mx-auto p-8 text-center text-ink-500">Caricamento...</div>;
  }

  if (error) {
    if (typeof window !== 'undefined') router.push('/sign-in');
    return null;
  }

  const notifications = data ?? [];

  return (
    <div className="container mx-auto px-6 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-3xl">🔔</span>
        <div>
          <h1 className="text-2xl font-bold">Notifiche</h1>
          <p className="text-sm text-ink-500">Aggiornamenti su ordini, prodotti e novità</p>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="bg-white border rounded-xl p-12 text-center">
          <p className="text-6xl mb-3">📭</p>
          <p className="text-ink-600 font-semibold mb-1">Nessuna notifica</p>
          <p className="text-sm text-ink-400">Quando ci saranno aggiornamenti, li vedrai qui.</p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl divide-y divide-cream-100 overflow-hidden">
          {notifications.map((n) => {
            const inner = (
              <>
                <div className="flex items-start gap-3 p-4 hover:bg-cream-50 transition-colors">
                  <div
                    className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
                      n.is_read ? 'bg-transparent' : 'bg-primary-600'
                    }`}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <h3 className={`font-semibold ${n.is_read ? 'text-ink-700' : 'text-ink-900'}`}>
                        {n.title}
                      </h3>
                      <span className="text-xs text-ink-400 whitespace-nowrap">
                        {formatDate(n.created_at)}
                      </span>
                    </div>
                    {n.body && <p className="text-sm text-ink-600">{n.body}</p>}
                  </div>
                </div>
              </>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block">
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
