'use client';

import { Sparkles } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';

/**
 * Pagina "Novità": gli ultimi prodotti pubblicati nel marketplace.
 */
export default function NovitaPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Sparkles}
        eyebrow="Appena arrivati"
        title="Novità dai negozi"
        blurb="I prodotti più freschi pubblicati dai commercianti di Piacenza."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Novità' }]}
      />

      <ProductGrid sort="newest" />
    </div>
  );
}
