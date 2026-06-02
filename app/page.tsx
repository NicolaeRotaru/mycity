import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Store, Check, ShieldCheck, MapPin, ArrowRight, Heart, Sparkles, Gift, Banknote, Home as HomeIcon, Truck, RotateCcw } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import CategoryShowcase from '@/components/CategoryShowcase';
import StoreShowcase from '@/components/StoreShowcase';
import LiveActivityFeed from '@/components/LiveActivityFeed';
import HomeRedirectGuard from '@/components/HomeRedirectGuard';
import NewsletterForm from '@/components/NewsletterForm';
import DropOfDay from '@/components/home/DropOfDay';
import HeroStoreCard from '@/components/home/HeroStoreCard';
import HowItWorks from '@/components/home/HowItWorks';
import HomeCtaLink from '@/components/home/HomeCtaLink';
import ExperimentExposure from '@/components/home/ExperimentExposure';
import MaybeSection from '@/components/home/MaybeSection';
import { DeliveryCutoff } from '@/components/ui/DeliveryCutoff';
import { EXPERIMENTS, expHeaderName, resolveVariant } from '@/lib/experiments';

/**
 * Contenuti dell'hero per variante (A/B test `home_hero`).
 *  - A (controllo): claim "negozi veri" + ingresso alla scoperta.
 *  - B (test): leva sul rischio-zero (paghi alla consegna) come gancio primario.
 * Struttura identica: cambiano solo eyebrow, headline, sottotitolo e label CTA.
 */
const HERO_VARIANTS: Record<string, { eyebrow: string; headline: ReactNode; subhead: ReactNode; ctaPrimary: string }> = {
  a: {
    eyebrow: 'Il marketplace dei negozi di Piacenza',
    headline: (
      <>
        I negozi <span className="text-primary-700 italic">veri</span> di Piacenza,<br />
        ora a casa tua.
      </>
    ),
    subhead: (
      <>
        Alimentari, abbigliamento, casa, elettronica: ordini dai commercianti
        della tua via in pochi tap e <strong className="text-ink-900">paghi alla consegna</strong>.
        A casa in 24-48h.
      </>
    ),
    ctaPrimary: 'Inizia a esplorare',
  },
  b: {
    eyebrow: 'Spesa, moda e casa · consegna a domicilio',
    headline: (
      <>
        Ordini dai negozi di Piacenza.<br />
        <span className="text-primary-700 italic">Paghi alla consegna.</span>
      </>
    ),
    subhead: (
      <>
        Niente carta, nessun rischio: scegli dai commercianti della tua città e
        paghi <strong className="text-ink-900">quando il rider arriva</strong>. A casa in 24-48h.
      </>
    ),
    ctaPrimary: 'Scopri cosa c’è oggi',
  },
};

// NB: ISR non applicabile. next-intl è cookie-based (getLocale/getMessages nel
// root layout leggono i cookie) → tutte le rotte sono dinamiche per-request, e un
// `export const revalidate` sarebbe un no-op finché l'i18n non passa a routing
// per-URL. Le performance qui derivano da: middleware leggero sulle rotte
// pubbliche, aggregazioni via RPC e immagini ottimizzate.

/**
 * Homepage MyCity — "Mediterranean Modern", funnel-first per il PRIMO ORDINE
 * di un nuovo visitatore. Pagina snella e gerarchica: niente sezioni che si
 * sovrappongono o restano vuote in fase di lancio.
 *
 * Architettura del feed (top → bottom):
 *  1. Hero: claim locale + zero-rischio onesto + un CTA dominante + scorciatoie categorie
 *  2. Come funziona (3 step: scegli → ordina → ricevi e paghi alla consegna)
 *  3. Categorie (porta d'ingresso principale)
 *  4. Drop del giorno (opzionale, urgenza singola offerta — si auto-nasconde)
 *  5. Prodotti che vanno forte (catalogo: cuore della conversione)
 *  6. Live activity + "Perché MyCity" (FOMO + reassurance)
 *  7. Negozi vicini (orgoglio locale)
 *  8. Newsletter incentive (€5 primo ordine)
 *  9. CTA venditore (acquisizione supply, banda minima in fondo)
 *
 * NB: le sezioni editoriali/curate (stories, negozio del mese, eventi, trending,
 * promo, storia del giorno, sponsored) restano come componenti su disco ma NON
 * sono renderizzate qui: vanno riattivate quando il catalogo cresce.
 */
