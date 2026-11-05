'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { logoNegozio } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';
import { conNegozioApprovato } from '@/lib/queries/seller-public-profiles';
import StoryViewer from '@/components/StoryViewer';

/**
 * Carosello "Storie dei negozi" — Instagram-like, scade in 24h.
 *
 * Esperti senior consultati:
 * - Senior PM: "Stories = formato che gli utenti hanno già imparato (Instagram).
 *   Importarle nel marketplace = friction zero, retention engagement +30%."
 * - Behavioral Scientist: "24h expiration → FOMO. Scarcity rende il contenuto
 *   premium senza pagare."
 * - UX Designer: "Avatar circolari, ring colorato per 'non visto'. Tap =
 *   fullscreen overlay con auto-advance 5sec (vedi StoryViewer)."
 */

type Story = {
  id: string;
  seller_id: string;
  image_url: string;
  caption: string | null;
  link_url: string | null;
  view_count: number;
  expires_at: string;
  seller: {
    id: string;
    store_name: string | null;
    store_logo: string | null;
  } | null;
};

const STORIE_LETTE = 200;
const STORIE_MOSTRATE = 30;

/** Le storie raggruppate per negozio (nell'ordine in cui il negozio compare) e una bolla a testa. */
export function unaBollaPerNegozio<T extends { seller_id: string }>(storie: T[]): {
  inSequenza: T[];
  bolle: Array<{ storia: T; indice: number }>;
} {
  const perNegozio = new Map<string, T[]>();
  for (const s of storie) perNegozio.set(s.seller_id, [...(perNegozio.get(s.seller_id) ?? []), s]);
  const inSequenza: T[] = [];
  const bolle: Array<{ storia: T; indice: number }> = [];
  for (const gruppo of perNegozio.values()) {
    bolle.push({ storia: gruppo[0], indice: inSequenza.length });
    inSequenza.push(...gruppo);
  }
  return { inSequenza, bolle };
}

export default function StoriesCarousel() {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data: stories = [] } = useQuery({
    queryKey: queryKeys.seller.storiesActive,
    queryFn: async (): Promise<Story[]> => {
      // 18/10/2026 — Il negozio della storia arriva dalla vista pubblica dei
      // negozi, non dalla tabella dei profili: dopo le migrazioni 110, 112 e 161
      // la tabella mostra a ognuno solo la propria riga, e ogni bolla sarebbe
      // rimasta senza logo e senza nome. La storia di un negozio che la vista
      // non restituisce (non approvato, sospeso, senza insegna) non si mostra:
      // prima compariva con «?» e «—» al posto del nome.
      const { data } = await supabase
        .from('seller_stories')
        .select('id, seller_id, image_url, caption, link_url, view_count, expires_at')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        // 5/11/2026 — Si taglia DOPO aver tolto le storie dei non-negozi: tagliando prima, trenta
        // storie recenti di un account qualunque riempivano tutti i posti e il carosello restava
        // vuoto, comprese le storie vere dei negozi.
        .limit(STORIE_LETTE);
      const storie = (data ?? []) as Array<Omit<Story, 'seller'>>;
      const conNegozio = (await conNegozioApprovato(supabase, storie, 'id, store_name, store_logo')).slice(0, STORIE_MOSTRATE);
      return conNegozio.map(({ profiles, ...storia }) => ({
        ...storia,
        seller: { id: profiles.id, store_name: profiles.store_name, store_logo: profiles.store_logo ?? null },
      }));
    },
    refetchInterval: 5 * 60_000,
  });

  if (stories.length === 0) return null;

  // 5/11/2026 — Una bolla per NEGOZIO, non per storia: tre storie di Pane Quotidiano erano tre
  // cerchi uguali in fila. Le storie di uno stesso negozio si mettono una dopo l'altra, e la bolla
  // apre il visore sulla prima del suo negozio.
  const { inSequenza, bolle } = unaBollaPerNegozio(stories);

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {bolle.map(({ storia: s, indice: i }) => (
          <button
            key={s.seller_id}
            type="button"
            onClick={() => setViewerIndex(i)}
            className="flex flex-col items-center gap-1 flex-shrink-0"
          >
            <div className="p-0.5 rounded-full bg-gradient-to-tr from-primary-500 via-accent-500 to-secondary-500">
              <div className="bg-white p-0.5 rounded-full">
                {s.seller?.store_logo ? (
                  <Image
                    src={logoNegozio(s.seller.store_logo, 56)}
                    alt=""
                    width={56}
                    height={56}
                    className="rounded-full object-contain w-14 h-14"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold">
                    {(s.seller?.store_name ?? '?')[0]}
                  </div>
                )}
              </div>
            </div>
            <span className="text-[10px] text-ink-700 font-semibold max-w-[72px] truncate">{s.seller?.store_name ?? '—'}</span>
          </button>
        ))}
      </div>

      {viewerIndex !== null && (
        <StoryViewer stories={inSequenza} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </>
  );
}
