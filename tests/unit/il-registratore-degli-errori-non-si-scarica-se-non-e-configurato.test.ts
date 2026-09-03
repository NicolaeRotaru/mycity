import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * IL REGISTRATORE DEGLI ERRORI FINIVA NEL PACCHETTO DI TUTTE E 245 LE PAGINE,
 * ANCHE SENZA ESSERE CONFIGURATO.
 *
 * `instrumentation-client.ts` e' il file che Next esegue all'avvio del browser.
 * Aveva in cima `import * as Sentry from '@sentry/nextjs'` e in fondo
 * `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart`.
 * La condizione `if (SENTRY_DSN)` in mezzo decideva se ESEGUIRE quel codice,
 * non se SPEDIRLO: un import in cima al file entra nel pacchetto comunque.
 *
 * Misurato sul build presente nella cartella: il pezzo con dentro l'SDK del
 * browser di Sentry compariva in tutte e 245 le voci del manifesto, `/layout`
 * compreso. Lo scaricava anche chi apriva solo la home o la cassa, su una rete
 * di telefono, e nel repo il DSN non esiste nemmeno.
 *
 * ── COME SI PROVA UNA COSA COSI', SENZA COMPILARE ────────────────────────────
 * Non si cerca una parola nel sorgente. Si guarda il COMPORTAMENTO che conta:
 * «qualcuno ha chiesto l'SDK di Sentry?». La finta libreria qui sotto tiene il
 * conto di quante volte viene caricata, e viene caricata solo se qualcuno la
 * importa davvero. Senza DSN quel conto deve restare a zero.
 */

const spie = vi.hoisted(() => ({
  caricamenti: 0,
  init: 0,
  navigazioni: [] as unknown[][],
}));

vi.mock('@sentry/nextjs', () => {
  // Questa fabbrica gira SOLO quando qualcuno importa davvero il modulo:
  // e' proprio la domanda del difetto.
  spie.caricamenti++;
  return {
    init: () => {
      spie.init++;
    },
    captureRouterTransitionStart: (...a: unknown[]) => {
      spie.navigazioni.push(a);
    },
  };
});

vi.mock('@/lib/analytics/sentry-config', () => ({
  get SENTRY_DSN() {
    return process.env.NEXT_PUBLIC_SENTRY_DSN;
  },
  opzioniSentry: () => ({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN }),
}));

/** Un giro d'orologio: basta a far arrivare l'import chiesto a runtime. */
const respiro = () => new Promise((r) => setTimeout(r, 0));

describe('senza indirizzo configurato, il registratore degli errori non si scarica', () => {
  beforeEach(() => {
    spie.caricamenti = 0;
    spie.init = 0;
    spie.navigazioni = [];
    vi.resetModules();
  });

  it('nessuno chiede la libreria di Sentry quando il DSN non c e', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    await import('@/instrumentation-client');
    await respiro();
    expect(
      spie.caricamenti,
      'la libreria e stata caricata pur senza indirizzo: e il codice inerte spedito a ogni pagina',
    ).toBe(0);
    expect(spie.init).toBe(0);
    vi.unstubAllEnvs();
  });

  it('il gancio delle navigazioni esiste lo stesso e non si lamenta', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const modulo = await import('@/instrumentation-client');
    // Next lo chiama a ogni cambio di pagina: se non esistesse, o se lanciasse,
    // si romperebbe la navigazione di chi non usa Sentry — cioe' tutti, oggi.
    expect(typeof modulo.onRouterTransitionStart).toBe('function');
    expect(() => modulo.onRouterTransitionStart('/carrello', 'push')).not.toThrow();
    await respiro();
    expect(spie.caricamenti, 'nemmeno navigare deve tirarsi dietro la libreria').toBe(0);
    vi.unstubAllEnvs();
  });
});

describe('con l indirizzo configurato il registratore fa il suo mestiere', () => {
  beforeEach(() => {
    spie.caricamenti = 0;
    spie.init = 0;
    spie.navigazioni = [];
    vi.resetModules();
  });

  it('la libreria si carica e si accende', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://chiave@o1.ingest.sentry.io/2');
    await import('@/instrumentation-client');
    await respiro();
    expect(spie.caricamenti, 'col DSN configurato Sentry deve arrivare davvero').toBe(1);
    expect(spie.init).toBe(1);
    vi.unstubAllEnvs();
  });

  it('le navigazioni dei primi istanti non si perdono mentre la libreria arriva', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://chiave@o1.ingest.sentry.io/2');
    const modulo = await import('@/instrumentation-client');
    // Subito, prima che l'import a runtime sia finito: e' la finestra per cui
    // #236 aveva spostato l'accensione in questo file.
    modulo.onRouterTransitionStart('/checkout', 'push');
    await respiro();
    expect(
      spie.navigazioni,
      'la prima navigazione e finita nel vuoto mentre la libreria stava arrivando',
    ).toEqual([['/checkout', 'push']]);

    // E dopo, a libreria arrivata, si inoltra dritto.
    modulo.onRouterTransitionStart('/ordini', 'replace');
    expect(spie.navigazioni).toHaveLength(2);
    vi.unstubAllEnvs();
  });
});
