import Image from 'next/image';
import Link from 'next/link';
import { sizedImage } from '@/lib/image-url';
import { sanitizeRichText } from '@/lib/sanitize-html';
import { homeCtaHref } from '@/lib/home-site';
import type { CmsSection } from '@/lib/cms-page';

/**
 * Render dei blocchi di CONTENUTO (testo/banner/galleria/video) di una pagina CMS.
 * Server Component, senza container proprio: il wrapper (max-width + spacing) lo mette
 * CmsPageView. Stesse regole di sicurezza dei blocchi home (sanitizeRichText, embed
 * video costruiti da provider+id, link CTA solo https/percorso interno).
 */
function Block({ section }: { section: CmsSection }) {
  switch (section.type) {
    case 'richText': {
      const c = section.config;
      const heading = (c.heading ?? '').trim();
      const clean = sanitizeRichText(c.body);
      if (!heading && !clean) return null;
      return (
        <section className="bg-white border border-cream-300 rounded-2xl p-6">
          {heading && <h2 className="text-xl sm:text-2xl font-bold font-serif text-ink-900 mb-3">{heading}</h2>}
          {clean && <div className="store-richtext text-ink-700 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: clean }} />}
        </section>
      );
    }
    case 'banner': {
      const c = section.config;
      if (!c.imageUrl) return null;
      const overlay = c.overlay ?? 'dark';
      const overlayClass = overlay === 'dark' ? 'bg-black/40' : overlay === 'light' ? 'bg-white/30' : '';
      const textClass = overlay === 'light' ? 'text-ink-900' : 'text-white';
      const href = c.cta ? homeCtaHref(c.cta.href) : null;
      const external = !!href && /^https?:\/\//i.test(href);
      const ctaClass = 'inline-flex items-center gap-1.5 rounded-full bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 text-sm font-semibold shadow-warm transition-transform hover:-translate-y-0.5';
      return (
        <section className="relative w-full h-56 sm:h-72 overflow-hidden rounded-2xl border border-cream-300 shadow-warm">
          <Image src={sizedImage(c.imageUrl, 'hero')} alt={c.heading ?? ''} fill sizes="(max-width: 768px) 100vw, 1024px" className="object-cover" />
          {overlayClass && <div className={`absolute inset-0 ${overlayClass}`} aria-hidden />}
          <div className={`absolute inset-0 flex flex-col items-start justify-end gap-2 p-6 ${textClass}`}>
            {c.heading && <h2 className="text-2xl sm:text-3xl font-bold font-serif drop-shadow">{c.heading}</h2>}
            {c.subheading && <p className="text-sm sm:text-base max-w-xl drop-shadow">{c.subheading}</p>}
            {c.cta && href && (
              external
                ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={ctaClass}>{c.cta.label}</a>
                : <Link href={href} className={ctaClass}>{c.cta.label}</Link>
            )}
          </div>
        </section>
      );
    }
    case 'gallery': {
      const c = section.config;
      const items = c.items ?? [];
      if (items.length === 0) return null;
      return (
        <section>
          {c.heading && <h2 className="text-2xl font-serif font-bold text-ink-900 mb-4">{c.heading}</h2>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((it, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-cream-100 border border-cream-200">
                <Image src={sizedImage(it.url, 'card')} alt={it.alt ?? ''} fill sizes="(max-width: 640px) 50vw, 33vw" className="object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </section>
      );
    }
    case 'video': {
      const c = section.config;
      if (!c.videoId) return null;
      const src = c.provider === 'youtube'
        ? `https://www.youtube-nocookie.com/embed/${c.videoId}`
        : `https://player.vimeo.com/video/${c.videoId}`;
      return (
        <section>
          {c.heading && <h2 className="text-2xl font-serif font-bold text-ink-900 mb-4">{c.heading}</h2>}
          <div className="relative w-full aspect-video overflow-hidden rounded-2xl border border-cream-300 bg-black">
            <iframe src={src} title={c.heading || 'Video'} className="absolute inset-0 w-full h-full" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
          </div>
        </section>
      );
    }
    default:
      return null;
  }
}

export default function CmsBlockRenderer({ sections }: { sections: CmsSection[] }) {
  return <>{sections.map((s) => <Block key={s.id} section={s} />)}</>;
}
