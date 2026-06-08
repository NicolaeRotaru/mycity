'use client';
import { use, type CSSProperties } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { normalizeCustomization, accentHex, announcementActive, socialLinks } from '@/lib/store-customization';
import { normalizeSite, homePage, enabledSections } from '@/lib/store-site';
import SectionRenderer from '@/components/store-sections/SectionRenderer';
import type {
  SectionContext,
  SectionPromo,
  SectionReview,
  StoreContextRow,
} from '@/components/store-sections/SectionContext';
import { LoadingState } from '@/components/ui/LoadingState';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { queryKeys } from '@/lib/queries/keys';

export default function StorePage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;

  const { data: store, isLoading } = useQuery({
    queryKey: queryKeys.stores.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_address, store_lat, store_lng, is_approved, store_logo, store_hours, store_media, store_description, store_customization, store_site')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: queryKeys.reviews.store(id),
    queryFn: async (): Promise<SectionReview[]> => {
      const { data } = await supabase
        .from('store_reviews')
        .select('id, rating, comment, created_at, seller_reply')
        .eq('store_id', id)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []) as SectionReview[];
    },
  });

  const { data: promos = [] } = useQuery({
    queryKey: queryKeys.promotions.byStore(id),
    queryFn: async (): Promise<SectionPromo[]> => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from('seller_promotions')
        .select('id, title, discount_percent, ends_at')
        .eq('seller_id', id)
        .eq('status', 'active')
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso)
        .order('discount_percent', { ascending: false });
      return (data ?? []) as SectionPromo[];
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <LoadingState />
      </div>
    );
  }
  if (!store?.store_name || !store.is_approved) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-ink-500">
        Negozio non trovato.
      </div>
    );
  }

  // Personalizzazione (accent/annuncio/social) + sito multi-pagina (sezioni della home).
  const custom = normalizeCustomization(store.store_customization);
  const accent = accentHex(custom);
  const socials = socialLinks(custom);
  const showAnnouncement = announcementActive(custom);

  const site = normalizeSite(store.store_site);
  const home = homePage(site);
  const sections = enabledSections(home);

  const ctx: SectionContext = {
    storeId: store.id,
    store: store as unknown as StoreContextRow,
    customization: custom,
    accent,
    reviews,
    promos,
    theme: site.theme,
    site,
  };

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
        { label: store.store_name },
      ]} />

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
