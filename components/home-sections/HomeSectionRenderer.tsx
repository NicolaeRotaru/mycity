import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Store, Check, ShieldCheck, ArrowRight, Heart, Sparkles, Gift,
  Banknote, Home as HomeIcon, Truck, RotateCcw,
} from 'lucide-react';
import { sizedImage } from '@/lib/image-url';
import { sanitizeRichText } from '@/lib/sanitize-html';
import { homeCtaHref, type HomeSection } from '@/lib/home-site';
import ProductGrid from '@/components/ProductGrid';
import CategoryShowcase from '@/components/CategoryShowcase';
import StoreShowcase from '@/components/StoreShowcase';
import LiveActivityFeed from '@/components/LiveActivityFeed';
import NewsletterForm from '@/components/NewsletterForm';
import DropOfDay from '@/components/home/DropOfDay';
import HeroStoreCard from '@/components/home/HeroStoreCard';
import HowItWorks from '@/components/home/HowItWorks';
import HomeCtaLink from '@/components/home/HomeCtaLink';
import MaybeSection from '@/components/home/MaybeSection';
import ShopOfMonthHero from '@/components/home/ShopOfMonthHero';
import StoriesCarousel from '@/components/home/StoriesCarousel';
import HomeEvents from '@/components/home/HomeEvents';
import PromoDeals from '@/components/home/PromoDeals';
import TrendingNow from '@/components/home/TrendingNow';
import ReorderRail from '@/components/home-sections/ReorderRail';
import { DeliveryCutoff } from '@/components/ui/DeliveryCutoff';

/**
 * Renderer della HOME componibile: mappa ogni sezione (unione discriminata di
 * lib/home-site.ts) al suo blocco JSX, riproducendo fedelmente la "chrome" che oggi
 * vive in app/page.tsx. I testi di default vivono QUI come fallback: una config vuota
 * rende identica alla home attuale; una config valorizzata sovrascrive il testo.
 *
 * Server Component: rende sia markup statico sia i componenti client interni
 * (self-fetch via React Query). L'hero riceve la variante A/B risolta a monte.
 */

export type HeroDefaults = {
  eyebrow: string;
  headline: ReactNode;
  subhead: ReactNode;
  ctaPrimary: string;
};

const HERO_CHIPS = [
  { slug: 'alimentari',    label: 'Alimentari' },
  { slug: 'elettronica',   label: 'Elettronica' },
  { slug: 'abbigliamento', label: 'Abbigliamento' },
  { slug: 'bellezza',      label: 'Bellezza' },
  { slug: 'casa',          label: 'Casa & Cucina' },
];

const DEFAULT_TRUST_BULLETS = [
  { Icon: Banknote,  color: 'olive',     t: 'Puoi pagare alla consegna', d: 'Carta o contanti, decidi tu: l’account serve solo per confermare l’ordine.' },
  { Icon: HomeIcon,  color: 'primary',   t: '100% commercianti locali', d: 'Solo negozi verificati di Piacenza.' },
  { Icon: Truck,     color: 'accent',    t: 'Consegna in 24-48h',       d: 'Rider del territorio, percorsi brevi.' },
  { Icon: RotateCcw, color: 'secondary', t: 'Reso entro 14 giorni',     d: 'Cambi idea? Ti rimborsiamo senza domande.' },
] as const;

function trustColorClass(color: string): string {
  switch (color) {
    case 'olive':     return 'bg-olive-100 text-olive-700';
    case 'primary':   return 'bg-primary-100 text-primary-700';
    case 'accent':    return 'bg-accent-100 text-accent-700';
    default:          return 'bg-secondary-100 text-secondary-700';
  }
}

