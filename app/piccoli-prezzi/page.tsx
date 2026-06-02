import type { Metadata } from 'next';
import { PiggyBank } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';

export const metadata: Metadata = {
  title: 'Piccoli prezzi · MyCity',
  description: 'Tutto sotto i 10€ dai negozi di Piacenza. Perfetto per il primo ordine.',
};

export default function PiccoliPrezziPage() {
  return (
    <div className="container mx-auto px-4 py-8 sm:px-6">
      <header className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-olive-100 px-3 py-1 text-xs font-semibold text-olive-700 ring-1 ring-olive-200">
          <PiggyBank size={14} strokeWidth={2.4} /> Piccoli prezzi
        </span>
        <h1 className="mt-3 font-serif text-3xl font-bold text-ink-900 sm:text-4xl">Sotto i 10€</h1>
        <p className="mt-1 text-ink-500">Piccole spese a basso rischio — ideale per il primo ordine, paghi alla consegna.</p>
      </header>
      <ProductGrid limit={40} maxPrice={10} sort="price_asc" />
    </div>
  );
}
