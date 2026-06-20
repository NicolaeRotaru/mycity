import type { Metadata } from 'next';
import { PiggyBank } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';

export const metadata: Metadata = {
  title: 'Piccoli prezzi · MyCity',
  description: 'Tutto sotto i 10€ dai negozi di Piacenza. Perfetto per il primo ordine.',
};

export default function PiccoliPrezziPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={PiggyBank}
        eyebrow="Sotto i 10€"
        title="Piccoli prezzi"
        blurb="Buono, locale e leggero sul portafoglio."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Piccoli prezzi' }]}
      />
      <ProductGrid limit={40} maxPrice={10} sort="price_asc" />
    </div>
  );
}
