'use client';

import { useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { useProfile } from '@/components/hooks/useProfile';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

type GroupOrder = {
  id: string;
  product_id: string;
  seller_id: string;
  organizer_id: string;
  title: string | null;
  target_quantity: number;
  current_quantity: number;
  discount_percent: number;
  unit_price: number;
  discounted_price: number;
  deadline: string;
  status: string;
  product: { name: string; images: string[] | null; description: string | null } | null;
  seller: { id: string; store_name: string | null; store_logo: string | null } | null;
};

function timeLeft(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'Scaduto';
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}g ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${Math.floor((ms % 3600000) / 60000)}min`;
  return `${Math.floor(ms / 60000)} min`;
}

export default function GroupDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const router = useRouter();
  const qc = useQueryClient();
  const { isAuthenticated } = useProfile();

  const { data: group, isLoading, refetch } = useQuery({
    queryKey: queryKeys.groups.order(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_orders')
        .select(`
          id, product_id, seller_id, organizer_id, title,
          target_quantity, current_quantity, discount_percent,
          unit_price, discounted_price, deadline, status,
          product:products ( name, images, description ),
          seller:profiles!group_orders_seller_id_fkey ( id, store_name, store_logo )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as GroupOrder;
    },
  });

  // Live updates su current_quantity
  useEffect(() => {
    const ch = supabase
      .channel(`group:${id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'group_orders', filter: `id=eq.${id}` },
        () => refetch(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, refetch]);

  const { data: myParticipation } = useQuery({
    queryKey: queryKeys.groups.participation(id),
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('group_participants')
        .select('id, quantity')
        .eq('group_order_id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
  });

  const join = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/sign-in?returnTo=/groups/${id}`);
        throw new Error('REDIRECT');
      }
      const { error } = await supabase.from('group_participants').insert({
        group_order_id: id,
        user_id: user.id,
        quantity: 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.groups.order(id) });
      qc.invalidateQueries({ queryKey: queryKeys.groups.participation(id) });
      toast.success('🎉 Sei nel gruppo! Quando si raggiunge il target verrai contattato.');
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message !== 'REDIRECT') toast.error(friendlyError(err));
    },
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('group_participants')
        .delete()
        .eq('group_order_id', id)
        .eq('user_id', user.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.groups.order(id) });
      qc.invalidateQueries({ queryKey: queryKeys.groups.participation(id) });
      toast.success('Hai abbandonato il gruppo');
    },
  });

  if (isLoading || !group) return <LoadingState />;

  const progress = Math.min(100, (group.current_quantity / group.target_quantity) * 100);
  const missing = Math.max(0, group.target_quantity - group.current_quantity);
  const img = group.product?.images?.[0];
  const closed = group.status !== 'OPEN' || new Date(group.deadline) <= new Date();

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
      <Link href="/groups" className="text-sm text-primary-700 hover:underline">← Tutti i gruppi</Link>
      <div className="bg-white border-2 border-accent-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-accent-500 to-rose-500 text-white p-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-accent-50 text-sm font-semibold uppercase tracking-wide">Gruppo d'acquisto</p>
            <span className="bg-white text-rose-600 font-extrabold px-3 py-1 rounded-full">
              -{group.discount_percent}%
            </span>
          </div>
          <h1 className="text-2xl font-extrabold mt-2">{group.product?.name}</h1>
          <p className="text-accent-100 text-sm mt-1">🏪 {group.seller?.store_name}</p>
        </div>

        <div className="p-6 space-y-5">
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            (<img src={img} alt="" loading="lazy" decoding="async" className="w-full h-48 object-cover rounded-lg" />)
          )}

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold text-rose-600">{formatPrice(group.discounted_price)}</span>
            <span className="text-ink-400 line-through">{formatPrice(group.unit_price)}</span>
            <span className="text-olive-600 text-sm font-semibold">
              Risparmi {formatPrice(group.unit_price - group.discounted_price)}
            </span>
          </div>

          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-bold text-ink-900">
                {group.current_quantity} / {group.target_quantity} partecipanti
              </span>
              <span className="text-accent-600 font-semibold">⏱ {timeLeft(group.deadline)}</span>
            </div>
            <div className="bg-cream-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-accent-400 to-rose-500 h-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            {missing > 0 ? (
              <p className="text-xs text-ink-500 mt-2">
                Mancano <strong className="text-rose-600">{missing}</strong> persone per sbloccare lo sconto.
              </p>
            ) : (
              <p className="text-xs text-olive-700 mt-2 font-semibold">
                ✅ Target raggiunto! L'offerta è confermata.
              </p>
            )}
          </div>

          {closed ? (
            <div className="bg-cream-100 text-ink-600 p-4 rounded-lg text-sm text-center">
              Questo gruppo è chiuso.
            </div>
          ) : myParticipation ? (
            <div className="space-y-2">
              <div className="bg-olive-50 border border-olive-200 rounded-lg p-3 text-sm text-olive-800">
                ✅ <strong>Sei nel gruppo</strong>. Verrai avvisato quando si raggiunge il target.
              </div>
              <button
                onClick={() => leave.mutate()}
                className="w-full text-sm text-ink-500 hover:text-rose-600 underline"
              >
                Abbandona il gruppo
              </button>
            </div>
          ) : (
            <button
              onClick={() => join.mutate()}
              disabled={join.isPending}
              className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white py-4 rounded-xl font-extrabold text-lg shadow-lg"
            >
              {join.isPending ? 'Iscrizione…' : `🤝 Unisciti al gruppo a ${formatPrice(group.discounted_price)}`}
            </button>
          )}

          <p className="text-xs text-ink-400 text-center">
            Pagamento solo quando il gruppo è confermato. Annulla quando vuoi prima della scadenza.
          </p>
        </div>
      </div>
      {group.product?.description && (
        <div className="bg-white border rounded-xl p-5">
          <h2 className="font-bold text-ink-900 mb-2">Dettagli prodotto</h2>
          <p className="text-sm text-ink-700">{group.product.description}</p>
        </div>
      )}
    </div>
  );
}
