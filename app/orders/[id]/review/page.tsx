'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import EmptyState from '@/components/EmptyState';
import { Package } from 'lucide-react';
import { queryKeys } from '@/lib/queries/keys';

const StarRating = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
  <div className="flex gap-1">
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n}
        type="button"
        onClick={() => onChange(n)}
        className="text-4xl transition-transform hover:scale-110"
        aria-label={`${n} ${n === 1 ? 'stella' : 'stelle'}`}
      >
        <span className={n <= value ? 'text-accent-400' : 'text-ink-300'}>★</span>
      </button>
    ))}
  </div>
);

export default function OrderReviewPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [storeRating, setStoreRating] = useState(5);
  const [storeComment, setStoreComment] = useState('');
  const [riderRating, setRiderRating] = useState(5);
  const [riderComment, setRiderComment] = useState('');

  const { data: order, isLoading } = useQuery({
    queryKey: queryKeys.orders.forReview(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, delivery_status, seller_id, rider_id,
          seller:profiles!orders_seller_id_fkey ( store_name ),
          rider:profiles!orders_rider_id_fkey   ( full_name )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      if (!order || order.delivery_status !== 'DELIVERED') throw new Error('Ordine non consegnato');

      if (order.seller_id) {
        const { error: e1 } = await supabase.from('store_reviews').insert({
          store_id: order.seller_id,
          user_id: user.id,
          order_id: id,
          rating: storeRating,
          comment: storeComment.trim() || null,
        });
        if (e1 && e1.code !== '23505') throw e1; // ignora duplicato
      }
      if (order.rider_id) {
        const { error: e2 } = await supabase.from('rider_reviews').insert({
          rider_id: order.rider_id,
          user_id: user.id,
          order_id: id,
          rating: riderRating,
          comment: riderComment.trim() || null,
        });
        if (e2 && e2.code !== '23505') throw e2;
      }
    },
    onSuccess: () => {
      toast.success('Grazie per la recensione! 🌟');
      router.push(`/orders/${id}`);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;
  if (!order) return <div className="container mx-auto py-12 max-w-2xl"><EmptyState icon={Package} title="Ordine non trovato" ctaLabel="Tutti gli ordini" ctaHref="/orders" /></div>;
  if (order.delivery_status !== 'DELIVERED') {
    return (
      <div className="container mx-auto p-8 text-center space-y-3">
        <p className="text-ink-700">Puoi lasciare una recensione solo per ordini consegnati.</p>
        <Link href={`/orders/${id}`} className="text-primary-700 hover:underline">← Torna all'ordine</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-xl space-y-6">
      <div>
        <Link href={`/orders/${id}`} className="text-sm text-primary-700 hover:underline">← Torna all'ordine</Link>
        <h1 className="text-2xl font-bold text-ink-900 mt-1">Lascia una recensione</h1>
        <p className="text-sm text-ink-500">Le tue stelle aiutano gli altri clienti a scegliere.</p>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div>
          <p className="font-semibold text-ink-900">🏪 {order.seller?.store_name ?? 'Negozio'}</p>
          <p className="text-xs text-ink-500 mb-3">Com'è stato il negozio? Qualità, packaging, prodotti.</p>
          <StarRating value={storeRating} onChange={setStoreRating} />
          <textarea
            value={storeComment}
            onChange={(e) => setStoreComment(e.target.value)}
            rows={2}
            placeholder="Scrivi un commento (opzionale)…"
            className="w-full mt-3 border p-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
          />
        </div>
      </div>

      {order.rider_id && (
        <div className="bg-white border rounded-xl p-6 space-y-4">
          <div>
            <p className="font-semibold text-ink-900">🛵 {order.rider?.full_name ?? 'Il tuo rider'}</p>
            <p className="text-xs text-ink-500 mb-3">Com'è stato il rider? Puntualità, gentilezza.</p>
            <StarRating value={riderRating} onChange={setRiderRating} />
            <textarea
              value={riderComment}
              onChange={(e) => setRiderComment(e.target.value)}
              rows={2}
              placeholder="Scrivi un commento (opzionale)…"
              className="w-full mt-3 border p-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
            />
          </div>
        </div>
      )}

      <button
        onClick={() => submit.mutate()}
        disabled={submit.isPending}
        className="w-full bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white py-3 rounded-xl font-bold"
      >
        {submit.isPending ? 'Invio…' : 'Invia recensione'}
      </button>
    </div>
  );
}
