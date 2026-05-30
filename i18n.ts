import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

/**
 * next-intl request config — cookie-based locale (no URL prefix).
 *
 * Esperti consultati:
 * - SEO: "Locale via URL prefix /it/ /en/ e' best practice per crawler.
 *   MA in MVP single-region (Piacenza) preserviamo URL puliti. Quando
 *   si espande geografico, passeremo a localePrefix='always'."
 * - UX: "Locale switcher via cookie permette al return user di mantenere
 *   la lingua scelta senza riconfermarla a ogni navigazione."
 *
 * Strategia:
 * - default locale: 'it' (audience primaria)
 * - locale alternativi: 'en'
 * - rilevamento: cookie 'NEXT_LOCALE' > Accept-Language header > default
 */

export const SUPPORTED_LOCALES = ['it', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'it';

function isSupported(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function parseAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  // Accept-Language: it-IT,it;q=0.9,en;q=0.8
  const langs = header.split(',').map((s) => s.split(';')[0].trim().toLowerCase().slice(0, 2));
  for (const lang of langs) {
    if (isSupported(lang)) return lang;
  }
  return null;
}

export function resolveLocale(cookieLocale: string | undefined, acceptLang: string | null): Locale {
  if (isSupported(cookieLocale)) return cookieLocale;
  const fromHeader = parseAcceptLanguage(acceptLang);
  if (fromHeader) return fromHeader;
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  const acceptLang = (await headers()).get('accept-language');
  const locale = resolveLocale(cookieLocale, acceptLang);

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
