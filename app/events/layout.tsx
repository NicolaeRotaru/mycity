import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Eventi a Piacenza — Iniziative dei negozi locali · MyCity',
  description:
    'Scopri gli eventi e le iniziative dei negozi di Piacenza su MyCity: offerte, novità e appuntamenti della tua città.',
  alternates: { canonical: '/events' },
  openGraph: {
    title: 'Eventi a Piacenza · MyCity',
    description: 'Eventi e iniziative dei negozi locali di Piacenza.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/events',
  },
  twitter: {
    card: 'summary',
    title: 'Eventi a Piacenza · MyCity',
    description: 'Eventi e iniziative dei negozi locali di Piacenza.',
  },
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
