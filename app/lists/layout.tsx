import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Le tue liste — Liste della spesa e dei desideri · MyCity',
  description:
    'Crea e gestisci le tue liste della spesa e dei desideri su MyCity. Salva i prodotti dei negozi di Piacenza e ordinali quando vuoi.',
  alternates: { canonical: '/lists' },
  openGraph: {
    title: 'Le tue liste · MyCity',
    description: 'Crea liste della spesa e dei desideri con i prodotti dei negozi di Piacenza.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/lists',
  },
  twitter: {
    card: 'summary',
    title: 'Le tue liste · MyCity',
    description: 'Crea liste della spesa e dei desideri con i prodotti dei negozi di Piacenza.',
  },
};

export default function ListsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
