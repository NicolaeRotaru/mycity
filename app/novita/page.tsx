'use client';

import { Sparkles } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';

/**
 * Pagina "Novità": gli ultimi prodotti pubblicati nel marketplace.
 */
export default function NovitaPage() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-4">
        <span className="w-14 h-14 rounded-2xl bg-olive-50 text-olive-600 flex items-center justify-center shrink-0">
          <Sparkles size={26} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-3xl font-serif font-bold text-ink-900">Novità</h1>
          <p className="text-ink-500">Gli ultimi prodotti arrivati a Piacenza</p>
        </div>
      </header>

      <ProductGrid sort="newest" />
    </div>
  );
}
