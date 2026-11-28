import type { Metadata } from 'next';
import { FINO_AL_CONFINE } from '@/lib/ordini/zona-di-consegna';

// 27/10/2026 (terzo giro) — La descrizione per Google e per le condivisioni prometteva «consegna
// locale rapida», senza un confine e senza un tempo: la pagina dice «fino a N km dal negozio», e
// la descrizione dice lo stesso, dalla stessa costante della cassa.
// R09-004 — Le parole del confine vengono dalla fonte della frase della zona, non riscritte qui.
const CONSEGNA = `con consegna ${FINO_AL_CONFINE}`;

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
