import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vicino a te — Negozi e prodotti a Piacenza · MyCity',
  description:
    'Trova negozi e prodotti vicino a te a Piacenza. Scopri cosa puoi comprare nella tua zona con consegna locale rapida.',
  alternates: { canonical: '/near' },
  openGraph: {
    title: 'Vicino a te · MyCity Piacenza',
    description: 'Negozi e prodotti vicino a te a Piacenza, con consegna locale rapida.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/near',
  },
  twitter: {
    card: 'summary',
    title: 'Vicino a te · MyCity Piacenza',
    description: 'Negozi e prodotti vicino a te a Piacenza.',
  },
};

export default function NearLayout({ children }: { children: React.ReactNode }) {
  return children;
}
