import type { StoreCustomization } from '@/lib/store-customization';
import type { SiteSection, StoreSite, ThemeKey } from '@/lib/store-site';

/**
 * Contesto passato a ogni sezione della vetrina. La pagina /store/[id] (e le pagine
 * custom) lo costruiscono una volta — dati profilo, personalizzazione, recensioni e
 * promozioni — così le sezioni strutturali leggono esattamente dove leggeva la vetrina
 * fissa, senza query duplicate.
 */

export type StoreContextRow = {
  id: string;
  store_name: string | null;
  store_phone: string | null;
  store_address: string | null;
  store_lat: number | null;
  store_lng: number | null;
  store_logo: string | null;
  store_hours: unknown;
  store_media: unknown;
  store_description: string | null;
  is_approved: boolean | null;
  founded_year: number | null;
};

export type SectionReview = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  seller_reply: string | null;
  // Dati arricchiti (schema store_reviews + profilo autore unito client-side).
  user_id: string | null;
  order_id: string | null;
  photo_urls: string[] | null;
  helpful_count: number;
  author: string | null;
};

export type SectionPromo = {
  id: string;
  title: string;
  discount_percent: number;
  ends_at: string;
};

export type SectionContext = {
  storeId: string;
  store: StoreContextRow;
  customization: StoreCustomization;
  accent: string;
  reviews: SectionReview[];
  promos: SectionPromo[];
  theme: ThemeKey;
  site: StoreSite;
};

/** Config tipizzata di una specifica sezione (estratta dall'unione discriminata). */
export type SectionConfig<T extends SiteSection['type']> = Extract<SiteSection, { type: T }>['config'];
