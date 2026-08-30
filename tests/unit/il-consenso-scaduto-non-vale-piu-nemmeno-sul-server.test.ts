import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseConsentCookie, writeConsent, CONSENT_VERSION, CONSENT_COOKIE } from '@/lib/consent';

/**
 * 27/8/2026 (R063) — IL BANNER CONSIDERAVA SCADUTO UN CONSENSO CHE IL SERVER
 * CONTINUAVA A ONORARE.
 *
 * Quando l'informativa sui cookie cambia si alza il numero di versione, e il
 * banner ricompare per farsi dire di nuovo di sì. Nel browser funzionava: lo
 * stato salvato porta con sé la versione e viene scartato.
 *
 * Il cookie di prima parte no. Dentro c'erano tre cifre — funzionali,
 * statistiche, pubblicità — e nient'altro: nessun modo, per chi lo legge dal
 * server, di sapere a quale informativa si riferisse. Finché la persona non
 * rispondeva al banner nuovo, la raccolta degli eventi e i cookie dei test
 * continuavano a partire sulla base di un consenso che noi stessi avevamo
 * dichiarato scaduto. Il client lo considerava vecchio, il server no.
 *
 * Adesso la versione viaggia dentro il cookie («2:110») e un cookie di una
 * versione diversa vale come un no. Un cookie della vecchia forma, senza
 * versione, vale come un no per lo stesso motivo: non sappiamo a cosa la
 * persona avesse detto di sì.
 */

describe('il cookie del consenso porta con sé la sua versione', () => {
  it('il consenso della versione corrente si legge come è stato dato', () => {
    expect(parseConsentCookie(`${CONSENT_VERSION}:110`)).toEqual({
      functional: true, analytics: true, marketing: false,
    });
  });

  it('un consenso di una versione precedente non vale più', () => {
    expect(
      parseConsentCookie('1:111'),
      'dopo un aggiornamento dell’informativa continuavamo a misurare in base al sì di prima',
    ).toEqual({ functional: false, analytics: false, marketing: false });
  });

  it('il cookie vecchio senza versione non vale, perché non sappiamo a cosa fosse un sì', () => {
    expect(parseConsentCookie('111')).toEqual({
      functional: false, analytics: false, marketing: false,
    });
  });

  it('un cookie storto non fa passare niente', () => {
    for (const storto of ['', 'ciao', ':', '2:', 'x:111', `${CONSENT_VERSION}`]) {
      expect(parseConsentCookie(storto), `«${storto}» non deve valere come un sì`).toEqual({
        functional: false, analytics: false, marketing: false,
      });
    }
    expect(parseConsentCookie(undefined)).toEqual({
      functional: false, analytics: false, marketing: false,
    });
  });

  it('regge la codifica: i due punti nel cookie viaggiano codificati', () => {
    expect(parseConsentCookie(encodeURIComponent(`${CONSENT_VERSION}:001`))).toEqual({
      functional: false, analytics: false, marketing: true,
    });
  });
});

/**
 * La prova che conta davvero: quello che il banner SCRIVE nel browser deve
 * essere quello che il server SA RILEGGERE. Se le due metà si scollano, o
 * misuriamo senza consenso o smettiamo di misurare chi ha detto di sì — e in
 * tutti e due i casi ce ne accorgeremmo settimane dopo, dai numeri.
 */
describe('quello che scrive il banner, il server lo rilegge uguale', () => {
  const salvati = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    localStorage: (globalThis as Record<string, unknown>).localStorage,
    fetch: globalThis.fetch,
  };

  beforeEach(() => {
    const magazzino = new Map<string, string>();
    Object.assign(globalThis, {
      window: {
        location: { protocol: 'https:' },
        dispatchEvent: () => true,
      },
      document: { cookie: '' },
      localStorage: {
        getItem: (k: string) => magazzino.get(k) ?? null,
        setItem: (k: string, v: string) => { magazzino.set(k, v); },
      },
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });
  });

  afterEach(() => {
    Object.assign(globalThis, salvati);
  });

  function valoreDelCookie(): string | undefined {
    const scritto = (globalThis as unknown as { document: { cookie: string } }).document.cookie;
    return scritto.split(';')[0].split('=')[1];
  }

  it('chi accetta le statistiche viene riconosciuto anche dal server', () => {
    writeConsent({ functional: true, analytics: true, marketing: false });
    const scritto = (globalThis as unknown as { document: { cookie: string } }).document.cookie;
    expect(scritto.startsWith(`${CONSENT_COOKIE}=`)).toBe(true);
    expect(
      parseConsentCookie(valoreDelCookie()),
      'il consenso appena dato non viene riconosciuto dal server: nessun evento verrebbe più registrato',
    ).toEqual({ functional: true, analytics: true, marketing: false });
  });

  it('chi rifiuta resta un no anche per il server', () => {
    writeConsent({ functional: false, analytics: false, marketing: false });
    expect(parseConsentCookie(valoreDelCookie())).toEqual({
      functional: false, analytics: false, marketing: false,
    });
  });

  it('il cookie scritto oggi non varrebbe più dopo un cambio di informativa', () => {
    writeConsent({ functional: true, analytics: true, marketing: true });
    const valore = decodeURIComponent(valoreDelCookie() ?? '');
    expect(valore.startsWith(`${CONSENT_VERSION}:`), `nel cookie non c'è la versione: «${valore}»`).toBe(true);
  });
});
