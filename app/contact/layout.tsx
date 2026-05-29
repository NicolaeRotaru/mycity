import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contatti — Scrivi al team di MyCity · MyCity',
  description:
    'Hai bisogno di aiuto? Contatta il team di MyCity per domande su ordini, account o per vendere i tuoi prodotti a Piacenza.',
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contatti · MyCity',
    description: 'Contatta il team di MyCity per qualsiasi domanda o richiesta di supporto.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/contact',
  },
  twitter: {
    card: 'summary',
    title: 'Contatti · MyCity',
    description: 'Contatta il team di MyCity per qualsiasi domanda.',
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
