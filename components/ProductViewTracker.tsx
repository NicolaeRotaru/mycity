'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { trackProductViewed } from '@/lib/analytics/events';

type Props = { productId: string };

/**
 * Traccia la view di un prodotto:
 *  1. `product_views` (anche guest) — alimenta TrendingNow
 *  2. `recently_viewed` (solo se loggato) — alimenta carousel "Ultimi visti"
 *
 * Componente invisibile, side effect only. Usa sessionStorage per dedupare:
 * lo stesso prodotto viene contato 1x per sessione (no inflation da F5 ripetuti).
 */
export default function ProductViewTracker({ productId }: Props) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `mc_viewed_${productId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    trackProductViewed(productId);

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();

      // 1) product_views (sempre, anche guest)
      await supabase.from('product_views').insert({
        product_id: productId,
        user_id: user?.id ?? null,
      });

      // 2) recently_viewed (solo loggati) — upsert con touch viewed_at
      if (user) {
        await supabase
          .from('recently_viewed')
          .upsert(
            { user_id: user.id, product_id: productId, viewed_at: new Date().toISOString() },
            { onConflict: 'user_id,product_id' },
          );
      }
    })().catch(() => { /* noop, telemetria best-effort */ });
  }, [productId]);

  return null;
}
