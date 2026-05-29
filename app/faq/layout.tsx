import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Domande frequenti (FAQ) · MyCity',
  description:
    'Risposte alle domande più frequenti su MyCity: ordini, pagamenti, consegne, resi e come vendere a Piacenza.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'Domande frequenti · MyCity',
    description: 'Tutte le risposte su ordini, consegne, pagamenti e resi su MyCity.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/faq',
  },
  twitter: {
    card: 'summary',
    title: 'Domande frequenti · MyCity',
    description: 'Tutte le risposte su ordini, consegne, pagamenti e resi su MyCity.',
  },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return children;
}
