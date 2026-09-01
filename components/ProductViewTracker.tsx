'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { trackProductViewed } from '@/lib/analytics/events';
import { hasConsent } from '@/lib/consent';
import { idUtenteInMemoria } from '@/components/hooks/useUtente';
import { contaLaVisita } from '@/lib/analytics/visita-prodotto';

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

    // #228 — Le visite si contavano anche senza consenso, mentre PostHog e il tracciatore di
    // attivita' lo chiedevano. Tre sistemi, due regole diverse. Ora la regola e' una sola.
    //
    // 27/8/2026 (R175) — L'ORDINE DELLE COSE, E IL CONSENSO CHE ARRIVA DOPO. Il freno «gia'
    // contata» veniva messo prima della scrittura (quindi una scrittura fallita perdeva la visita
    // per sempre) e nessuno ascoltava il momento in cui la persona accetta i cookie: chi apre una
    // scheda prodotto e accetta da li' — il caso normale di ogni visitatore nuovo — non veniva
    // contato, mentre il commento prometteva il contrario. Le due cose adesso stanno in
    // `lib/analytics/visita-prodotto.ts`, dove una prova le esegue.
    let vivo = true;

    const prova = () => {
      void contaLaVisita(productId, {
        consenso: () => hasConsent('analytics'),
        giaContata: (chiave) => {
          try { return !!sessionStorage.getItem(chiave); } catch { return false; }
        },
        segnaContata: (chiave) => {
          try { sessionStorage.setItem(chiave, '1'); } catch { /* sessione non disponibile */ }
        },
        annuncia: () => {
          trackProductViewed(productId, {
            // In centesimi, come gli altri eventi che portano un prezzo.
            priceCents: price != null ? Math.round(price * 100) : undefined,
            category,
            seller_id: sellerId,
          });
        },
        registra: async () => {
          if (!vivo) return;
          // #88 — Il token gia' in memoria basta: qui serve solo distinguere una visita anonima da
          // una con account.
          const userId = await idUtenteInMemoria();

          // 041 — L'impronta di sessione serve a contare le visite anonime PER VISITATORE invece
          // che per prodotto. Prima il tetto era globale sul prodotto, e chi voleva azzerare le
          // statistiche di un rivale gli sparava venti visite al minuto: da li' in poi quelle vere
          // venivano buttate. Un freno che si puo' usare per fare il danno che doveva impedire non
          // e' un freno.
          const { error } = await supabase.from('product_views').insert({
            product_id: productId,
            user_id: userId,
            view_fingerprint: userId ? null : improntaSessione(),
          });
          if (error) throw error;

          // recently_viewed (solo loggati) — upsert con touch viewed_at.
          if (userId) {
            await supabase
              .from('recently_viewed')
              .upsert(
                { user_id: userId, product_id: productId, viewed_at: new Date().toISOString() },
                { onConflict: 'user_id,product_id' },
              );
          }
        },
      });
    };

    prova();
    // Chi accetta i cookie mentre sta gia' guardando la scheda: il conteggio riparte, e il freno in
    // sessione evita il doppione. E' lo stesso ascolto che PostHogProvider ha da sempre.
    window.addEventListener('mc:consent-change', prova);
    return () => {
      vivo = false;
      window.removeEventListener('mc:consent-change', prova);
    };
  }, [productId, price, category, sellerId]);

  return null;
}
