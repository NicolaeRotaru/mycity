import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { CONSENT_VERSION, writeConsent } from '@/lib/consent';

/**
 * #69 — Il registro dei consensi cookie era vuoto. Sempre.
 *
 * Il browser mandava `versione: 1` (un numero); la rotta si aspettava una
 * stringa e rispondeva 400. Ogni scelta — accetto, rifiuto, personalizzo —
 * veniva buttata via in silenzio, e nessuno se ne accorgeva perché la
 * registrazione è fatta apposta per non disturbare chi naviga.
 *
 * Il giorno in cui il Garante, o semplicemente un cliente, chiede «dimostrate
 * che vi aveva detto di sì», non c'è niente da mostrare.
 */

// Lo schema del corpo, uguale a quello della rotta (app/api/consent/route.ts).
const CorpoRotta = z.object({
  analytics: z.boolean(),
  marketing: z.boolean(),
  versione: z.string().max(40).optional(),
});

describe('la scelta sui cookie arriva davvero al registro', () => {
  let inviato: unknown;

  beforeEach(() => {
    inviato = undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      inviato = JSON.parse(String(init?.body ?? '{}'));
      return new Response('{}', { status: 200 });
    }));
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem: () => {}, removeItem: () => {},
    });
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('window', {
      location: { protocol: 'https:' },
      dispatchEvent: () => true,
    });
    vi.stubGlobal('dispatchEvent', () => true);
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} } as never);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('il corpo mandato passa la validazione della rotta (prima veniva respinto con 400)', () => {
    writeConsent({ functional: true, analytics: true, marketing: false });
    const esito = CorpoRotta.safeParse(inviato);
    expect(esito.success).toBe(true);
  });

  it('la versione viaggia come testo, non come numero', () => {
    writeConsent({ functional: true, analytics: false, marketing: false });
    expect(typeof (inviato as { versione?: unknown }).versione).toBe('string');
    expect((inviato as { versione?: string }).versione).toBe(String(CONSENT_VERSION));
  });

  it('un numero al posto del testo verrebbe respinto: è esattamente il difetto', () => {
    expect(CorpoRotta.safeParse({ analytics: true, marketing: false, versione: 1 }).success).toBe(false);
  });

  it('la scelta di ogni categoria viaggia come è stata fatta', () => {
    writeConsent({ functional: true, analytics: false, marketing: true });
    expect(inviato).toMatchObject({ analytics: false, marketing: true });
  });
});
