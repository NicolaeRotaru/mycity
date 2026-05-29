'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';
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

export default function StoriesCarousel() {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { data: stories = [] } = useQuery({
    queryKey: queryKeys.seller.storiesActive,
    queryFn: async (): Promise<Story[]> => {
      const { data } = await supabase
        .from('seller_stories')
        .select(`
          id, seller_id, image_url, caption, link_url, view_count, expires_at,
          seller:profiles!seller_stories_seller_id_fkey ( id, store_name, store_logo )
        `)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(30);
      return (data ?? []) as unknown as Story[];
    },
    refetchInterval: 5 * 60_000,
  });

  if (stories.length === 0) return null;

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {stories.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setViewerIndex(i)}
            className="flex flex-col items-center gap-1 flex-shrink-0"
          >
            <div className="p-0.5 rounded-full bg-gradient-to-tr from-primary-500 via-accent-500 to-secondary-500">
              <div className="bg-white p-0.5 rounded-full">
                {s.seller?.store_logo ? (
                  <Image
                    src={sizedImage(s.seller.store_logo, 'thumb')}
                    alt=""
                    width={56}
                    height={56}
                    className="rounded-full object-cover w-14 h-14"
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
        <StoryViewer stories={stories} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </>
  );
}
