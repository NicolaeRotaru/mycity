import { getRequestConfig } from 'next-intl/server';

/**
 * next-intl request config.
 *
 * ⚠️ IL RILEVAMENTO DELLA LINGUA È SPENTO, ED È UNA SCELTA. (#7, #83)
 *
 * Il multilingua è fermo a metà: 29 file su 347 usano davvero le traduzioni,
 * cioè l'8%, e il selettore di lingua non è esposto (Footer.tsx lo dice a
 * chiare lettere). Finché è così, riconoscere la lingua del browser faceva due
 * danni concreti:
 *
 * ① Un visitatore col browser in inglese riceveva una pagina marcata
 *    `lang="en"` con dentro il 92% di testo italiano. I lettori per non
 *    vedenti provano allora a pronunciare l'italiano con la fonetica inglese,
 *    e Google indicizza come inglese una pagina italiana.
 *
 * ② Leggere cookie e intestazioni a ogni render rendeva DINAMICA ogni singola
 *    rotta dell'applicazione — questo file è chiamato dal guscio comune, che
 *    sta sopra tutto. Anche /privacy e /terms, che non cambiano mai, venivano
 *    ricalcolate dal server a ogni visita: 200 rotte su 202 fuori dalla cache,
 *    e i tre `export const revalidate` scritti nel progetto non producevano
 *    nessuna pagina in cache.
 *
 * La lingua del documento è quindi quella del contenuto: italiano. Tutta la
 * macchina next-intl resta al suo posto e si riaccende cambiando
 * RILEVAMENTO_LINGUA_ATTIVO in `true`, il giorno in cui la traduzione è
 * completa e il selettore torna nel footer — non prima, perché una lingua che
 * si può scegliere e non cambia niente è peggio di una lingua sola.
 *
 * `resolveLocale` resta esportata: è la regola di rilevamento, e la useremo
 * quel giorno. Oggi non la chiama il render.
 */

/** Il rilevamento della lingua è acceso? Vedi il commento qui sopra. */
export const RILEVAMENTO_LINGUA_ATTIVO = false;

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
  // Nessuna lettura di cookie o intestazioni: è quella lettura a rendere
  // dinamica ogni rotta del sito. Vedi il commento in cima al file.
  const locale = DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
