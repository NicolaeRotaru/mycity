'use client';

import { useServizi } from '@/components/hooks/useServizi';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { fetchActiveDiscounts } from '@/lib/promotions';
import ProductCard from '@/components/ProductCard';
import ProductGrid from '@/components/ProductGrid';
import { queryKeys } from '@/lib/queries/keys';
import SectionHeading from './SectionHeading';
import SkeletonCard from '@/components/SkeletonCard';
import type { SectionConfig, SectionContext } from './SectionContext';

type Row = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  /** Prezzo pieno barrato impostato dal venditore, come nella griglia. */
  compare_at_price: number | string | null;
  images: string[] | null;
  stock: number | null;
  has_variants: boolean | null;
  created_at: string;
  /** Sconto promo attivo (%), dalla stessa fonte della griglia e della cassa. */
  sconto?: number;
};

/** Prodotti scelti a mano dal venditore, nell'ordine scelto (ri-valida proprietà/stato). */
function ManualCollection({
  ctx,
  productIds,
  layout,
  intestazione,
}: {
  ctx: SectionContext;
  productIds: string[];
  layout: 'grid' | 'carousel';
  intestazione: React.ReactNode;
}) {
  const ids = productIds.slice(0, 24);
  const { data: products = [], isLoading } = useQuery({
    queryKey: [...queryKeys.products.all, 'collection', ctx.storeId, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, compare_at_price, images, stock, created_at, has_variants')
        .eq('seller_id', ctx.storeId)
        .eq('status', 'available')
        .in('id', ids);
      if (error) throw error;
      const righe = (data ?? []) as unknown as Row[];
      // R02-013 — Le collezioni scelte a mano passavano a ProductCard il solo prezzo pieno: un prodotto
      // in promozione non mostrava lo sconto. Lo si legge come la griglia (fetchActiveDiscounts); se la
      // lettura cade si resta sul prezzo pieno, come prima.
      const sconti = await fetchActiveDiscounts(supabase, righe.map((p) => p.id)).catch(() => new Map<string, number>());
      return righe.map((p) => ({ ...p, sconto: sconti.get(p.id) ?? 0 }));
    },
  });

  /**
   * 5/11/2026 — IL TITOLO SI DISEGNA SOLO SE SOTTO C'È QUALCOSA.
   * Prima l'intestazione («Le torte della domenica») stava fuori e restava sola, col vuoto sotto,
   * mentre la lettura arrivava, se falliva, o quando nessun prodotto scelto era più in vendita.
   * Ora: mentre carica titolo e scheletro; vuota o in errore, la sezione non c'è.
   */
  // 27/11/2026 — Quali sono servizi (999g): niente «+» del carrello, c'è l'etichetta «Servizio».
  const servizi = useServizi(products.map((p) => p.id));

  if (ids.length === 0) return null;
  if (isLoading) {
    return (
      <section aria-busy="true">
        {intestazione}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3" aria-hidden>
          {ids.slice(0, 4).map((id) => <SkeletonCard key={id} />)}
        </div>
      </section>
    );
  }
  const ordered = ids
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Row => Boolean(p));
  if (ordered.length === 0) return null;

  const card = (p: Row) => (
    <ProductCard
      key={p.id}
      id={p.id}
      name={p.name}
      description={p.description ?? ''}
      price={Number(p.price)}
      discountPercent={p.sconto ?? 0}
      // R11-007 — Il prezzo barrato del venditore, come lo passa la griglia: senza, la collezione
      // scelta a mano mostrava il prezzo senza il pieno barrato che la stessa scheda ha altrove.
      compareAtPrice={p.compare_at_price != null ? Number(p.compare_at_price) : null}
      images={Array.isArray(p.images) ? p.images : []}
      stock={p.stock ?? undefined}
      hasVariants={p.has_variants ?? undefined}
      servizio={servizi.get(p.id) ?? null}
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
    // ospita. 5/11/2026 — CONTENITORE_PAGINA_NEGOZIO è passato a px-4 sm:px-6
    // (lo stesso passo del resto del sito), quindi la riga segue: -mx-4 px-4
    // sul telefono, -mx-6 px-6 da 640px. Uguale al contenitore, non sborda.
    return (
      <section>
        {intestazione}
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scrollbar-hide px-4 pb-2 sm:-mx-6 sm:px-6">
          {ordered.map((p) => (
            <div key={p.id} className="w-40 shrink-0 snap-start sm:w-44">
              {card(p)}
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section>
      {intestazione}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {ordered.map((p) => card(p))}
      </div>
    </section>
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

  const intestazione = <SectionHeading accent={ctx.accent}>{config.heading || 'Collezione'}</SectionHeading>;
  if (config.source.kind === 'manual') {
    return (
      <ManualCollection ctx={ctx} productIds={config.source.productIds} layout={config.layout} intestazione={intestazione} />
    );
  }

  return (
    <section>
      {intestazione}
      <ProductGrid
        sellerId={ctx.storeId}
        categoryId={config.source.categoryId}
        limit={config.source.limit}
        rail={config.layout === 'carousel'}
        prioritaPrimeFoto={false}
        sort="newest"
      />
    </section>
  );
}
