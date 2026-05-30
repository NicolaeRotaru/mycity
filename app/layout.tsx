import './globals.css';
import { Inter, Fraunces } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MobileTabBar from '@/components/MobileTabBar';
import SupportChatButton from '@/components/SupportChatButton';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import CookieBanner from '@/components/CookieBanner';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import DailyCheckIn from '@/components/DailyCheckIn';
import WelcomeCreditBanner from '@/components/WelcomeCreditBanner';
import CartCrossDeviceSync from '@/components/CartCrossDeviceSync';
import BuyerOnboardingTour from '@/components/BuyerOnboardingTour';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import PostHogProvider from '@/lib/analytics/posthog';
import SentryProvider from '@/lib/analytics/sentry';
import { Suspense } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

// metadataBase: rende assoluti i canonical/openGraph relativi delle pagine
// (es. /product/[id], /category/[slug]). Stessa fonte di robots.ts e sitemap.ts.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: 'MyCity Piacenza — Marketplace dei negozi della tua città',
  description:
    'Compra online dai negozi di Piacenza: alimentari, abbigliamento, casa, elettronica, libri. Consegna in 24-48h, pagamento alla consegna.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.svg',
    apple: '/icon-192.svg',
  },
  alternates: { canonical: '/' },
  openGraph: {
    title: 'MyCity Piacenza — Marketplace dei negozi della tua città',
    description: 'Compra dai negozi della tua città. Consegna rapida, pagamento alla consegna.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/',
  },
  twitter: {
    card: 'summary',
    title: 'MyCity Piacenza',
    description: 'Compra dai negozi della tua città. Consegna rapida, pagamento alla consegna.',
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

// Preconnect ai domini critici per latenza primo paint
// Esperti: Performance Engineer: "preconnect = -100-300ms LCP"
const SUPABASE_HOST = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).origin : '';
  } catch { return ''; }
})();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // i18n: locale rilevato da cookie NEXT_LOCALE + Accept-Language (vedi i18n.ts)
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        {SUPABASE_HOST && <link rel="preconnect" href={SUPABASE_HOST} crossOrigin="anonymous" />}
        <link rel="preconnect" href="https://js.stripe.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.stripe.com" />
        <link rel="dns-prefetch" href="https://challenges.cloudflare.com" />
      </head>
      <body className={`${inter.className} bg-cream-100 text-ink-800`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-primary-700 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:font-semibold"
        >
          Vai al contenuto principale
        </a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>
            <Navbar />
            <WelcomeCreditBanner />
            <main id="main-content" className="min-h-screen">{children}</main>
            <Footer />
            <MobileTabBar />
            <SupportChatButton />
            <DailyCheckIn />
            <CartCrossDeviceSync />
            <BuyerOnboardingTour />
            <PWAInstallBanner />
          </QueryProvider>
          <ToastProvider />
          <ConfirmDialogHost />
          <CookieBanner />
        </NextIntlClientProvider>
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
        <Suspense fallback={null}>
          <PostHogProvider />
        </Suspense>
        <SentryProvider />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
