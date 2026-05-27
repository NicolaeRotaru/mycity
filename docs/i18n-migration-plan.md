# i18n Migration Plan — next-intl integration

> **STATO: SETUP BASE APPLICATO** (cookie-based locale, no URL prefix).
>
> Infrastruttura pronta:
> - `i18n.ts` (root): getRequestConfig + resolveLocale (cookie > Accept-Lang > default)
> - `messages/it.json`, `messages/en.json` con namespaces (actions, states,
>   errors, toasts, nav, checkout, marketing)
> - `app/layout.tsx`: NextIntlClientProvider wrap + html lang dinamico
> - `next.config.js`: withNextIntl plugin
> - `app/api/locale/route.ts`: POST setter cookie NEXT_LOCALE
> - `components/LocaleSwitcher.tsx`: toggle UI (Globe icon)
>
> **NON migrate**: le ~50+ stringhe sparse nel codice (richiede grep+sostituzione
> ad ampio raggio). Il `lib/copy.ts` resta come fallback compat per ora.
>
> Resta da fare:
> 1. Migrare gradualmente le stringhe da hardcoded a `useTranslations()`
> 2. Aggiungere altre lingue se richiesto (de, fr, ecc)
> 3. Aggiungere LocaleSwitcher in Footer o Header

## Stato attuale
- Tutte le stringhe UI in italiano hardcoded
- `lib/copy.ts` centralizza alcune stringhe ma in italiano fisso
- 16 file usano `COPY.*`, ~50+ stringhe hardcoded ovunque
- Date: `formatDate` usa `it-IT` hardcoded

## Obiettivo
Predisporre il marketplace a espansione fuori Piacenza (es. Parma, Modena,
poi multilingua per turisti).

## Stack consigliato: `next-intl`
- Maturo, App Router-friendly
- Routing automatico `/it/`, `/en/` via middleware
- Server Components support
- Bundle leggero (~5KB)

## Step di migrazione (NON eseguiti — solo plan)

### 1. Installa
```bash
npm install next-intl
```

### 2. Crea struttura messages/
```
messages/
  it.json        # default
  en.json        # primo lingua aggiuntiva
```

Formato JSON nested per namespace:
```json
{
  "actions": {
    "save": "Salva",
    "cancel": "Annulla",
    "confirm": "Conferma"
  },
  "checkout": {
    "title": "Checkout",
    "addressTitle": "Indirizzo di consegna"
  }
}
```

### 3. Middleware routing
File `middleware.ts` (root):
```ts
import createMiddleware from 'next-intl/middleware';
export default createMiddleware({
  locales: ['it', 'en'],
  defaultLocale: 'it',
  localePrefix: 'as-needed', // /it/* opzionale, /en/* esplicito
});
export const config = { matcher: ['/((?!api|_next|.*\\..*).*)'] };
```

### 4. Sostituisci `lib/copy.ts` con hook `useTranslations`
```tsx
// Vecchio:
const t = COPY.actions.save;

// Nuovo:
import { useTranslations } from 'next-intl';
const t = useTranslations('actions');
return <button>{t('save')}</button>;
```

### 5. Server Components
```tsx
import { getTranslations } from 'next-intl/server';
const t = await getTranslations('checkout');
```

### 6. Date / format
```tsx
import { useFormatter } from 'next-intl';
const format = useFormatter();
format.dateTime(date, { dateStyle: 'long' });
```

## Sforzo stimato
- Setup base: 1 giorno
- Migrazione strings esistenti: 3-5 giorni (semi-automatizzabile con grep)
- Traduzione EN: dipende dal volume (probabile 2-3 giorni con DeepL + revisione umana)
- Test routing + edge cases: 1-2 giorni
- **Totale**: 1.5-2 settimane per supporto solido it/en

## Rischi
- Routing `/it/checkout` vs `/checkout` (oggi) — break inbound link esistenti
- SEO: serve hreflang tag, sitemap multilingua
- Email templates separati per lingua (Resend supporta variabili dinamiche)

## Decisione attuale (2026-05-27)
**NON migriamo ancora**. MVP italiano-only fino a PMF Piacenza confermato.
Quando si decide di espandere geografico → applicare questo plan.

Questo file resta come north-star del piano.
