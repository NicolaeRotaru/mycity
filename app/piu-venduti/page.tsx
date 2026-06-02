import type { Metadata } from 'next';
import { Flame } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';

export const metadata: Metadata = {
  title: 'Più venduti · MyCity',
  description: 'I prodotti più amati dai piacentini. Paghi alla consegna.',
};

export default function PiuVendutiPage() {
  return (
    <div className="container mx-auto px-4 py-8 sm:px-6">
      <header className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-700 ring-1 ring-accent-200">
          <Flame size={14} strokeWidth={2.4} /> Più venduti
        </span>
        <h1 className="mt-3 font-serif text-3xl font-bold text-ink-900 sm:text-4xl">I più amati a Piacenza</h1>
        <p className="mt-1 text-ink-500">I prodotti che vanno forte tra i clienti del territorio.</p>
      </header>
      <ProductGrid limit={40} sort="rating" />
    </div>
  );
}
