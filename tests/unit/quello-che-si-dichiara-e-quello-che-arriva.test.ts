/**
 * 22/8/2026 — ELENCHI CHE ELENCANO COSE CHE NON ESISTONO.
 *
 * Tre difetti dello stesso tipo, in tre posti diversi:
 *
 *  · il beacon delle visite accettava cinque tipi di evento, e il sito ne manda
 *    tre. Chi legge crede che gli altri due esistano e li va a cercare in una
 *    tabella dove non ci sono mai stati;
 *
 *  · restava in giro una seconda strada verso Google Analytics che diceva di
 *    controllare il consenso e non lo controllava;
 *
 *  · i dati del titolare non erano dichiarati fra le variabili del progetto, e
 *    l'informativa privacy usciva senza indirizzo ne' partita IVA, in silenzio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const radice = process.cwd();
const leggi = (p: string) => readFileSync(join(radice, p), 'utf8');

describe('il beacon delle visite', () => {
  it("dichiara solo i tre eventi che il sito manda davvero", () => {
    const rotta = leggi('app/api/track/route.ts');
    const dentro = rotta.slice(
      rotta.indexOf('const ALLOWED_EVENTS'),
      rotta.indexOf('const SUMMARY'),
    );
    expect(dentro).toContain('page_view');
    expect(dentro).toContain('login');
    expect(dentro).toContain('logout');
    // Sostituito da `new_session` nei dati della prima vista.
    expect(dentro).not.toContain('session_start');
    // Non emesso da nessuna parte, in nessun momento.
    expect(dentro).not.toContain('signup');
  });
});

describe('le strade verso Google Analytics', () => {
  it("ce n'è una sola, e legge il consenso", () => {
    const ga = leggi('components/GoogleAnalytics.tsx');
    // La scorciatoia che diceva «no-op senza consenso» e faceva passare tutto.
    expect(ga).not.toMatch(/export function trackEvent\s*\(/);
    // Quella vera controlla il consenso, non la presenza di window.gtag.
    expect(leggi('lib/analytics/events.ts')).toContain('readConsent');
  });
});

describe('i dati del titolare', () => {
  const VARIABILI = [
    'NEXT_PUBLIC_TITOLARE_NOME',
    'NEXT_PUBLIC_TITOLARE_INDIRIZZO',
    'NEXT_PUBLIC_TITOLARE_PIVA',
    'NEXT_PUBLIC_TITOLARE_REA',
    'NEXT_PUBLIC_TITOLARE_PEC',
    'NEXT_PUBLIC_TITOLARE_CAPITALE',
    'NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY',
    'NEXT_PUBLIC_TITOLARE_REFERENTE_PRIVACY',
    'NEXT_PUBLIC_TITOLARE_EMAIL_DPO',
  ];

  it('sono tutte e nove dichiarate fra le variabili di esempio', () => {
    const esempio = leggi('.env.example');
    for (const v of VARIABILI) expect(esempio, `manca ${v}`).toContain(v);
  });

  const vecchie = { ...process.env };
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...vecchie };
    vi.resetModules();
  });

  it("se mancano, la salute del sito lo dice invece di tacere", async () => {
    for (const v of VARIABILI) delete process.env[v];
    vi.resetModules();
    const { titolare } = await import('@/lib/legal/titolare');
    const dati = titolare();
    // Il codice ripiega su un nome generico e omette il resto: la pagina esce
    // senza errori e sembra a posto. E' questo che rendeva il difetto invisibile.
    expect(dati.denominazione).toBe('MyCity');
    expect(dati.indirizzo).toBeNull();
    expect(dati.partitaIva).toBeNull();
    expect(dati.pec).toBeNull();
    // Quindi il controllo di salute deve dichiararlo per nome.
    const salute = leggi('lib/health/checks.ts');
    expect(salute).toContain('checkTitolare');
    expect(salute).toMatch(/SERVIZI_INDISPENSABILI[^;]*'titolare'/);
  });

  it("un segnaposto non passa per un dato vero", async () => {
    const { eSegnaposto } = await import('@/lib/legal/titolare');
    expect(eSegnaposto('IT12345678901')).toBe(true);
    expect(eSegnaposto('da definire')).toBe(true);
    expect(eSegnaposto('')).toBe(true);
    expect(eSegnaposto('IT01234567890')).toBe(false);
  });
});