function HomeBlock({
  section,
  heroVariant,
  heroDefaults,
}: {
  section: HomeSection;
  heroVariant: string;
  heroDefaults: HeroDefaults;
}) {
  switch (section.type) {
    /* ---------------------------------------------------------------- HERO */
    case 'hero': {
      const c = section.config;
      const eyebrow = c.eyebrow || heroDefaults.eyebrow;
      const headline: ReactNode = c.headline ? c.headline : heroDefaults.headline;
      const subhead: ReactNode = c.subhead ? c.subhead : heroDefaults.subhead;
      const ctaPrimary = c.ctaLabel || heroDefaults.ctaPrimary;
      const showChips = c.showChips !== false;
      return (
        <section className="relative overflow-hidden bg-gradient-to-b from-surface-0 to-surface-100">
          <div aria-hidden className="absolute -top-20 -right-20 w-[500px] h-[500px] rounded-full bg-primary-200/40 blur-3xl" />
          <div aria-hidden className="absolute -bottom-32 -left-20 w-[420px] h-[420px] rounded-full bg-accent-200/40 blur-3xl" />
          <div className="container mx-auto px-4 sm:px-6 py-6 md:py-10 relative">
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-10 items-center">
              <div className="space-y-6">
                <span className="inline-flex items-center gap-1.5 bg-primary-100 text-primary-800 px-3 py-1 rounded-full text-xs font-semibold tracking-wide ring-1 ring-primary-200">
                  <Sparkles size={14} strokeWidth={2.4} />
                  {eyebrow}
                </span>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold leading-[1.05] tracking-tight text-ink-900">
                  {headline}
                </h1>
                <p className="text-lg text-ink-600 max-w-xl leading-relaxed">{subhead}</p>

                <div className="flex flex-wrap gap-3">
                  <HomeCtaLink
                    href="/categorie"
                    ctaId="hero_primary"
                    location="hero"
                    variant={heroVariant}
                    className="inline-flex items-center gap-2 bg-primary-700 hover:bg-primary-800 text-white px-6 py-3 rounded-full font-semibold transition-colors shadow-warm"
                  >
                    {ctaPrimary}
                    <ArrowRight size={18} strokeWidth={2.2} />
                  </HomeCtaLink>
                  <HomeCtaLink
                    href="/stores"
                    ctaId="hero_secondary"
                    location="hero"
                    variant={heroVariant}
                    className="inline-flex items-center justify-center gap-2 bg-white border border-cream-300 hover:bg-cream-50 text-ink-900 px-5 py-3 text-base min-h-[48px] rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
                  >
                    <Store size={18} strokeWidth={2.4} />
                    Esplora i negozi
                  </HomeCtaLink>
                </div>

                {showChips && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {HERO_CHIPS.map((cat) => (
                      <HomeCtaLink
                        key={cat.slug}
                        href={`/category/${cat.slug}`}
                        ctaId={`hero_chip_${cat.slug}`}
                        location="hero_chips"
                        variant={heroVariant}
                        className="inline-flex items-center bg-white text-ink-700 hover:text-primary-700 border border-cream-300 hover:border-primary-300 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                      >
                        {cat.label}
                      </HomeCtaLink>
                    ))}
                  </div>
                )}

                <DeliveryCutoff variant="banner" className="max-w-sm" />

                <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm text-ink-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                    Paghi alla consegna
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                    Oggi se disponibile · 24-48h negli altri casi
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                    Account solo per confermare
                  </span>
                </div>
              </div>

              <HeroStoreCard />
            </div>
          </div>
        </section>
      );
    }

    /* -------------------------------------------------------- COME FUNZIONA */
    case 'howItWorks':
      return <HowItWorks />;

    /* ------------------------------------------------------------ CATEGORIE */
    case 'categories': {
      const c = section.config;
      return (
        <section className="container mx-auto px-4 sm:px-6 py-6">
          <div className="text-center mb-5">
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">
              {c.heading || 'Cosa cerchi oggi?'}
            </h2>
            <p className="text-ink-500 text-sm mt-2">
              {c.subheading || 'Tutte le categorie del mercato locale'}
            </p>
          </div>
          <CategoryShowcase />
        </section>
      );
    }

    /* --------------------------------------------------------- DROP DEL GIORNO */
    case 'dropOfDay':
      return (
        <MaybeSection className="container mx-auto px-4 sm:px-6 pb-2">
          <DropOfDay />
        </MaybeSection>
      );

    /* ------------------------------------------------------ PRODOTTI POPOLARI */
    case 'popularProducts': {
      const c = section.config;
      return (
        <section className="bg-white border-y border-cream-300 py-6">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="flex justify-between items-end mb-5 gap-4 flex-wrap">
              <div>
                <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
                  <Heart size={14} strokeWidth={2.4} />
                  {c.eyebrow || 'I più amati'}
                </span>
                <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
                  {c.heading || 'Prodotti che vanno forte'}
                </h2>
              </div>
              <HomeCtaLink href="/search" ctaId="products_see_all" location="popular_products" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
                Vedi tutto <ArrowRight size={16} strokeWidth={2.4} />
              </HomeCtaLink>
            </div>
            <ProductGrid limit={c.limit ?? 12} rail />
          </div>
        </section>
      );
    }

    /* ------------------------------------------------ LIVE ACTIVITY + TRUST */
    case 'liveActivity': {
      const c = section.config;
      const bullets = c.bullets && c.bullets.length > 0
        ? c.bullets.map((b) => ({ Icon: Check, color: 'primary' as const, t: b.title, d: b.desc }))
        : DEFAULT_TRUST_BULLETS;
      return (
        <section className="container mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
          <LiveActivityFeed />
          <div className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm">
            <h3 className="font-serif font-bold text-ink-900 text-lg mb-4">
              {c.trustTitle || 'Perché scegliere MyCity'}
            </h3>
            <ul className="space-y-3">
              {bullets.map((v) => (
                <li key={v.t} className="flex items-start gap-3">
                  <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${trustColorClass(v.color)}`}>
                    <v.Icon size={20} strokeWidth={2.2} />
                  </span>
                  <div>
                    <p className="font-semibold text-ink-900">{v.t}</p>
                    <p className="text-sm text-ink-600">{v.d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    }

    /* --------------------------------------------------------- BANDA FIDUCIA */
    case 'trustRow':
      return (
        <section className="bg-cream-50 border-y border-cream-300">
          <div className="container mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {DEFAULT_TRUST_BULLETS.map((v) => (
              <div key={v.t} className="flex items-start gap-3">
                <span className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center ${trustColorClass(v.color)}`}>
                  <v.Icon size={20} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900 leading-tight">{v.t}</p>
                  <p className="text-sm text-ink-600 mt-0.5 leading-snug">{v.d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      );

    /* ---------------------------------------------------------- NEGOZI VICINI */
    case 'nearbyStores': {
      const c = section.config;
      return (
        <section className="container mx-auto px-4 sm:px-6 py-6">
          <div className="flex justify-between items-end mb-5 gap-4 flex-wrap">
            <div>
              <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
                <Store size={14} strokeWidth={2.4} />
                {c.eyebrow || 'Vicino a te'}
              </span>
              <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
                {c.heading || 'Sostieni i negozi di Piacenza'}
              </h2>
              <p className="text-ink-500 text-sm mt-1">
                {c.subheading || 'Ogni ordine aiuta un commerciante della tua città, non un colosso lontano.'}
              </p>
            </div>
            <HomeCtaLink href="/stores" ctaId="stores_see_all" location="nearby_stores" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
              Tutti i negozi <ArrowRight size={16} strokeWidth={2.4} />
            </HomeCtaLink>
          </div>
          <StoreShowcase />
        </section>
      );
    }

    /* --------------------------------------------------------- ORDINA DI NUOVO */
    // Rail di riordino: self-fetch + self-hide (ospiti / zero ordini) nel componente.
    case 'reorder':
      return <ReorderRail />;

    /* -------------------------------------------------------------- NEWSLETTER */
    case 'newsletter': {
      const c = section.config;
      return (
        <section className="bg-gradient-to-br from-accent-100 via-accent-50 to-cream-100 border-y border-cream-300">
          <div className="container mx-auto px-4 sm:px-6 py-6 md:py-8 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 bg-white/80 text-primary-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ring-1 ring-primary-200">
                <Gift size={14} strokeWidth={2.4} />
                {c.badge || '€5 in regalo'}
              </span>
              <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-3 mb-3">
                {c.heading ? c.heading : (
                  <>Iscriviti e prendi <span className="text-primary-700">€5 di sconto</span><br />al primo ordine.</>
                )}
              </h2>
              <p className="text-ink-700 text-base">
                {c.body ? c.body : (
                  <>Ogni venerdì ricevi <strong>&quot;Cosa c&apos;è nel piatto a Piacenza&quot;</strong>: una ricetta, la storia di un negoziante, 3 offerte selezionate. Niente spam.</>
                )}
              </p>
            </div>
            <div className="bg-white rounded-2xl shadow-warm-lg p-6 border border-cream-300">
              <NewsletterForm variant="light" />
            </div>
          </div>
        </section>
      );
    }

    /* ------------------------------------------------------------ CTA VENDITORE */
    case 'sellerCta': {
      const c = section.config;
      return (
        <section className="bg-ink-900 text-white">
          <div className="container mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="shrink-0 w-10 h-10 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center">
                <ShieldCheck size={18} strokeWidth={2.4} className="text-accent-400" />
              </span>
              <p className="text-base md:text-lg">
                <span className="font-serif font-bold">{c.heading || 'Hai un negozio a Piacenza?'}</span>{' '}
                <span className="text-ink-300">{c.subtext || 'Vendi online con zero commissioni.'}</span>
              </p>
            </div>
            <HomeCtaLink
              href={c.href || '/sell'}
              ctaId="seller_cta"
              location="seller_band"
              className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-ink-900 px-5 py-2.5 rounded-full font-bold transition-colors shadow-lg whitespace-nowrap"
            >
              <Store size={18} strokeWidth={2.4} />
              {c.ctaLabel || 'Diventa venditore'}
            </HomeCtaLink>
          </div>
        </section>
      );
    }

    /* ----------------------------------------------- SEZIONI EDITORIALI (dormienti) */
    case 'shopOfMonth':
      return <div className="container mx-auto px-4 sm:px-6 py-4"><ShopOfMonthHero /></div>;
    case 'stories':
      return <div className="container mx-auto px-4 sm:px-6 py-4"><StoriesCarousel /></div>;
    case 'events':
      return <div className="container mx-auto px-4 sm:px-6 py-4"><HomeEvents /></div>;
    case 'promo':
      return <div className="container mx-auto px-4 sm:px-6 py-4"><PromoDeals /></div>;
    case 'trending':
      return <div className="container mx-auto px-4 sm:px-6 py-4"><TrendingNow /></div>;

    /* ----------------------------------------------------- BLOCCHI DI CONTENUTO */
    case 'richText': {
      const c = section.config;
      const heading = (c.heading ?? '').trim();
      const clean = sanitizeRichText(c.body);
      if (!heading && !clean) return null;
      return (
        <section className="container mx-auto px-4 sm:px-6 py-5">
          <div className="bg-white border border-cream-300 rounded-2xl p-6 max-w-4xl mx-auto">
            {heading && <h2 className="text-xl sm:text-2xl font-bold font-serif text-ink-900 mb-3">{heading}</h2>}
            {clean && (
              <div className="store-richtext text-ink-700 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: clean }} />
            )}
          </div>
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
        <section className="container mx-auto px-4 sm:px-6 py-5">
          <div className="relative w-full h-56 sm:h-72 overflow-hidden rounded-2xl border border-cream-300 shadow-warm">
            <Image src={sizedImage(c.imageUrl, 'hero')} alt={c.heading ?? ''} fill sizes="(max-width: 768px) 100vw, 1024px" className="object-cover" />
            {overlayClass && <div className={`absolute inset-0 ${overlayClass}`} aria-hidden />}
            <div className={`absolute inset-0 flex flex-col items-start justify-end gap-2 p-6 ${textClass}`}>
              {c.heading && <h2 className="text-2xl sm:text-3xl font-bold font-serif drop-shadow">{c.heading}</h2>}
              {c.subheading && <p className="text-sm sm:text-base max-w-xl drop-shadow">{c.subheading}</p>}
              {c.cta && href && (
                external ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={ctaClass}>{c.cta.label}</a>
                ) : (
                  <Link href={href} className={ctaClass}>{c.cta.label}</Link>
                )
              )}
            </div>
          </div>
        </section>
      );
    }

    case 'gallery': {
      const c = section.config;
      const items = c.items ?? [];
      if (items.length === 0) return null;
      return (
        <section className="container mx-auto px-4 sm:px-6 py-5">
          {c.heading && <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mb-4 text-center">{c.heading}</h2>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-4xl mx-auto">
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
      const isFile = c.provider === 'file';
      if (isFile ? !c.videoUrl : !c.videoId) return null;
      const embedSrc = c.provider === 'vimeo'
        ? `https://player.vimeo.com/video/${c.videoId}`
        : `https://www.youtube-nocookie.com/embed/${c.videoId}`;
      return (
        <section className="container mx-auto px-4 sm:px-6 py-5">
          {c.heading && <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mb-4 text-center">{c.heading}</h2>}
          <div className="relative w-full aspect-video overflow-hidden rounded-2xl border border-cream-300 bg-black max-w-4xl mx-auto">
            {isFile ? (
              <video
                src={c.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 w-full h-full object-contain"
              >
                <track kind="captions" />
              </video>
            ) : (
              <iframe
                src={embedSrc}
                title={c.heading || 'Video'}
                className="absolute inset-0 w-full h-full"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            )}
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}

export default function HomeSectionRenderer({
  sections,
  heroVariant,
  heroDefaults,
}: {
  sections: HomeSection[];
  heroVariant: string;
  heroDefaults: HeroDefaults;
}) {
  return (
    <>
      {sections.map((s) => (
        <HomeBlock key={s.id} section={s} heroVariant={heroVariant} heroDefaults={heroDefaults} />
      ))}
    </>
  );
}
