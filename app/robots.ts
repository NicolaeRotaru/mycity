import type { MetadataRoute } from 'next';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * robots.txt generato a runtime. Niente Allow esplicito: di default Googlebot
 * indicizza tutto quello che non è bloccato. Disallow su aree pro e API: non
 * devono mai finire in SERP. Sitemap canonica fornita.
 */
export default function robots(): MetadataRoute.Robots {
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
    sitemap: `${APP_URL.replace(/\/$/, '')}/sitemap.xml`,
    host: APP_URL.replace(/\/$/, ''),
  };
}
