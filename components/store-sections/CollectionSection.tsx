'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import ProductGrid from '@/components/ProductGrid';
import { queryKeys } from '@/lib/queries/keys';
import SectionHeading from './SectionHeading';
import type { SectionConfig, SectionContext } from './SectionContext';

type Row = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  images: string[] | null;
  stock: number | null;
  has_variants: boolean | null;
  created_at: string;
};

/** Prodotti scelti a mano dal venditore, nell'ordine scelto (ri-valida proprietà/stato). */
function ManualCollection({
  ctx,
  productIds,
  layout,
}: {
  ctx: SectionContext;
  productIds: string[];
  layout: 'grid' | 'carousel';
}) {
  const ids = productIds.slice(0, 24);
  const { data: products = [] } = useQuery({
    queryKey: [...queryKeys.products.all, 'collection', ctx.storeId, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, images, stock, created_at, has_variants')
        .eq('seller_id', ctx.storeId)
        .eq('status', 'available')
        .in('id', ids);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  if (ids.length === 0 || products.length === 0) return null;
  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Row => Boolean(p));

  const card = (p: Row) => (
    <ProductCard
      key={p.id}
      id={p.id}
      name={p.name}
      description={p.description ?? ''}
      price={Number(p.price)}
      images={Array.isArray(p.images) ? p.images : []}
      stock={p.stock ?? undefined}
      hasVariants={p.has_variants ?? undefined}
      createdAt={p.created_at}
      storeName={ctx.store.store_name ?? undefined}
      sellerId={ctx.storeId}
      // 6/9/2026 — Ogni collezione e' una sezione impilata sotto la copertina del
      // negozio: nessuna e' la prima cosa che si vede. Marcarne quattro foto come
      // urgenti, per ogni collezione, faceva gara con la copertina vera.
      priority={false}
    />
  );

  if (layout === 'carousel') {
    // La riga scorrevole deve avere lo stesso margine del contenitore che la
    // ospita (CONTENITORE_PAGINA_NEGOZIO = px-4 a ogni misura di schermo). Con
    // sm:-mx-6 sm:px-6 da 640px in su sbordava di 8px per lato e faceva
    // comparire la barra di scorrimento orizzontale sui tablet.
    return (
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scrollbar-hide px-4 pb-2">
        {ordered.map((p) => (
          <div key={p.id} className="w-40 shrink-0 snap-start sm:w-44">
            {card(p)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {ordered.map((p) => card(p))}
    </div>
  );
}

/** Collezione prodotti: scelta manuale oppure per categoria (griglia o carosello). */
export default function CollectionSection({
  config,
  ctx,
}: {
  config: SectionConfig<'collection'>;
  ctx: SectionContext;
}) {
  // Niente da mostrare se la collezione manuale è vuota.
  if (config.source.kind === 'manual' && config.source.productIds.length === 0) return null;

  return (
    <section>
      <SectionHeading accent={ctx.accent}>{config.heading || 'Collezione'}</SectionHeading>
      {config.source.kind === 'manual' ? (
        <ManualCollection ctx={ctx} productIds={config.source.productIds} layout={config.layout} />
      ) : (
        <ProductGrid
          sellerId={ctx.storeId}
          categoryId={config.source.categoryId}
          limit={config.source.limit}
          rail={config.layout === 'carousel'}
          prioritaPrimeFoto={false}
          sort="newest"
        />
      )}
    </section>
  );
}
