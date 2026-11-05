'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Inbox } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AdminPageTitle } from '@/components/admin/AdminUI';

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
  // 5/11/2026 (S05) — La lista la dà il server, per l'account Assistenza (il primo
  // admin), a tutti gli admin: prima si filtrava sull'admin collegato e gli altri
  // vedevano la casella vuota. Una lettura caduta si dice, non è «nessuna richiesta».
  const { data: lettura, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'support-chats'],
    queryFn: async (): Promise<{ sonoIo: boolean; conversazioni: Row[] }> => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/assistenza', {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore di lettura');
      return { sonoIo: Boolean(json.data.sonoIo), conversazioni: (json.data.conversazioni ?? []) as Row[] };
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <LoadingState />;
  if (isError || !lettura) {
    return (
      <div className="space-y-6">
        <AdminPageTitle eyebrow="Sistema" title="Chat assistenza" sub="Richieste di assistenza degli utenti." />
        <ErrorState
          variant="compact"
          title="Non riesco a leggere le richieste di assistenza"
          description="Non so se qualcuno ha scritto e aspetta una risposta. Riprova tra poco."
          retry={() => { void refetch(); }}
          supportHref={null}
        />
      </div>
    );
  }
  const convos = lettura.conversazioni;
  const sonoIo = lettura.sonoIo;

  const totalUnread = convos.reduce((s, c) => s + (c.seller_unread_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Sistema"
        title="Chat assistenza"
        sub="Richieste di assistenza degli utenti. Apri una chat per rispondere."
        action={totalUnread > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3 py-1.5 text-sm font-bold text-primary-700">
            {totalUnread} da leggere
          </span>
        )}
      />

      {!sonoIo && (
        <p role="note" className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-700">
          Le richieste arrivano all’account Assistenza (il primo amministratore). Le vedi qui, ma per leggere la
          chat e rispondere bisogna entrare con quell’account.
        </p>
      )}

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
