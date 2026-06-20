import type { Metadata } from 'next';
import { Gift } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';

export const metadata: Metadata = {
  title: 'Idee regalo · MyCity',
  description: 'Una selezione di idee regalo dai negozi di Piacenza. Paghi alla consegna.',
};

export default function RegaliPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Gift}
        eyebrow="Idee regalo"
        title="Regali"
        blurb="Pensieri buoni e artigianali, da Piacenza con gusto."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Regali' }]}
      />
      <ProductGrid limit={40} sort="newest" />
    </div>
  );
}
