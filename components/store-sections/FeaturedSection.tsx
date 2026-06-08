'use client';

import StoreFeaturedStrip from '@/components/StoreFeaturedStrip';
import type { SectionContext } from './SectionContext';

/** Prodotti in evidenza scelti dal venditore (da store_customization.featuredProductIds). */
export default function FeaturedSection({ ctx }: { ctx: SectionContext }) {
  const ids = ctx.customization.featuredProductIds ?? [];
  if (ids.length === 0) return null;
  return (
    <StoreFeaturedStrip
      sellerId={ctx.storeId}
      storeName={ctx.store.store_name}
      productIds={ids}
      accent={ctx.accent}
    />
  );
}
