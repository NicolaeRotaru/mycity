import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cookie policy · MyCity',
  description:
    'Informativa sui cookie di MyCity: quali cookie utilizziamo, a cosa servono e come gestire le tue preferenze.',
  alternates: { canonical: '/cookies' },
  openGraph: {
    title: 'Cookie policy · MyCity',
    description: 'Quali cookie utilizziamo su MyCity e come gestire le tue preferenze.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/cookies',
  },
};

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
