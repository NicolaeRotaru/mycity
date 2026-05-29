import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vendi su MyCity — Apri il tuo negozio a Piacenza · MyCity',
  description:
    'Apri gratis il tuo negozio online su MyCity e vendi ai clienti di Piacenza. Nessuna commissione mensile, consegna locale e pagamento alla consegna.',
  alternates: { canonical: '/sell' },
  openGraph: {
    title: 'Vendi su MyCity Piacenza',
    description: 'Apri gratis il tuo negozio online e vendi ai clienti della tua città.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/sell',
  },
  twitter: {
    card: 'summary',
    title: 'Vendi su MyCity Piacenza',
    description: 'Apri gratis il tuo negozio online e vendi ai clienti della tua città.',
  },
};

export default function SellLayout({ children }: { children: React.ReactNode }) {
  return children;
}
