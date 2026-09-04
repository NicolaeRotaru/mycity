import './globals.css';
import { Inter, Fraunces } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import Navbar from '@/components/Navbar';
import SellerShoppingBanner from '@/components/SellerShoppingBanner';
import Footer from '@/components/Footer';
import MobileTabBar from '@/components/MobileTabBar';
import SupportChatButton from '@/components/SupportChatButton';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import CookieBanner from '@/components/CookieBanner';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import ActivityTracker from '@/components/ActivityTracker';
import DailyCheckIn from '@/components/DailyCheckIn';
import WelcomeCreditBanner from '@/components/WelcomeCreditBanner';
import CartCrossDeviceSync from '@/components/CartCrossDeviceSync';
import BuyerOnboardingTour from '@/components/BuyerOnboardingTour';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import PostHogProvider from '@/lib/analytics/posthog';
import EventiAccessoOAuth from '@/components/analytics/EventiAccessoOAuth';
import SentryProvider from '@/lib/analytics/sentry';
import { Suspense } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { indirizzoPubblico } from '@/lib/env';

// `style` con il corsivo dentro NON è un dettaglio: senza, si scarica solo la
// variante dritta e il browser inclina le lettere da solo (corsivo finto). Nel
// sito ci sono diciassette punti che chiedono il corsivo — fra cui la parola
// «veri» del titolone della home, in Fraunces a 60px — e Fraunces un corsivo
// vero, disegnato, ce l'ha. Le regole in più costano qualche riga di CSS: il
// browser scarica un file solo quando c'è davvero del testo che lo usa.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  style: ['normal', 'italic'],
});
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
});

// metadataBase: rende assoluti i canonical/openGraph relativi delle pagine
// (es. /product/[id], /category/[slug]). Stessa fonte di robots.ts e sitemap.ts:
// l'indirizzo pubblico si calcola in UN posto solo — lib/env.ts — perché quando
// ognuno dei tre teneva la sua copia col ripiego su localhost, bastava la
// variabile mancante su Vercel per dire a Google che il sito sta su un computer
// che non esiste.
const { url: APP_URL, fonte: FONTE_APP_URL } = indirizzoPubblico();

if (FONTE_APP_URL === 'dominio-di-riserva') {
  // Il codice dice ad alta voce quale indirizzo sta usando e perché: senza
  // questa riga la configurazione sbagliata resta muta e il sito sembra sano.
  console.warn(
    `[MyCity] NEXT_PUBLIC_APP_URL non è impostata: il sito si presenta come ${APP_URL}. Impostala nel progetto Vercel.`,
  );
}

/**
 * 3/9/2026 — OGNI PAGINA SI COSTRUISCE AL MOMENTO DELLA RICHIESTA.
 *
 * Non è una scelta di velocità: è la condizione perché il sito abbia il suo
 * JavaScript. La regola di sicurezza che il portiere (`middleware.ts`) mette su
 * ogni risposta accetta soltanto gli script che portano una parola d'ordine
 * diversa a ogni richiesta. Next sa scrivere quella parola dentro i tag
 * `<script>` solo mentre costruisce la pagina per QUELLA richiesta.
 *
 * Una pagina preparata in anticipo viene scritta prima che la parola d'ordine
 * esista. I suoi script non ce l'hanno, il browser li rifiuta tutti, e al
 * cliente arriva un guscio morto: niente carrello, niente accesso, niente
 * cassa. È successo davvero: in una build di produzione erano così tutte e 95
 * le pagine preparate in anticipo — l'accesso, la registrazione, la ricerca, i
 * negozi, il carrello, la cassa, il pannello del negoziante e quello di chi
 * amministra. In sviluppo non si vedeva, perché lì la regola è più larga.
 *
 * Quindi le due cose devono restare d'accordo: finché la regola chiede una
 * parola d'ordine per ogni richiesta, ogni pagina va costruita a ogni
 * richiesta. Questa riga è il lato «costruita a ogni richiesta», e sta nel
 * riquadro principale perché valga anche per le pagine che nasceranno domani:
 * chi ne aggiunge una non deve ricordarsi di niente.
 *
 * Se un giorno si volesse tornare alle pagine preparate in anticipo, va tolta
 * PRIMA la parola d'ordine dalla regola di sicurezza — non questa riga.
 * A guardia dei due lati c'è
 * `tests/unit/nessuna-pagina-arriva-senza-javascript.test.ts`.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: 'MyCity Piacenza — Marketplace dei negozi della tua città',
  description:
    'Compra online dai negozi di Piacenza: alimentari, abbigliamento, casa, elettronica, libri. Consegna in 30-60 minuti, pagamento alla consegna.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
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
    card: 'summary_large_image',
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
  // Senza `url` lo schema descrive un negozio senza indirizzo: Google non sa a
  // quale sito attaccarlo. Stessa fonte del canonical, mai una copia a parte.
  url: APP_URL,
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
            <SellerShoppingBanner />
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
          <ActivityTracker />
        </Suspense>
        <Suspense fallback={null}>
          <PostHogProvider />
        </Suspense>
        {/* Registrazione e accesso via Google: gli eventi del funnel li emette
            questo, perché la rotta di ritorno gira sul server. */}
        <Suspense fallback={null}>
          <EventiAccessoOAuth />
        </Suspense>
        <SentryProvider />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
