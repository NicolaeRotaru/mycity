'use client';

import { useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';

/**
 * Prova sociale specifica — "Ordinato N volte negli ultimi 7 giorni".
 *
 * La prova sociale specifica converte più delle stelle generiche. Conta gli
 * ordini del prodotto nell'ultima settimana (funzione del database, migrazione 245).
 * Best-effort: se i dati mancano o sono pochi non mostra nulla (no fake).
 */
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
    // S10 (5/11/2026) — Prima si leggevano dal browser le righe d'ordine, che
    // le regole del database mostrano solo a chi le possiede: ognuno contava i
    // suoi ordini, e scaricava ogni riga per sommarla. Adesso un numero solo,
    // dal database (migrazione 245): ordini distinti, non annullati, 7 giorni.
    // Se la funzione non c'è ancora o non risponde, niente prova sociale.
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ordini_recenti_del_prodotto', { p_product_id: productId });
      if (error) return 0;
      const n = Number(data);
      return Number.isFinite(n) ? n : 0;
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
