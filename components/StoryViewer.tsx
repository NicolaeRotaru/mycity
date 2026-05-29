'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';

/**
 * Viewer fullscreen riusabile per le storie (Instagram-like).
 * Estratto da StoriesCarousel così può essere usato anche dall'anello storia
 * sulla pagina del negozio (StoreStoryRing). Auto-advance 5s + progress bar.
 */
export type StoryItem = {
  id: string;
  image_url: string;
  caption: string | null;
  link_url: string | null;
  seller?: {
    id: string;
    store_name: string | null;
    store_logo: string | null;
  } | null;
};

type Props = {
  stories: StoryItem[];
  startIndex?: number;
  onClose: () => void;
};

export default function StoryViewer({ stories, startIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const progressRef = useRef<HTMLDivElement | null>(null);
  // onClose può cambiare identità ad ogni render del parent: lo teniamo in un ref
  // così l'effetto non si ri-arma di continuo.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const story = stories[index];
    if (!story) {
      onCloseRef.current();
      return;
    }
    supabase.rpc('track_story_view', { p_story: story.id }).then(() => {});

    const tid = setTimeout(() => {
      if (index + 1 < stories.length) setIndex(index + 1);
      else onCloseRef.current();
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
  }, [index, stories]);

  // Tasti freccia + Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIndex((i) => (i + 1 < stories.length ? i + 1 : i));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stories.length]);

  const active = stories[index];
  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
      {/* Progress bar in alto */}
      <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10">
        {stories.map((_, i) => (
          <div key={i} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
            {i === index ? (
              <div ref={progressRef} className="h-full bg-white" style={{ width: '0%' }} />
            ) : i < index ? (
              <div className="h-full bg-white w-full" />
            ) : null}
          </div>
        ))}
      </div>

      <button
        onClick={() => onCloseRef.current()}
        className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2 z-20"
        aria-label="Chiudi storia"
      >
        <X size={20} />
      </button>

      {index > 0 && (
        <button
          onClick={() => setIndex(index - 1)}
          className="absolute left-2 sm:left-6 text-white bg-black/40 hover:bg-black/60 rounded-full p-3 z-10"
          aria-label="Storia precedente"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {index < stories.length - 1 && (
        <button
          onClick={() => setIndex(index + 1)}
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
          {active.seller && (
            <div className="absolute top-6 left-4 flex items-center gap-2">
              {active.seller.store_logo && (
                <Image
                  src={sizedImage(active.seller.store_logo, 'thumb')}
                  alt=""
                  width={36}
                  height={36}
                  className="rounded-full ring-2 ring-white object-cover w-9 h-9"
                />
              )}
              <Link
                href={`/store/${active.seller.id ?? ''}`}
                className="text-white font-bold drop-shadow hover:underline"
              >
                {active.seller.store_name ?? '—'}
              </Link>
            </div>
          )}
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
  );
}
