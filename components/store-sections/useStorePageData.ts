'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { normalizeCustomization, accentHex, socialLinks } from '@/lib/store-customization';
import { normalizeSite } from '@/lib/store-site';
import type { SectionContext, SectionPromo, SectionReview, StoreContextRow } from './SectionContext';

/**
 * Carica tutto ciò che serve a renderizzare una pagina vetrina (home o custom):
 * profilo negozio (incl. store_site), recensioni, promozioni. Costruisce una volta
 * la personalizzazione + il SectionContext condiviso, così home e pagine custom
 * non duplicano le query né la logica.
 */
export function useStorePageData(id: string) {
  const storeQ = useQuery({
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

  const reviewsQ = useQuery({
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

  const promosQ = useQuery({
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

  const store = storeQ.data ?? null;
  const approved = Boolean(store?.store_name && store?.is_approved);
  const custom = normalizeCustomization(store?.store_customization);
  const accent = accentHex(custom);
  const socials = socialLinks(custom);
  const reviews = reviewsQ.data ?? [];
  const promos = promosQ.data ?? [];
  const site = normalizeSite(store?.store_site);

  const ctx: SectionContext | null =
    store && approved
      ? {
          storeId: store.id,
          store: store as unknown as StoreContextRow,
          customization: custom,
          accent,
          reviews,
          promos,
          theme: site.theme,
          site,
        }
      : null;

  return { isLoading: storeQ.isLoading, store, approved, custom, accent, socials, reviews, promos, site, ctx };
}
