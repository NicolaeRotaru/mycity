import type { Metadata } from 'next';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';

// 27/10/2026 (terzo giro) — La descrizione per Google e per le condivisioni prometteva «consegna
// locale rapida», senza un confine e senza un tempo: la pagina dice «fino a N km dal negozio», e
// la descrizione dice lo stesso, dalla stessa costante della cassa.
const CONSEGNA = `con consegna fino a ${RAGGIO_CONSEGNA_KM} km dal negozio`;

export const metadata: Metadata = {
  title: 'Vicino a te — Negozi e prodotti a Piacenza · MyCity',
  description:
    `Trova negozi e prodotti vicino a te a Piacenza. Scopri cosa puoi comprare nella tua zona, ${CONSEGNA}.`,
  alternates: { canonical: '/near' },
  openGraph: {
    title: 'Vicino a te · MyCity Piacenza',
    description: `Negozi e prodotti vicino a te a Piacenza, ${CONSEGNA}.`,
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
