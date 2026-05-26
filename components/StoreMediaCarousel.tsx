'use client';

import { useEffect, useRef, useState } from 'react';

export type StoreMediaItem = {
  type: 'image' | 'video';
  url: string;
};

interface Props {
  media: StoreMediaItem[];
  /** Altezza del carousel in classi Tailwind. Default h-48 sm:h-56 */
  heightClass?: string;
  /** Fallback gradient se nessun media */
  fallbackClass?: string;
  /** Bordi arrotondati */
  rounded?: string;
  /** Aspect-ratio dei singoli slot — default coprono tutto */
  className?: string;
}

const StoreMediaCarousel = ({
  media,
  heightClass = 'h-44 sm:h-56',
  fallbackClass = 'bg-gradient-to-br from-primary-500 via-purple-500 to-pink-500',
  rounded = '',
  className = '',
}: Props) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || media.length <= 1) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const idx = Math.round(el.scrollLeft / w);
      setActive(idx);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [media.length]);

  const scrollTo = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  if (!media || media.length === 0) {
    return <div className={`relative w-full ${heightClass} ${rounded} ${fallbackClass} ${className}`} />;
  }

  return (
    <div className={`relative w-full ${heightClass} ${rounded} overflow-hidden bg-cream-100 ${className}`}>
      <div
        ref={scrollerRef}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {media.map((m, i) => (
          <div key={i} className="snap-center shrink-0 w-full h-full relative">
            {m.type === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <video
                src={m.url}
                muted
                playsInline
                preload="metadata"
                controls
                className="w-full h-full object-cover bg-black"
              />
            )}
          </div>
        ))}
      </div>

      {/* Dots */}
      {media.length > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 z-10">
          {media.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.preventDefault(); scrollTo(i); }}
              aria-label={`Slide ${i + 1}`}
              className={`w-2 h-2 rounded-full transition-all ${
                i === active ? 'bg-white w-6' : 'bg-white/50 hover:bg-white/80'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default StoreMediaCarousel;
