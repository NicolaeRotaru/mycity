import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

/**
 * robots.txt generato a runtime. Niente Allow esplicito: di default Googlebot
 * indicizza tutto quello che non è bloccato. Disallow su aree pro e API: non
 * devono mai finire in SERP. Sitemap canonica fornita.
 */
export default function robots(): MetadataRoute.Robots {
  // L'indirizzo si chiede a lib/env.ts, che è l'unico che sa deciderlo: la
  // copia locale che ripiegava su localhost mandava a Googlebot una sitemap
  // ospitata su un computer che non esiste.
  const APP_URL = env.appUrl();
  // R01-017 (12/11/2026) — Le anteprime di Vercel (una per ogni richiesta di unione) servivano
  // lo stesso robots.txt della produzione, con `allow: '/'`: un motore di ricerca che ci arrivava
  // poteva indicizzare un sito di prova, con dati e prezzi non veri, accanto a quello vero.
  // Fuori dalla produzione si chiude tutto.
  const ambiente = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (ambiente === 'preview' || ambiente === 'development') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/seller/',
          '/rider/',
          '/checkout',
          '/cart',
          '/profile',
          '/profile/',
          '/messages',
          '/messages/',
          '/notifications',
          '/orders',
          '/orders/',
          '/sign-in',
          '/sign-up',
          '/reset-password',
          '/auth/',
          '/returns/',
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
