import './globals.css';
import { Inter, Fraunces } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MobileTabBar from '@/components/MobileTabBar';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import CookieBanner from '@/components/CookieBanner';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import DailyCheckIn from '@/components/DailyCheckIn';
import WelcomeCreditBanner from '@/components/WelcomeCreditBanner';
import { Suspense } from 'react';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

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
  themeColor: '#C0492C',
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
    <html lang="it" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <body className={`${inter.className} bg-cream-100 text-ink-800`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <QueryProvider>
          <Navbar />
          <WelcomeCreditBanner />
          <main className="min-h-screen">{children}</main>
          <Footer />
          <MobileTabBar />
          <DailyCheckIn />
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
