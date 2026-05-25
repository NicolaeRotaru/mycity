/** @type {import('next').NextConfig} */

const supabaseHost = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).host : '*.supabase.co';
  } catch {
    return '*.supabase.co';
  }
})();

// CSP impostata in modalità "permissiva ma sicura". Permettiamo:
//  - immagini da Supabase storage, placeholder, avatar
//  - tile OpenStreetMap (Leaflet)
//  - connessione a Supabase REST + Realtime + Nominatim (geocoding)
//  - 'unsafe-inline' su style perché Tailwind + react-hook-form ne hanno bisogno
//  - script: 'self' + 'unsafe-inline' per Next runtime; in produzione si può
//    stringere ulteriormente passando alla nonce-based CSP.
const cspDirectives = [
  "default-src 'self'",
  // script-src include Cloudflare Turnstile (CAPTCHA), Stripe.js, Google Analytics 4
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  `img-src 'self' data: blob: https://${supabaseHost} https://placehold.co https://api.dicebear.com https://api.iconify.design https://images.pexels.com https://*.tile.openstreetmap.org https://unpkg.com https://*.stripe.com https://www.google-analytics.com https://*.googletagmanager.com`,
  "font-src 'self' data:",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://nominatim.openstreetmap.org https://challenges.cloudflare.com https://api.stripe.com https://www.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`,
  // frame-src per il widget Turnstile e Stripe (3D Secure, Connect onboarding)
  "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com https://connect.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'Content-Security-Policy', value: cspDirectives },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  compress: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
      { protocol: 'https', hostname: 'api.iconify.design' },
      { protocol: 'https', hostname: 'images.pexels.com' },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'sonner', '@tanstack/react-query'],
    // pdfkit + fontkit + restructure hanno dipendenze native (iconv-lite,
    // brotli, ecc.) che webpack non riesce a bundlare lato server. Le
    // teniamo "external": Next le importa direttamente da node_modules a
    // runtime (server-only), niente warning di build.
    serverComponentsExternalPackages: ['pdfkit', 'fontkit', 'restructure'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
