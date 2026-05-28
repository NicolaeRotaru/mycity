# Bundle Analysis

> Generato con `ANALYZE=true npm run build` (@next/bundle-analyzer).
> Report HTML completi in `.next/analyze/{client,edge,nodejs}.html` (gitignored).

## Top moduli client bundle (parsed size)

| Modulo | Size | Note |
|--------|------|------|
| posthog-js | 189 KB | ✅ Lazy: `import('posthog-js')` in lib/analytics/posthog.tsx |
| react-dom (prod) | 169 KB | Core React, non riducibile |
| leaflet | 145 KB | ✅ Lazy: StoreLocationPickerLazy + DeliveryMap dynamic import |
| @sentry replay | 121 KB | Session replay — caricato solo se NEXT_PUBLIC_SENTRY_DSN settato |
| @supabase/auth-js | 59 KB | Core auth, necessario |
| zod | 48 KB | Validation — usato ovunque, tree-shaken |
| sonner | 32 KB | Toast — ✅ in optimizePackageImports |
| postgrest-js | 31 KB | Supabase query builder |
| react-hook-form | 24 KB | Form validation |

## Valutazione

I 3 moduli più pesanti (PostHog, Leaflet, Sentry replay) sono già:
- **PostHog**: lazy import, caricato solo dopo consenso analytics
- **Leaflet**: dynamic import nei componenti mappa (StoreLocationPickerLazy)
- **Sentry replay**: condizionale a env var, non in bundle se DSN assente

`optimizePackageImports` in next.config.js copre `lucide-react`, `sonner`,
`@tanstack/react-query` per tree-shaking aggressivo.

## Azioni possibili (non urgenti)

1. **Leaflet → MapLibre GL** (lighter) se le mappe diventano critiche per LCP.
2. **Sentry replay sampling** già configurato — verificare sample rate in prod.
3. **PostHog**: valutare `posthog-js/lite` se session replay non serve.

Nessuna azione bloccante: il First Load JS shared è ~88 KB (ottimo per un
marketplace con mappe + analytics + payments).
