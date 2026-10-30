import { CONSEGNA_ALL_ORA_CHE_SCEGLI } from '@/lib/promessa-consegna';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Negozi di Piacenza — Tutti i venditori locali · MyCity',
  description:
    'Scopri tutti i negozi di Piacenza su MyCity: alimentari, casa, elettronica e altro. Compra online dai commercianti della tua città.',
  alternates: { canonical: '/stores' },
  openGraph: {
    title: 'Negozi di Piacenza · MyCity',
    description: `Tutti i negozi locali di Piacenza in un solo posto. ${CONSEGNA_ALL_ORA_CHE_SCEGLI}.`,
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
