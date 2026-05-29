import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Acquisti di gruppo a Piacenza · MyCity',
  description:
    'Unisciti agli acquisti di gruppo su MyCity: compra insieme ad altri a Piacenza e sblocca prezzi migliori sui prodotti dei negozi locali.',
  alternates: { canonical: '/groups' },
  openGraph: {
    title: 'Acquisti di gruppo · MyCity Piacenza',
    description: 'Compra insieme ad altri a Piacenza e sblocca prezzi migliori.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/groups',
  },
  twitter: {
    card: 'summary',
    title: 'Acquisti di gruppo · MyCity Piacenza',
    description: 'Compra insieme ad altri a Piacenza e sblocca prezzi migliori.',
  },
};

export default function GroupsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
