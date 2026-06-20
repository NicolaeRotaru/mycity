import type { Metadata } from 'next';
import { Flame } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';

export const metadata: Metadata = {
  title: 'Più venduti · MyCity',
  description: 'I prodotti più amati dai piacentini. Paghi alla consegna.',
};

export default function PiuVendutiPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Flame}
        eyebrow="I best seller"
        title="I più venduti"
        blurb="Quello che va forte questa settimana in città."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Più venduti' }]}
      />
      <ProductGrid limit={40} sort="rating" />
    </div>
  );
}
