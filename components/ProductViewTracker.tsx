'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { trackProductViewed } from '@/lib/analytics/events';

type Props = {
  productId: string;
  /** Arricchiscono `product_viewed`/GA4 `view_item` per segmentare i funnel. */
  price?: number;
  category?: string;
  sellerId?: string;
};

/**
 * Traccia la view di un prodotto:
 *  1. `product_views` (anche guest) — alimenta TrendingNow
 *  2. `recently_viewed` (solo se loggato) — alimenta carousel "Ultimi visti"
 *
 * Componente invisibile, side effect only. Usa sessionStorage per dedupare:
 * lo stesso prodotto viene contato 1x per sessione (no inflation da F5 ripetuti).
 */
/**
 * Un identificativo casuale che vive quanto la scheda del browser. Non dice chi
 * sei e non ti segue: serve solo a distinguere «duecento visite da uno» da
 * «duecento visite da duecento persone».
 */
function improntaSessione(): string {
  const CHIAVE = 'mc_impronta_visite';
  try {
    const gia = sessionStorage.getItem(CHIAVE);
    if (gia) return gia;
    const nuova = crypto.randomUUID();
    sessionStorage.setItem(CHIAVE, nuova);
    return nuova;
  } catch {
    return crypto.randomUUID();
  }
}

export default function ProductViewTracker({ productId, price, category, sellerId }: Props) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `mc_viewed_${productId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    trackProductViewed(productId, { price, category, seller_id: sellerId });

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();

      // 1) product_views (sempre, anche guest)
      // 041 — L'impronta di sessione serve a contare le visite anonime PER
      // VISITATORE invece che per prodotto. Prima il tetto era globale sul
      // prodotto, e chi voleva azzerare le statistiche di un rivale gli sparava
      // venti visite al minuto: da lì in poi quelle vere venivano buttate. Un
      // freno che si può usare per fare il danno che doveva impedire non è un
      // freno. Chi manda l'impronta ha un conto suo, e nessuno può consumarlo.
      await supabase.from('product_views').insert({
        product_id: productId,
        user_id: user?.id ?? null,
        view_fingerprint: user ? null : improntaSessione(),
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
  }, [productId, price, category, sellerId]);

  return null;
}
