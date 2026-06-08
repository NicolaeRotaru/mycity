'use client';

import type { LucideIcon } from 'lucide-react';
import { Instagram, Facebook, Globe, MessageCircle, Music2 } from 'lucide-react';
import StoreStoryRing from '@/components/StoreStoryRing';
import StoreMediaCarousel, { type StoreMediaItem } from '@/components/StoreMediaCarousel';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
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

/** Copertina: cover/media, logo (story ring), nome, badge verificato, slogan, badge, social. */
export default function HeroSection({ config, ctx }: { config: SectionConfig<'hero'>; ctx: SectionContext }) {
  const { store, customization: custom, accent } = ctx;
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

  return (
    <div className="bg-white border border-cream-300 rounded-2xl overflow-hidden shadow-warm">
      {/* Striscia colore brand del negozio */}
      <div className="h-1.5" style={{ backgroundColor: accent }} aria-hidden />
      <div className="relative">
        <StoreMediaCarousel media={media} heightClass="h-48 sm:h-72" fallbackClass={coverClassName(custom)} />
        {/* Overlay scuro per contrasto logo + nome */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
        <div className="absolute bottom-4 left-4 z-20 rounded-full shadow-2xl">
          <StoreStoryRing sellerId={store.id} logoUrl={store.store_logo} storeName={store.store_name} />
        </div>
        {hasHours && (
          <span
            className={`absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold shadow ${
              openNow ? 'bg-olive-500 text-white' : 'bg-black/60 text-white'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            {openNow ? 'Aperto ora' : 'Chiuso ora'}
          </span>
        )}
      </div>

      <div className="px-6 py-5">
        <h1 className="text-2xl sm:text-3xl font-bold font-serif text-ink-900 flex items-center gap-2 flex-wrap">
          <span className="truncate">{store.store_name}</span>
          {store.is_approved && <VerifiedBadge size="md" showLabel />}
        </h1>
        {custom.tagline && <p className="text-ink-600 italic mt-1">{custom.tagline}</p>}
        {street && <p className="text-ink-500 text-sm mt-1">{street}</p>}
        {showDescription && store.store_description && (
          <p className="text-ink-700 text-sm mt-3 leading-relaxed">{store.store_description}</p>
        )}

        {showBadges && badges.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {badges.map((b) => (
              <span
                key={b}
                className="inline-flex items-center gap-1.5 bg-cream-100 text-ink-700 border border-cream-200 rounded-full px-2.5 py-1 text-xs font-medium"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
                {badgeLabel(b)}
              </span>
            ))}
          </div>
        )}

        {showSocials && socials.length > 0 && (
          <div className="flex items-center gap-2 mt-4">
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
                  className="w-9 h-9 rounded-full bg-cream-100 hover:bg-cream-200 flex items-center justify-center transition-colors"
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
