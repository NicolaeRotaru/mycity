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
        .from('seller_public_profiles')
        .select('id, store_name, store_phone, store_address, store_lat, store_lng, is_approved, store_logo, store_hours, store_media, store_description, store_customization, store_site, founded_year')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const reviewsQ = useQuery({
    queryKey: queryKeys.reviews.store(id),
    queryFn: async (): Promise<SectionReview[]> => {
      // store_reviews ora include user_id, order_id, photo_urls, helpful_count.
      // NB: store_reviews.user_id ha la FK su auth.users (non profiles), quindi
      // l'embed PostgREST `author:profiles!...` non si risolve. Carichiamo i
      // profili autore in un secondo passaggio (id = user_id, 1:1 con auth.users)
      // e li uniamo client-side → nome reale, fallback "Cliente".
      const { data } = await supabase
        .from('store_reviews')
        .select('id, rating, comment, created_at, seller_reply, user_id, order_id, photo_urls, helpful_count')
        .eq('store_id', id)
        .order('created_at', { ascending: false })
        .limit(20);

      const rows = (data ?? []) as Array<{
        id: string;
        rating: number;
        comment: string | null;
        created_at: string;
        seller_reply: string | null;
        user_id: string | null;
        order_id: string | null;
        photo_urls: unknown;
        helpful_count: number | null;
      }>;

      // Profili autore (nome) per le recensioni con user_id.
      const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v)));
      const authorById = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, public_handle')
          .in('id', userIds);
        for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; public_handle: string | null }>) {
          authorById.set(p.id, p.full_name || p.public_handle || null);
        }
      }

      return rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
        seller_reply: r.seller_reply,
        user_id: r.user_id,
        order_id: r.order_id,
        // photo_urls è text[] nel DB ma il tipo generato dice `string` → cast sicuro.
        photo_urls: Array.isArray(r.photo_urls) ? (r.photo_urls as string[]) : null,
        helpful_count: typeof r.helpful_count === 'number' ? r.helpful_count : 0,
        author: r.user_id ? (authorById.get(r.user_id) ?? null) : null,
      }));
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
