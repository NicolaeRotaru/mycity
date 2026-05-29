import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cerca prodotti e negozi a Piacenza · MyCity',
  description:
    'Cerca tra i prodotti e i negozi di Piacenza su MyCity. Filtra per categoria, prezzo e consegna e trova quello che ti serve nella tua città.',
  alternates: { canonical: '/search' },
  openGraph: {
    title: 'Cerca su MyCity Piacenza',
    description: 'Cerca tra i prodotti e i negozi di Piacenza e trova quello che ti serve.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/search',
  },
  twitter: {
    card: 'summary',
    title: 'Cerca su MyCity Piacenza',
    description: 'Cerca tra i prodotti e i negozi di Piacenza.',
  },
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
