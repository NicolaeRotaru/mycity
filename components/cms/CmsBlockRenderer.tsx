import Image from 'next/image';
import Link from 'next/link';
import { sizedImage } from '@/lib/image-url';
import caricatoreFotoRemote from '@/lib/image-loader';
import { sanitizeRichText } from '@/lib/sanitize-html';
import { homeCtaHref } from '@/lib/home-site';
import { CLASSI_FASCIA_BANNER, CLASSI_TESTO_FASCIA_BANNER } from '@/lib/banner-vetrina';
import type { CmsSection } from '@/lib/cms-page';
import VideoAlClic from '@/components/store-sections/VideoAlClic';

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
      // 5/11/2026 (S05) — Come la home: con il velo «nessuno» resta una sfumatura minima
      // dal basso, altrimenti la scritta bianca sulla foto chiara non si legge.
      const overlayClass = overlay === 'dark' ? 'bg-black/40' : overlay === 'light' ? 'bg-white/30' : 'bg-gradient-to-t from-black/45 via-black/10 to-transparent';
      const textClass = overlay === 'light' ? 'text-ink-900' : 'text-white';
      const href = c.cta ? homeCtaHref(c.cta.href) : null;
      const external = !!href && /^https?:\/\//i.test(href);
      const ctaClass = 'inline-flex items-center gap-1.5 rounded-full bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 text-sm font-semibold shadow-warm transition-transform hover:-translate-y-0.5';
      // Stessa fascia della home, stessa forma: il banner delle pagine CMS
      // aveva la sua copia dell'altezza fissa, e con essa la stessa malattia.
      return (
        <section className={CLASSI_FASCIA_BANNER}>
          {/* Il testo alternativo è quello scritto nel pannello (vuoto = solo sfondo), non il
              titolo che sta già scritto a video. */}
          <Image src={sizedImage(c.imageUrl, 'hero')} alt={c.alt ?? ''} fill sizes="(max-width: 768px) 100vw, 1024px" loader={caricatoreFotoRemote} className="object-cover" />
          {overlayClass && <div className={`absolute inset-0 ${overlayClass}`} aria-hidden />}
          <div className={`${CLASSI_TESTO_FASCIA_BANNER} ${textClass}`}>
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
                <Image src={sizedImage(it.url, 'card')} alt={it.alt ?? ''} fill sizes="(max-width: 640px) 50vw, 33vw" loader={caricatoreFotoRemote} className="object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </section>
      );
    }
    case 'video': {
      const c = section.config;
      // 5/11/2026 (S05) — Il video «file» (indirizzo di un MP4) lo salva lo stesso modulo
      // della home: qui il ramo mancava e il blocco spariva dalla pagina.
      const isFile = c.provider === 'file';
      if (isFile ? !c.videoUrl : !c.videoId) return null;
      const src = c.provider === 'youtube'
        ? `https://www.youtube-nocookie.com/embed/${c.videoId}`
        : `https://player.vimeo.com/video/${c.videoId}?dnt=1`;
      return (
        <section>
          {c.heading && <h2 className="text-2xl font-serif font-bold text-ink-900 mb-4">{c.heading}</h2>}
          <div className="relative w-full aspect-video overflow-hidden rounded-2xl border border-cream-300 bg-black">
            {isFile ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={c.videoUrl} controls playsInline preload="metadata" className="absolute inset-0 w-full h-full object-contain" aria-label={c.heading || 'Video'} />
            ) : (
            // R11-025 — come vetrina e home: l'iframe di YouTube/Vimeo nasce solo al tocco, non appena
            // la pagina si apre (prima il browser contattava Google o Vimeo senza che nessuno lo chiedesse).
            <VideoAlClic provider={c.provider === 'vimeo' ? 'vimeo' : 'youtube'} src={src} titolo={c.heading || 'Video'} />
            )}
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
