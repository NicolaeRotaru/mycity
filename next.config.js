/** @type {import('next').NextConfig} */
const withNextIntl = require('next-intl/plugin')('./i18n.ts');


// CSP NON e' qui — viene generata nel middleware con nonce-per-request
// (vedi middleware.ts buildCsp + generateNonce). Permette di passare da
// 'unsafe-inline' su script-src a nonce + 'strict-dynamic', annullando
// la superficie XSS di injection di script inline non firmati.
//
// Restano qui solo i security header statici (non variano per request).

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
    // Media Supabase = immutabili (URL versionato per upload) → cache lunga.
    minimumCacheTTL: 31536000, // 1 anno
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'sonner', '@tanstack/react-query'],
  },
  // pdfkit + fontkit + restructure hanno dipendenze native (iconv-lite, brotli,
  // ecc.) che webpack non riesce a bundlare lato server. Le teniamo "external":
  // Next le importa direttamente da node_modules a runtime (server-only).
  // Next 15: spostato da experimental.serverComponentsExternalPackages.
  serverExternalPackages: ['pdfkit', 'fontkit', 'restructure'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// next-intl plugin: leggi i18n config + bundle messages a build time
const nextConfigWithIntl = withNextIntl(nextConfig);

// Bundle analyzer: attivo solo con ANALYZE=true npm run build.
// https://www.npmjs.com/package/@next/bundle-analyzer
let configWithAnalyzer = nextConfigWithIntl;
try {
  const withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true',
  });
  configWithAnalyzer = withBundleAnalyzer(nextConfigWithIntl);
} catch { /* @next/bundle-analyzer non installato in prod, ok */ }

// Sentry wrapper: attivo solo se NEXT_PUBLIC_SENTRY_DSN e' configurato.
const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  try {
    const { withSentryConfig } = require('@sentry/nextjs');
    module.exports = withSentryConfig(configWithAnalyzer, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
      // Source maps upload (richiede SENTRY_AUTH_TOKEN in CI env)
      widenClientFileUpload: true,
      // Tunnel route per bypassare ad-blockers (opzionale)
      tunnelRoute: '/monitoring',
      // Hide source maps dal client bundle finale
      hideSourceMaps: true,
      // Disabilita Sentry CLI logging in dev
      disableLogger: true,
    });
  } catch {
    // @sentry/nextjs non installato: fallback al config con analyzer
    module.exports = configWithAnalyzer;
  }
} else {
  module.exports = configWithAnalyzer;
}
