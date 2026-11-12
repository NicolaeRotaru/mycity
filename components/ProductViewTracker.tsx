'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { trackProductViewed } from '@/lib/analytics/events';
import { hasConsent } from '@/lib/consent';
import { idUtenteInMemoria } from '@/components/hooks/useUtente';
import { contaLaVisita, frenoOrario, improntaOraria } from '@/lib/analytics/visita-prodotto';

type Props = {
  productId: string;
  /** Arricchiscono `product_viewed`/GA4 `view_item` per segmentare i funnel. */
  price?: number;
  category?: string;
  sellerId?: string;
  /** R02-014 — Chi guarda è un amministratore: controlla la scheda, non è un cliente. */
  chiGuardaEAdmin?: boolean;
};

/**
 * Traccia la view di un prodotto:
 *  1. `product_views` (anche guest) — alimenta TrendingNow
 *  2. `recently_viewed` (solo se loggato) — alimenta carousel "Ultimi visti"
 *
 * Componente invisibile, side effect only. Una visita per prodotto all'ora, come
 * il database (R02-015): niente doppioni da F5 o da due schede aperte.
 */
function archivioDelleVisite(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/**
 * Un identificativo casuale che vive un'ora. Non dice chi sei e non ti segue:
 * serve solo a distinguere «duecento visite da uno» da «duecento visite da
 * duecento persone».
 *
 * 12/11/2026 (R02-015) — Prima viveva quanto la scheda del browser; adesso un'ora,
 * condiviso fra le schede: la stessa regola del database (una visita per impronta
 * all'ora), invece di una per scheda.
 */
function improntaSessione(): string {
  try {
    return improntaOraria(archivioDelleVisite());
  } catch {
    return crypto.randomUUID();
  }
}

export default function ProductViewTracker({ productId, price, category, sellerId, chiGuardaEAdmin }: Props) {
  // Letto al momento di scrivere, non a quello di montare: il profilo arriva dopo la pagina.
  const eAdmin = useRef(chiGuardaEAdmin);
  eAdmin.current = chiGuardaEAdmin;
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
        // R02-015 — Il freno è quello del database: una visita per prodotto all'ora, in tutte le
        // schede. PostHog e product_views contano con la stessa regola.
        ...frenoOrario(archivioDelleVisite()),
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
          // 5/11/2026 — Il negoziante che apre il proprio prodotto non è un cliente: la sua visita
          // finiva in «visite», nel tasso di conversione e nei più visti della home.
          if (userId && sellerId && userId === sellerId) return;
          // 12/11/2026 (R02-014) — Nemmeno l'amministratore che controlla le schede. Le righe che
          // arrivano lo stesso (profilo non ancora letto, pagina vecchia) le scarta il conto nel
          // database (migrazione 260).
          if (eAdmin.current) return;

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
