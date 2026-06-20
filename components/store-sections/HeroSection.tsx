'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, Instagram, Facebook, Globe, MessageCircle, Music2, Star, MapPin } from 'lucide-react';
import StoreStoryRing from '@/components/StoreStoryRing';
import StoreMediaCarousel, { type StoreMediaItem } from '@/components/StoreMediaCarousel';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { sizedImage } from '@/lib/image-url';
import { coverClassName, socialLinks, badgeLabel } from '@/lib/store-customization';
import { isOpenNow, streetFromAddress, DAY_KEYS, type StoreHours } from '@/lib/store-hours';
import type { SectionConfig, SectionContext } from './SectionContext';

const SOCIAL_ICON: Record<string, LucideIcon> = {
  instagram: Instagram,
  facebook: Facebook,
  tiktok: Music2,
  whatsapp: MessageCircle,
  website: Globe,
};

const HOUR_KEYS: (keyof StoreHours)[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Iniziali del negozio per il logo-tile di fallback (max 2 lettere). */
function initials(name?: string | null): string {
  if (!name) return '·';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Copertina full-bleed: cover/media con gradiente scuro in basso, nome serif in
 * bianco sovrapposto, logo-tile arrotondato, riga meta (rating · zona) e pill di
 * ritorno + badge "Aperto ora"/"Consegna oggi". Mantiene tutte le opzioni di
 * configurazione (showBadges/showSocials/showDescription) e l'accent del negozio.
 *
 * Fallback senza cover: lo stesso gradiente on-brand scelto dal venditore
 * (coverClassName) riempie l'hero, così l'overlay e il testo restano leggibili.
 */
export default function HeroSection({ config, ctx }: { config: SectionConfig<'hero'>; ctx: SectionContext }) {
  const router = useRouter();
  const { store, customization: custom, accent, reviews } = ctx;
  const media = (Array.isArray(store.store_media) ? store.store_media : []) as StoreMediaItem[];
  const street = streetFromAddress(store.store_address);
  const hours = (store.store_hours ?? {}) as StoreHours;
  const todayKey = DAY_KEYS[new Date().getDay()];
  const hasHours = HOUR_KEYS.some((k) => Array.isArray(hours[k]));
  const openNow = isOpenNow(hours[todayKey]);
  const socials = socialLinks(custom);
  const badges = custom.badges ?? [];

  const showBadges = config.showBadges !== false;
  const showSocials = config.showSocials !== false;
  const showDescription = config.showDescription !== false;

  const avgRating = reviews.length
    ? reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length
    : null;

  const cover = media.find((m) => m.type === 'image') ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-warm">
      {/* Striscia colore brand del negozio */}
      <div className="h-1.5" style={{ backgroundColor: accent }} aria-hidden />

      {/* HERO full-bleed (~240px) */}
      <div className="relative h-60 overflow-hidden">
        {cover ? (
          <Image
            src={sizedImage(cover.url, 'hero')}
            alt={`Copertina di ${store.store_name ?? 'questo negozio'}`}
            fill
            sizes="(max-width: 768px) 100vw, 1024px"
            className="object-cover"
            priority
          />
        ) : media.length > 0 ? (
          // Solo video in copertina: riusa il carousel (gestisce i propri controlli).
          <StoreMediaCarousel media={media} heightClass="h-60" fallbackClass={coverClassName(custom)} />
        ) : (
          // Nessun media: gradiente on-brand scelto dal venditore (fallback grazioso).
          <div className={`h-full w-full ${coverClassName(custom)}`} aria-hidden />
        )}

        {/* Gradiente scuro in basso per leggibilità del nome/meta */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(28,26,24,0.12) 0%, rgba(28,26,24,0.78) 100%)' }}
          aria-hidden
        />

        {/* Pill "Indietro" sulla cover */}
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-2 text-sm font-semibold text-ink-800 shadow backdrop-blur-sm transition-colors hover:bg-white"
        >
          <ArrowLeft size={16} strokeWidth={2.2} aria-hidden /> Indietro
        </button>

        {/* Badge stato (Aperto/Chiuso ora) in alto a destra — solo con orari reali */}
        {hasHours && (
          <span
            className={`absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold shadow ${
              openNow ? 'bg-olive-500 text-white' : 'bg-black/60 text-white'
            }`}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
            {openNow ? 'Aperto ora' : 'Chiuso ora'}
          </span>
        )}

        {/* Riga overlay in basso: logo-tile + nome serif + meta */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end gap-4 px-5 pb-4 text-white sm:px-6 sm:pb-5">
          {/* Logo-tile gradiente arrotondato (con story ring se presente) */}
          <div
            className="shrink-0 rounded-2xl shadow-warm-lg"
            style={!store.store_logo ? { background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 65%, #1C1A18))` } : undefined}
          >
            {store.store_logo ? (
              <StoreStoryRing sellerId={store.id} logoUrl={store.store_logo} storeName={store.store_name} />
            ) : (
              <span
                className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl font-serif text-[28px] font-extrabold text-white"
                aria-hidden
              >
                {initials(store.store_name)}
              </span>
            )}
          </div>

          <div className="min-w-[200px] flex-1">
            <h1 className="flex flex-wrap items-center gap-2 font-serif text-[28px] font-extrabold leading-tight text-white sm:text-[34px]">
              <span className="truncate drop-shadow-sm">{store.store_name}</span>
              {store.is_approved && (
                <span className="text-white/90">
                  <VerifiedBadge size="md" />
                </span>
              )}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-white/90">
              {avgRating !== null && (
                <span className="inline-flex items-center gap-1">
                  <Star size={15} className="fill-accent-300 text-accent-300" aria-hidden />
                  <strong className="text-white">{avgRating.toFixed(1).replace('.', ',')}</strong>
                  <span className="text-white/80">· {reviews.length} {reviews.length === 1 ? 'recensione' : 'recensioni'}</span>
                </span>
              )}
              {street && (
                <span className="inline-flex items-center gap-1">
                  {avgRating !== null && <span aria-hidden>·</span>}
                  <MapPin size={14} aria-hidden /> {street}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Corpo: tagline, descrizione, badge, social */}
      <div className="px-6 py-5">
        {custom.tagline && <p className="italic text-ink-600">{custom.tagline}</p>}
        {showDescription && store.store_description && (
          <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-ink-700">{store.store_description}</p>
        )}

        {showBadges && badges.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {badges.map((b) => (
              <span
                key={b}
                className="inline-flex items-center gap-1.5 rounded-full border border-cream-200 bg-cream-100 px-2.5 py-1 text-xs font-medium text-ink-700"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
                {badgeLabel(b)}
              </span>
            ))}
          </div>
        )}

        {showSocials && socials.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            {socials.map((s) => {
              const Icon = SOCIAL_ICON[s.key] ?? Globe;
              return (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={s.label}
                  title={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-100 transition-colors hover:bg-cream-200"
                  style={{ color: accent }}
                >
                  <Icon size={18} aria-hidden />
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
