'use client';

import { useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';

/**
 * Prova sociale specifica — "Ordinato N volte negli ultimi 7 giorni".
 *
 * La prova sociale specifica converte più delle stelle generiche. Conta i
 * pezzi venduti del prodotto nell'ultima settimana (order_items → orders).
 * Best-effort: se i dati mancano o sono pochi non mostra nulla (no fake).
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TO_SHOW = 3; // sotto questa soglia, niente prova sociale

export function SocialProof({
  productId,
  className,
}: {
  productId: string;
  className?: string;
}) {
  const { data: count = 0 } = useQuery({
    queryKey: ['social-proof', productId],
    queryFn: async () => {
      const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const { data } = await supabase
        .from('order_items')
        .select('quantity, orders!inner(created_at)')
        .eq('product_id', productId)
        .gte('orders.created_at', since);
      return (data ?? []).reduce(
        (sum, row: { quantity: number | null }) => sum + (row.quantity ?? 1),
        0,
      );
    },
    staleTime: 5 * 60_000,
  });

  if (count < MIN_TO_SHOW) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold text-secondary-700',
        className,
      )}
    >
      <Flame size={13} strokeWidth={2.4} className="text-secondary-500" aria-hidden />
      Ordinato {count} volte negli ultimi 7 giorni
    </span>
  );
}
