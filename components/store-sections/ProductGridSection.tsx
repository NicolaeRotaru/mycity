'use client';

import StoreProductExplorer from '@/components/StoreProductExplorer';
import type { SectionContext } from './SectionContext';

/** Tutti i prodotti del negozio (griglia con ricerca e filtri). */
export default function ProductGridSection({ ctx }: { ctx: SectionContext }) {
  return (
    <section>
      <h2 className="text-xl sm:text-2xl font-bold font-serif text-ink-900 mb-4 flex items-center gap-2.5">
        <span className="inline-block w-1.5 h-6 rounded-full" style={{ backgroundColor: ctx.accent }} aria-hidden />
        Prodotti del negozio
      </h2>
      <StoreProductExplorer sellerId={ctx.storeId} />
    </section>
  );
}
