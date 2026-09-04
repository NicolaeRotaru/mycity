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
