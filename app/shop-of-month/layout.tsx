import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Negozio del mese — Il migliore di Piacenza · MyCity',
  description:
    'Scopri il negozio del mese su MyCity: il venditore di Piacenza più amato dalla community. Vota e sostieni il commercio locale.',
  alternates: { canonical: '/shop-of-month' },
  openGraph: {
    title: 'Negozio del mese · MyCity Piacenza',
    description: 'Il negozio di Piacenza più amato dalla community. Vota il tuo preferito.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/shop-of-month',
  },
  twitter: {
    card: 'summary',
    title: 'Negozio del mese · MyCity Piacenza',
    description: 'Il negozio di Piacenza più amato dalla community.',
  },
};

export default function ShopOfMonthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
