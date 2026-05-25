import './globals.css';
import { Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import CookieBanner from '@/components/CookieBanner';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import { Suspense } from 'react';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MyCity Piacenza — Marketplace dei negozi della tua città',
  description:
    'Compra online dai negozi di Piacenza: alimentari, abbigliamento, casa, elettronica, libri. Consegna in 24-48h, pagamento alla consegna.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.svg',
    apple: '/icon-192.svg',
  },
  openGraph: {
    title: 'MyCity Piacenza',
    description: 'Compra dai negozi della tua città. Consegna rapida, pagamento alla consegna.',
    type: 'website',
    locale: 'it_IT',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#4f46e5',
};

// Schema markup Organization a livello di sito
const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'OnlineStore',
  name: 'MyCity Piacenza',
  description: 'Marketplace dei negozi locali di Piacenza con consegna a domicilio.',
  areaServed: {
    '@type': 'City',
    name: 'Piacenza',
    address: { '@type': 'PostalAddress', addressLocality: 'Piacenza', addressRegion: 'PC', addressCountry: 'IT' },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className={inter.className}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <QueryProvider>
          <Navbar />
          <main className="min-h-screen">{children}</main>
          <Footer />
        </QueryProvider>
        <ToastProvider />
        <ConfirmDialogHost />
        <CookieBanner />
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
      </body>
    </html>
  );
}
