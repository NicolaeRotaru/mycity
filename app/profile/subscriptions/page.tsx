'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ArrowLeft, Pause, Play, Trash2, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { queryKeys } from '@/lib/queries/keys';
import { COPY } from '@/lib/copy';

type Subscription = {
  id: string;
  user_id: string;
  seller_id: string;
  items: Array<{ name: string; quantity: number; price_cents?: number; product_id?: string }>;
  total_cents: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  weekday: number | null;
  delivery_time: string | null;
  status: 'active' | 'paused' | 'cancelled';
  next_delivery_at: string | null;
  last_delivery_at: string | null;
  created_at: string;
  seller: { store_name: string | null } | null;
};

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Settimanale',
  biweekly: 'Ogni 2 settimane',
  monthly: 'Mensile',
};

export default function SubscriptionsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/sign-in?returnTo=/profile/subscriptions'); return; }
      setUserId(data.user.id);
    });
  }, [router]);

  const { data: subs = [] } = useQuery({
    queryKey: queryKeys.subscriptions.byUser(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<Subscription[]> => {
      const { data } = await supabase
        .from('subscription_orders')
        .select(`*, seller:profiles!subscription_orders_seller_id_fkey ( store_name )`)
        .eq('user_id', userId!)
        .order('created_at', { ascending: false });
      return (data ?? []) as Subscription[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Subscription['status'] }) => {
      const { error } = await supabase.from('subscription_orders').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.subscriptions.all });
      toast.success(COPY.toasts.updated);
    },
  });

  if (!userId) return <LoadingState />;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl space-y-6">
      <div>
        <Link href="/profile" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft size={14} /> Profilo
        </Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <RefreshCw size={28} className="text-primary-600" />
          Ordini ricorrenti
        </h1>
        <p className="text-sm text-ink-500 mt-1">Imposta consegne automatiche di prodotti che acquisti spesso</p>
      </div>

      {subs.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
          <RefreshCw size={36} className="mx-auto text-ink-300 mb-3" />
          <p className="text-ink-600 font-medium mb-1">Nessun ordine ricorrente</p>
          <p className="text-sm text-ink-400 mb-4">Quando ordini un prodotto puoi attivare la consegna ricorrente.</p>
          <Button href="/search" size="sm">Cerca prodotti</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((s) => (
            <div key={s.id} className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-serif font-bold text-lg text-ink-900">
                    {s.seller?.store_name ?? 'Negozio'} · {FREQUENCY_LABEL[s.frequency]}
                  </p>
                  <p className="text-xs text-ink-500 mt-1 inline-flex items-center gap-1.5">
                    <Calendar size={12} />
                    {s.weekday !== null ? `Ogni ${WEEKDAYS[s.weekday]}` : ''}
                    {s.delivery_time && ` alle ${s.delivery_time.slice(0, 5)}`}
                    {s.next_delivery_at && ` · Prossima: ${new Date(s.next_delivery_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`}
                  </p>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                  s.status === 'active' ? 'bg-olive-100 text-olive-800' :
                  s.status === 'paused' ? 'bg-accent-100 text-accent-800' :
                  'bg-ink-100 text-ink-600'
                }`}>
                  {s.status === 'active' ? 'Attivo' : s.status === 'paused' ? 'In pausa' : 'Cancellato'}
                </span>
              </div>

              <div className="bg-cream-50 rounded-lg p-3">
                <p className="text-xs text-ink-500 mb-1">Articoli ({s.items.length}):</p>
                <ul className="text-sm text-ink-700 space-y-0.5">
                  {s.items.slice(0, 3).map((it, i: number) => (
                    <li key={i}>· {it.name} × {it.quantity}</li>
                  ))}
                  {s.items.length > 3 && <li className="text-xs text-ink-500">+ altri {s.items.length - 3}</li>}
                </ul>
                <p className="text-sm font-bold text-ink-900 mt-2">Totale: {formatPrice(s.total_cents / 100)}</p>
              </div>

              {s.status !== 'cancelled' && (
                <div className="flex gap-2">
                  {s.status === 'active' ? (
                    <button onClick={() => setStatus.mutate({ id: s.id, status: 'paused' })} className="text-xs font-semibold inline-flex items-center gap-1 bg-accent-100 hover:bg-accent-200 text-accent-800 px-3 py-1.5 rounded-lg">
                      <Pause size={12} /> Metti in pausa
                    </button>
                  ) : (
                    <button onClick={() => setStatus.mutate({ id: s.id, status: 'active' })} className="text-xs font-semibold inline-flex items-center gap-1 bg-olive-100 hover:bg-olive-200 text-olive-800 px-3 py-1.5 rounded-lg">
                      <Play size={12} /> Riattiva
                    </button>
                  )}
                  <button onClick={() => { if (confirm('Cancellare la consegna ricorrente?')) setStatus.mutate({ id: s.id, status: 'cancelled' }); }} className="text-xs font-semibold inline-flex items-center gap-1 bg-secondary-100 hover:bg-secondary-200 text-secondary-800 px-3 py-1.5 rounded-lg">
                    <Trash2 size={12} /> Cancella
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-cream-50 border border-cream-300 rounded-2xl p-5 text-sm text-ink-700">
        <p className="font-semibold mb-1">Come funziona</p>
        <p>Quando ordini un prodotto deperibile (pane, frutta, latte), puoi attivare la <strong>consegna ricorrente</strong> dalla scheda ordine. Imposti frequenza e giorno, il sistema crea automaticamente i nuovi ordini.</p>
      </div>
    </div>
  );
}
