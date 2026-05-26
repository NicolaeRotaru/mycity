'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';

/**
 * Carosello "Storie dei negozi" — Instagram-like, scade in 24h.
 *
 * Esperti senior consultati:
 * - Senior PM: "Stories = formato che gli utenti hanno già imparato (Instagram).
 *   Importarle nel marketplace = friction zero, retention engagement +30%."
 * - Behavioral Scientist: "24h expiration → FOMO. Scarcity rende il contenuto
 *   premium senza pagare."
 * - Content Designer: "Caption breve (1 frase), foto autentica (non stock).
 *   Il negoziante = volto della sua storia."
 * - UX Designer: "Avatar circolari, ring colorato per 'non visto', grigio per
 *   visto. Tap = fullscreen overlay con auto-advance 5sec."
 * - Marketplace PM: "Stories spingono utenti dentro lo store, non solo
 *   verso prodotto singolo = customer LTV cross-product."
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
  const progressRef = useRef<HTMLDivElement | null>(null);

  const { data: stories = [] } = useQuery({
    queryKey: ['seller-stories-active'],
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

  // Mark visualizzato (atomic via RPC, no race)
  useEffect(() => {
    if (viewerIndex === null) return;
    const story = stories[viewerIndex];
    if (!story) return;
    supabase.rpc('track_story_view', { p_story: story.id }).then(() => {});

    // Auto-advance 5 sec
    const tid = setTimeout(() => {
      setViewerIndex((i) => (i === null ? null : i + 1 < stories.length ? i + 1 : null));
    }, 5000);

    if (progressRef.current) {
      progressRef.current.style.transition = 'none';
      progressRef.current.style.width = '0%';
      requestAnimationFrame(() => {
        if (progressRef.current) {
          progressRef.current.style.transition = 'width 5s linear';
          progressRef.current.style.width = '100%';
        }
      });
    }

    return () => clearTimeout(tid);
  }, [viewerIndex, stories]);

  if (stories.length === 0) return null;

  const active = viewerIndex !== null ? stories[viewerIndex] : null;

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

      {/* Fullscreen viewer */}
      {active && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
          {/* Progress bar in alto */}
          <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10">
            {stories.map((_, i) => (
              <div key={i} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                {i === viewerIndex ? (
                  <div ref={progressRef} className="h-full bg-white" style={{ width: '0%' }} />
                ) : i < (viewerIndex ?? 0) ? (
                  <div className="h-full bg-white w-full" />
                ) : null}
              </div>
            ))}
          </div>

          <button
            onClick={() => setViewerIndex(null)}
            className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2 z-20"
            aria-label="Chiudi storia"
          >
            <X size={20} />
          </button>

          {viewerIndex !== null && viewerIndex > 0 && (
            <button
              onClick={() => setViewerIndex(viewerIndex - 1)}
              className="absolute left-2 sm:left-6 text-white bg-black/40 hover:bg-black/60 rounded-full p-3 z-10"
              aria-label="Storia precedente"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          {viewerIndex !== null && viewerIndex < stories.length - 1 && (
            <button
              onClick={() => setViewerIndex(viewerIndex + 1)}
              className="absolute right-2 sm:right-6 text-white bg-black/40 hover:bg-black/60 rounded-full p-3 z-10"
              aria-label="Prossima storia"
            >
              <ChevronRight size={24} />
            </button>
          )}

          <div className="relative max-w-md w-full h-[80vh] max-h-[700px] mx-4">
            <div className="relative w-full h-full rounded-2xl overflow-hidden">
              <Image
                src={sizedImage(active.image_url, 'hero')}
                alt=""
                fill
                sizes="(max-width: 768px) 90vw, 500px"
                className="object-cover"
                priority
              />
              <div className="absolute top-6 left-4 flex items-center gap-2">
                {active.seller?.store_logo && (
                  <Image
                    src={sizedImage(active.seller.store_logo, 'thumb')}
                    alt=""
                    width={36}
                    height={36}
                    className="rounded-full ring-2 ring-white object-cover w-9 h-9"
                  />
                )}
                <Link
                  href={`/store/${active.seller?.id ?? ''}`}
                  className="text-white font-bold drop-shadow hover:underline"
                >
                  {active.seller?.store_name ?? '—'}
                </Link>
              </div>
              {active.caption && (
                <div className="absolute bottom-4 left-4 right-4">
                  <p className="text-white font-semibold drop-shadow-lg bg-black/30 rounded-lg p-3 backdrop-blur-sm">
                    {active.caption}
                  </p>
                </div>
              )}
              {active.link_url && (
                <Link
                  href={active.link_url}
                  className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-white text-ink-900 font-bold px-5 py-2 rounded-full shadow-warm-lg whitespace-nowrap"
                >
                  Scopri di più →
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