export default async function Home() {
  // Variante hero assegnata dal middleware (header x-exp-home_hero); fallback al controllo.
  const heroVariant = resolveVariant(
    EXPERIMENTS.home_hero,
    (await headers()).get(expHeaderName('home_hero')),
  );
  const hero = HERO_VARIANTS[heroVariant] ?? HERO_VARIANTS.a;

  return (
    <div className="bg-surface-50">
      <HomeRedirectGuard />
      <ExperimentExposure experiment="home_hero" variant={heroVariant} />

      {/* HERO — canvas neutro pulito, accenti terracotta, headline serif */}
      <section className="relative overflow-hidden bg-gradient-to-b from-surface-0 to-surface-100">
        {/* Decorazione discreta */}
        <div aria-hidden className="absolute -top-20 -right-20 w-[500px] h-[500px] rounded-full bg-primary-200/40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-20 w-[420px] h-[420px] rounded-full bg-accent-200/40 blur-3xl" />

        <div className="container mx-auto px-4 sm:px-6 py-12 md:py-20 relative">
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-10 items-center">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-1.5 bg-primary-100 text-primary-800 px-3 py-1 rounded-full text-xs font-semibold tracking-wide ring-1 ring-primary-200">
                <Sparkles size={14} strokeWidth={2.4} />
                {hero.eyebrow}
              </span>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold leading-[1.05] tracking-tight text-ink-900">
                {hero.headline}
              </h1>
              <p className="text-lg text-ink-600 max-w-xl leading-relaxed">
                {hero.subhead}
              </p>

              <div className="flex flex-wrap gap-3">
                <HomeCtaLink
                  href="/categorie"
                  ctaId="hero_primary"
                  location="hero"
                  variant={heroVariant}
                  className="inline-flex items-center gap-2 bg-primary-700 hover:bg-primary-800 text-white px-6 py-3 rounded-full font-semibold transition-colors shadow-warm"
                >
                  {hero.ctaPrimary}
                  <ArrowRight size={18} strokeWidth={2.2} />
                </HomeCtaLink>
                <HomeCtaLink
                  href="/stores"
                  ctaId="hero_secondary"
                  location="hero"
                  variant={heroVariant}
                  className="inline-flex items-center gap-2 bg-white hover:bg-surface-100 text-ink-900 border border-surface-300 px-6 py-3 rounded-full font-semibold transition-colors"
                >
                  <Store size={18} strokeWidth={2.2} />
                  Esplora i negozi
                </HomeCtaLink>
              </div>

              {/* Scorciatoie categorie: in fase lancio la scoperta batte la ricerca */}
              <div className="flex flex-wrap gap-2 pt-1">
                {[
                  { slug: 'alimentari',    label: 'Alimentari' },
                  { slug: 'elettronica',   label: 'Elettronica' },
                  { slug: 'abbigliamento', label: 'Abbigliamento' },
                  { slug: 'bellezza',      label: 'Bellezza' },
                  { slug: 'casa',          label: 'Casa & Cucina' },
                ].map((c) => (
                  <HomeCtaLink
                    key={c.slug}
                    href={`/category/${c.slug}`}
                    ctaId={`hero_chip_${c.slug}`}
                    location="hero_chips"
                    variant={heroVariant}
                    className="inline-flex items-center bg-white text-ink-700 hover:text-primary-700 border border-cream-300 hover:border-primary-300 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                  >
                    {c.label}
                  </HomeCtaLink>
                ))}
              </div>

              {/* Urgenza + zero-rischio above the fold */}
              <DeliveryCutoff variant="banner" className="max-w-sm" />

              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm text-ink-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                  Paghi alla consegna
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                  Consegna in 24-48h
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={2.4} className="text-olive-600" />
                  Account solo per confermare
                </span>
              </div>
            </div>

            {/* Card di destra: negozio reale (negozio del mese se impostato, altrimenti in evidenza) */}
            <HeroStoreCard />
          </div>
        </div>
      </section>

      {/* COME FUNZIONA — toglie il freno #1 di chi non ci conosce */}
      <HowItWorks />

      {/* CATEGORIE */}
      <section className="container mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">Cosa cerchi oggi?</h2>
          <p className="text-ink-500 text-sm mt-2">Tutte le categorie del mercato locale</p>
        </div>
        <CategoryShowcase />
      </section>

      {/* DROP DEL GIORNO — gancio singola offerta, si auto-nasconde se assente */}
      <MaybeSection className="container mx-auto px-4 sm:px-6 pb-2">
        <DropOfDay />
      </MaybeSection>

      {/* PRODOTTI POPOLARI — spinti in alto: sono il cuore della conversione */}
      <section className="bg-white border-y border-cream-300 py-12">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-end mb-6 gap-4 flex-wrap">
            <div>
              <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
                <Heart size={14} strokeWidth={2.4} />
                I più amati
              </span>
              <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
                Prodotti che vanno forte
              </h2>
            </div>
            <HomeCtaLink href="/search" ctaId="products_see_all" location="popular_products" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
              Vedi tutto <ArrowRight size={16} strokeWidth={2.4} />
            </HomeCtaLink>
          </div>
          <ProductGrid limit={12} rail />
        </div>
      </section>

      {/* LIVE ACTIVITY + Trust band */}
      <section className="container mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
        <LiveActivityFeed />
        <div className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm">
          <h3 className="font-serif font-bold text-ink-900 text-lg mb-4">Perché scegliere MyCity</h3>
          <ul className="space-y-3">
            {[
              { Icon: Banknote, color: 'olive',     t: 'Paghi alla consegna',     d: 'Niente carta: l’account serve solo per confermare l’ordine.' },
              { Icon: HomeIcon, color: 'primary',   t: '100% commercianti locali', d: 'Solo negozi verificati di Piacenza.' },
              { Icon: Truck,    color: 'accent',    t: 'Consegna in 24-48h',       d: 'Rider del territorio, percorsi brevi.' },
              { Icon: RotateCcw,color: 'secondary', t: 'Reso entro 14 giorni',    d: 'Cambi idea? Ti rimborsiamo senza domande.' },
            ].map((v) => (
              <li key={v.t} className="flex items-start gap-3">
                <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                  v.color === 'olive'     ? 'bg-olive-100 text-olive-700' :
                  v.color === 'primary'   ? 'bg-primary-100 text-primary-700' :
                  v.color === 'accent'    ? 'bg-accent-100 text-accent-700' :
                                            'bg-secondary-100 text-secondary-700'
                }`}>
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

      {/* NEGOZI VICINI */}
      <section className="container mx-auto px-4 sm:px-6 py-12">
        <div className="flex justify-between items-end mb-6 gap-4 flex-wrap">
          <div>
            <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
              <MapPin size={14} strokeWidth={2.4} />
              Vicino a te
            </span>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
              Sostieni i negozi di Piacenza
            </h2>
            <p className="text-ink-500 text-sm mt-1">Ogni ordine aiuta un commerciante della tua città, non un colosso lontano.</p>
          </div>
          <HomeCtaLink href="/stores" ctaId="stores_see_all" location="nearby_stores" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
            Tutti i negozi <ArrowRight size={16} strokeWidth={2.4} />
          </HomeCtaLink>
        </div>
        <StoreShowcase />
      </section>

      {/* NEWSLETTER + REFERRAL */}
      <section className="bg-gradient-to-br from-accent-100 via-accent-50 to-cream-100 border-y border-cream-300">
        <div className="container mx-auto px-4 sm:px-6 py-12 md:py-16 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 bg-white/80 text-primary-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ring-1 ring-primary-200">
              <Gift size={14} strokeWidth={2.4} />
              €5 in regalo
            </span>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-3 mb-3">
              Iscriviti e prendi <span className="text-primary-700">€5 di sconto</span><br />
              al primo ordine.
            </h2>
            <p className="text-ink-700 text-base">
              Ogni venerdì ricevi <strong>"Cosa c'è nel piatto a Piacenza"</strong>:
              una ricetta, la storia di un negoziante, 3 offerte selezionate. Niente spam.
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-warm-lg p-6 border border-cream-300">
            <NewsletterForm variant="light" />
          </div>
        </div>
      </section>

      {/* CTA VENDITORE — banda minima: non ruba attenzione al funnel acquirente */}
      <section className="bg-ink-900 text-white">
        <div className="container mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="shrink-0 w-10 h-10 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center">
              <ShieldCheck size={18} strokeWidth={2.4} className="text-accent-400" />
            </span>
            <p className="text-base md:text-lg">
              <span className="font-serif font-bold">Hai un negozio a Piacenza?</span>{' '}
              <span className="text-ink-300">Vendi online con zero commissioni.</span>
            </p>
          </div>
          <HomeCtaLink
            href="/sell"
            ctaId="seller_cta"
            location="seller_band"
            className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-ink-900 px-5 py-2.5 rounded-full font-bold transition-colors shadow-lg whitespace-nowrap"
          >
            <Store size={18} strokeWidth={2.4} />
            Diventa venditore
          </HomeCtaLink>
        </div>
      </section>
    </div>
  );
}
