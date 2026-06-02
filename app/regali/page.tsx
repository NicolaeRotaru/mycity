import type { Metadata } from 'next';
import { Gift } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';

export const metadata: Metadata = {
  title: 'Idee regalo · MyCity',
  description: 'Una selezione di idee regalo dai negozi di Piacenza. Paghi alla consegna.',
};

export default function RegaliPage() {
  return (
    <div className="container mx-auto px-4 py-8 sm:px-6">
      <header className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold text-primary-800 ring-1 ring-primary-200">
          <Gift size={14} strokeWidth={2.4} /> Idee regalo
        </span>
        <h1 className="mt-3 font-serif text-3xl font-bold text-ink-900 sm:text-4xl">Regali dai negozi di Piacenza</h1>
        <p className="mt-1 text-ink-500">Stupisci con qualcosa di locale e autentico — e paghi alla consegna.</p>
      </header>
      <ProductGrid limit={40} sort="newest" />
    </div>
  );
}
