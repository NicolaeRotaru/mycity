'use client';

import Image from 'next/image';
import Link from 'next/link';
import { sizedImage } from '@/lib/image-url';
import { ctaHref } from '@/lib/store-site';
import type { SectionConfig, SectionContext } from './SectionContext';

/** Banner: immagine grande con titolo, sottotitolo e pulsante CTA (link interno/esterno). */
export default function BannerSection({ config, ctx }: { config: SectionConfig<'banner'>; ctx: SectionContext }) {
  if (!config.imageUrl) return null;

  const overlay = config.overlay ?? 'dark';
  const overlayClass = overlay === 'dark' ? 'bg-black/40' : overlay === 'light' ? 'bg-white/30' : '';
  const textClass = overlay === 'light' ? 'text-ink-900' : 'text-white';

  const href = config.cta ? ctaHref(config.cta.target, ctx.storeId, ctx.site) : null;
  const external = config.cta?.target.kind === 'external';
  const ctaClass = 'inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold shadow-warm transition-transform hover:-translate-y-0.5';
  const ctaStyle = { backgroundColor: ctx.accent, color: '#fff' };

  return (
    <section className="relative w-full h-56 sm:h-72 overflow-hidden rounded-2xl border border-cream-300 shadow-warm">
      <Image
        src={sizedImage(config.imageUrl, 'hero')}
        alt={config.heading ?? ''}
        fill
        sizes="(max-width: 768px) 100vw, 1024px"
        className="object-cover"
      />
      {overlayClass && <div className={`absolute inset-0 ${overlayClass}`} aria-hidden />}
      <div className={`absolute inset-0 flex flex-col items-start justify-end gap-2 p-6 ${textClass}`}>
        {config.heading && <h2 className="text-2xl sm:text-3xl font-bold font-serif drop-shadow">{config.heading}</h2>}
        {config.subheading && <p className="text-sm sm:text-base max-w-xl drop-shadow">{config.subheading}</p>}
        {config.cta && href && (
          external ? (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={ctaClass} style={ctaStyle}>
              {config.cta.label}
            </a>
          ) : (
            <Link href={href} className={ctaClass} style={ctaStyle}>
              {config.cta.label}
            </Link>
          )
        )}
      </div>
    </section>
  );
}
