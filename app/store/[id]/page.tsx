'use client';
import { use, type CSSProperties } from 'react';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, PencilLine, Store } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { announcementActive } from '@/lib/store-customization';
import { homePage, enabledSections } from '@/lib/store-site';
import SectionRenderer from '@/components/store-sections/SectionRenderer';
import StoreNav from '@/components/store-sections/StoreNav';
import { useStorePageData } from '@/components/store-sections/useStorePageData';
import { LoadingState } from '@/components/ui/LoadingState';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import EmptyState from '@/components/EmptyState';

export default function StorePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const data = useStorePageData(id);

  // Identità del visitatore: se è il proprietario del negozio mostriamo una
  // scorciatoia per modificare la vetrina (stesso pattern delle pagine custom).
  const { data: viewerId } = useQuery({
    queryKey: ['store-viewer-uid'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 60_000,
  });

  if (data.isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <LoadingState />
      </div>
    );
  }
  if (!data.approved || !data.ctx || !data.store) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl">
        <EmptyState
          icon={Store}
          title="Negozio non trovato"
          description="Questo negozio non esiste o non è più disponibile."
          ctaLabel="Vedi tutti i negozi"
          ctaHref="/stores"
        />
      </div>
    );
  }

  const { store, custom, accent, socials, reviews, site, ctx } = data;
  const isOwner = Boolean(viewerId && viewerId === store.id);
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }}
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Breadcrumb items={[
          { label: 'Home', href: '/' },
          { label: 'Negozi', href: '/stores' },
          { label: store.store_name ?? 'Negozio' },
        ]} />
        {isOwner && (
          <Link
            href="/seller/site"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cream-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink-700 shadow-warm-sm transition-colors hover:border-primary-300 hover:text-primary-700"
          >
            <PencilLine size={15} strokeWidth={2.2} aria-hidden /> Modifica vetrina
          </Link>
        )}
      </div>

      <StoreNav site={site} storeId={ctx.storeId} />

      {/* Banner annuncio (es. ferie / novità) — store-wide, sopra le sezioni */}
      {showAnnouncement && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-cream-50 border px-4 py-3" style={{ borderColor: accent }}>
          <Megaphone size={18} className="shrink-0 mt-0.5" style={{ color: accent }} aria-hidden />
          <p className="text-sm text-ink-800">{custom.announcement?.text}</p>
        </div>
      )}

      {/* Sezioni della home, nell'ordine e con la visibilità scelti dal negozio.
          `tabs`: l'hero resta in testa e le altre sezioni si raggruppano nelle
          tab Prodotti / Info & orari / Recensioni (solo presentazione). */}
      <SectionRenderer sections={sections} ctx={ctx} tabs />
    </div>
  );
}
