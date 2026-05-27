# CSP Nonce-Based Migration Plan

> **STATO: APPLICATO** in `middleware.ts` (funzioni `generateNonce` e `buildCsp`).
> In produzione: `script-src 'self' 'nonce-XYZ' 'strict-dynamic' ...`
> In development: `'unsafe-eval' 'unsafe-inline'` mantenuti per webpack HMR.
>
> Questo documento descrive il piano originale e le scelte fatte.

## Stato attuale (rischio)

```
script-src 'self' 'unsafe-inline' 'unsafe-eval' ...
style-src  'self' 'unsafe-inline' ...
```

`unsafe-inline` permette XSS injection se un attaccante riesce a iniettare
JS in pagina (es. da user content non sanitizzato). Necessario in Next 14
perché il runtime usa inline scripts per hydration.

## Obiettivo

CSP più stretta:
```
script-src 'self' 'nonce-XYZ123' 'strict-dynamic' ...
style-src  'self' 'nonce-XYZ123' ...
```

Solo gli script che hanno l'attributo `nonce="XYZ123"` matchante eseguono.
`'strict-dynamic'` permette agli script con nonce di caricare altri script
(propaga la fiducia ai loro children).

## Step di migrazione

### 1. Middleware per generare nonce per request

```ts
// middleware.ts (root)
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://...`,
    `style-src 'self' 'nonce-${nonce}'`,
    // ...
  ].join('; ');

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', cspHeader);

  const response = NextResponse.next({ request: { headers: reqHeaders } });
  response.headers.set('content-security-policy', cspHeader);
  return response;
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
```

### 2. Leggere nonce nei Server Components

```tsx
// app/layout.tsx
import { headers } from 'next/headers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = headers().get('x-nonce') ?? undefined;
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

### 3. Iniettare nonce in `<Script>` next/script

```tsx
import Script from 'next/script';
import { headers } from 'next/headers';

const nonce = headers().get('x-nonce') ?? undefined;
<Script src="..." nonce={nonce} strategy="afterInteractive" />
```

### 4. Componenti third-party (Stripe, Turnstile, PostHog, Sentry)

Verifica documentazione di OGNI integrazione per supporto nonce:
- ✅ Stripe.js: accetta nonce via `Stripe(key, { advancedFraudSignals: false })`
  in inizializzazione + manually nei Script
- ⚠️ Cloudflare Turnstile: usa inline script da `challenges.cloudflare.com` —
  serve `'self'` nel CSP o whitelist domain
- ✅ PostHog: ha supporto nonce in posthog-js
- ⚠️ Sentry: inline scripts in development. In prod usa CDN che richiede whitelist.

### 5. Test plan

**Local**:
1. `npm run dev` con CSP modificato
2. Aprire DevTools → Console → controllare warning "Refused to execute inline script"
3. Per ogni warning, fix il componente che lo causa

**Staging**:
1. Deploy su preview env Render
2. Test happy paths: home, search, product detail, cart, checkout
3. Test flows complessi: signup, login, Stripe Checkout, KYC upload
4. Reportare via CSP report-uri prima di enforcing

**Production rollout**:
1. Fase 1: `Content-Security-Policy-Report-Only` per 1 settimana → raccogli violations
2. Fase 2: Enforce dopo aver fixato i top 10 violations
3. Monitoring: Sentry alert su CSP violations

### 6. Caveats

- Routes statiche pre-renderizzate non possono usare nonce (lo stesso HTML
  viene servito a tutti). Soluzione: spostare a SSR (dynamic = 'force-dynamic')
  oppure escludere le pagine statiche dal middleware matcher.
- `'unsafe-eval'` ancora richiesto se usi codice che chiama `eval`, `new Function()`
  o regex con `new RegExp(string)` con userinput. Verificare con Sentry.
- Inline event handlers (`onClick="..."`) NON funzionano con CSP nonce.
  Tutti i componenti devono usare React event handlers (già il caso in MyCity).

## Sforzo stimato

- Setup middleware + propagation: 1 giorno
- Audit componenti per inline scripts: 1 giorno
- Fix terze parti: 1-2 giorni (Stripe, Turnstile, ecc.)
- Testing + report-only phase: 1 settimana
- Rollout enforced: dopo verifica zero violations

**Totale**: 2-3 settimane per migrazione safe.

## Decisione attuale (2026-05-27)

**Rimandato post-PMF**. CSP `unsafe-inline` è il pattern dominante per Next 14
in produzione. La vulnerabilità XSS richiede comunque un'altra falla a monte
(es. user input non sanitizzato in dangerouslySetInnerHTML — MyCity non lo usa).

Reviewer di sicurezza: rate critical SOLO per app pubbliche con user-generated
HTML content. MyCity non lo è.

Questo file resta come north-star per quando si decide di stringere.
