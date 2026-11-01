import type { Metadata } from 'next';
import { FRASE_PREZZO_NEGOZI } from '@/app/seller/earnings/commissione';

// 31/10/2026 (ondata 6) — Diceva «Apri gratis… Nessuna commissione mensile»: il prezzo dei negozi è una frase sola.
const ANTEPRIMA = `Vendi ai clienti della tua città. ${FRASE_PREZZO_NEGOZI}`;

export const metadata: Metadata = {
  title: 'Vendi su MyCity — Apri il tuo negozio a Piacenza · MyCity',
  description:
    `Apri il tuo negozio online su MyCity e vendi ai clienti di Piacenza. ${FRASE_PREZZO_NEGOZI} Consegna locale e pagamento alla consegna.`,
  alternates: { canonical: '/sell' },
  openGraph: {
    title: 'Vendi su MyCity Piacenza',
    description: ANTEPRIMA,
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/sell',
  },
  twitter: {
    card: 'summary',
    title: 'Vendi su MyCity Piacenza',
    description: ANTEPRIMA,
  },
};

export default function SellLayout({ children }: { children: React.ReactNode }) {
  return children;
}
