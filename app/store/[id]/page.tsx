'use client';
import { use, type CSSProperties } from 'react';

import { Megaphone } from 'lucide-react';
import { announcementActive } from '@/lib/store-customization';
import { homePage, enabledSections } from '@/lib/store-site';
import SectionRenderer from '@/components/store-sections/SectionRenderer';
import StoreNav from '@/components/store-sections/StoreNav';
import { useStorePageData } from '@/components/store-sections/useStorePageData';
import { LoadingState } from '@/components/ui/LoadingState';
import { Breadcrumb } from '@/components/ui/Breadcrumb';

export default function StorePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const data = useStorePageData(id);

  if (data.isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <LoadingState />
      </div>
    );
  }
  if (!data.approved || !data.ctx || !data.store) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-ink-500">
        Negozio non trovato.
      </div>
    );
  }

  const { store, custom, accent, socials, reviews, site, ctx } = data;
  const showAnnouncement = announcementActive(custom);
  const home = homePage(site);
  const sections = enabledSections(home);

  // Schema.org LocalBusiness JSON-LD — critical per SEO local
  const localBusinessSchema = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: store.store_name,
    description: store.store_description ?? undefined,
    image: store.store_logo ?? undefined,
    telephone: store.store_phone ?? undefined,
    slogan: custom.tagline || undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: store.store_address ?? undefined,
      addressLocality: 'Piacenza',
      addressRegion: 'PC',
      addressCountry: 'IT',
    },
    geo: (store.store_lat && store.store_lng) ? {
      '@type': 'GeoCoordinates',
      latitude: store.store_lat,
      longitude: store.store_lng,
    } : undefined,
    sameAs: socials.length > 0 ? socials.map((s) => s.href) : undefined,
    aggregateRating: reviews.length > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: (reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length).toFixed(1),
      reviewCount: reviews.length,
    } : undefined,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
  };

  return (
    <div
      data-theme={site.theme}
      style={{ ['--store-accent']: accent } as CSSProperties}
      className="container mx-auto px-4 py-6 max-w-5xl space-y-4"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
      />
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Negozi', href: '/stores' },
        { label: store.store_name ?? 'Negozio' },
      ]} />

      <StoreNav site={site} storeId={ctx.storeId} />

      {/* Banner annuncio (es. ferie / novità) — store-wide, sopra le sezioni */}
      {showAnnouncement && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-cream-50 border px-4 py-3" style={{ borderColor: accent }}>
          <Megaphone size={18} className="shrink-0 mt-0.5" style={{ color: accent }} aria-hidden />
          <p className="text-sm text-ink-800">{custom.announcement?.text}</p>
        </div>
      )}

      {/* Sezioni della home, nell'ordine e con la visibilità scelti dal negozio */}
      <SectionRenderer sections={sections} ctx={ctx} />
    </div>
  );
}
