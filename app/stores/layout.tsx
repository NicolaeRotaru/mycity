import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Negozi di Piacenza — Tutti i venditori locali · MyCity',
  description:
    'Scopri tutti i negozi di Piacenza su MyCity: alimentari, abbigliamento, casa, elettronica e altro. Compra online dai commercianti della tua città.',
  alternates: { canonical: '/stores' },
  openGraph: {
    title: 'Negozi di Piacenza · MyCity',
    description: 'Tutti i negozi locali di Piacenza in un solo posto. Consegna in 24-48h.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/stores',
  },
  twitter: {
    card: 'summary',
    title: 'Negozi di Piacenza · MyCity',
    description: 'Tutti i negozi locali di Piacenza in un solo posto.',
  },
};

export default function StoresLayout({ children }: { children: React.ReactNode }) {
  return children;
}
