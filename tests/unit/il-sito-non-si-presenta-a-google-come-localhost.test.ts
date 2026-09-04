/**
 * 3/9/2026 — IL SITO PUBBLICATO DICEVA A GOOGLE DI STARE SUL COMPUTER DI CHI LO SCRIVE.
 *
 * L'HTML servito davvero da mycity-phi.vercel.app portava, parola per parola:
 *
 *   <link rel="canonical" href="http://localhost:3000">
 *   <meta property="og:url" content="http://localhost:3000">
 *
 * `localhost` è il nome che ogni computer dà a sé stesso. Dirlo a Google
 * significa dichiarare che l'indirizzo ufficiale di ogni nostra pagina è una
 * macchina che, per chiunque stia fuori, non esiste: le pagine non si
 * indicizzano e ogni link condiviso su WhatsApp mostra l'anteprima rotta.
 * Niente errori nei log: il sito rispondeva 200 e sembrava sano.
 *
 * LA MALATTIA, non il sintomo. Non era una riga sbagliata: erano TRE copie
 * della stessa riga. `app/layout.tsx` (canonical, og:url, dati strutturati),
 * `app/robots.ts` e `app/sitemap.ts` calcolavano ognuno per conto suo
 * `process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'`. Bastava che
 * quella variabile mancasse su Vercel — e mancava — perché tutti e tre
 * ripiegassero insieme sul nome del computer di sviluppo.
 *
 * Adesso l'indirizzo lo decide una funzione sola, `indirizzoPubblico()` in
 * `lib/env.ts`, che in rete non pronuncia mai «localhost» e sa dire da dove
 * ha preso l'indirizzo che sta usando.
 *
 * Questa prova ESEGUE quella funzione con le variabili della produzione, e
 * esegue anche il robots.txt vero. Poi controlla che i tre file che parlano a
 * Google non si siano ripresi la loro copia privata del ripiego.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { env, indirizzoPubblico, DOMINIO_PUBBLICO } from '@/lib/env';
import robots from '@/app/robots';

const VARIABILI = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL',
  'NEXT_PUBLIC_VERCEL_URL',
  'NEXT_PUBLIC_VERCEL_ENV',
  'VERCEL_ENV',
  'VERCEL',
  'NODE_ENV',
] as const;

/** Riscrive l'ambiente da zero: esistono solo le variabili passate qui. */
function ambiente(valori: Partial<Record<(typeof VARIABILI)[number], string>>) {
  for (const k of VARIABILI) vi.stubEnv(k, undefined);
  for (const [k, v] of Object.entries(valori)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("l'indirizzo con cui il sito si presenta al mondo", () => {
  it('in produzione non nomina mai il computer di chi sviluppa, nemmeno senza nessuna variabile', () => {
    // Il caso vero del 3/9: sito in rete, NEXT_PUBLIC_APP_URL non impostata.
    ambiente({ NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production' });

    const { url, fonte } = indirizzoPubblico();

    expect(url, 'il sito si presenta ancora come localhost').not.toContain('localhost');
    expect(url).toBe(DOMINIO_PUBBLICO);
    expect(fonte).toBe('dominio-di-riserva');
  });

  it('quando la variabile c’è vince lei, e il codice lo dice', () => {
    ambiente({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://mycity-phi.vercel.app' });

    expect(indirizzoPubblico()).toEqual({
      url: 'https://mycity-phi.vercel.app',
      fonte: 'variabile',
    });
  });

  it('perdona la barra finale e il protocollo dimenticato da chi configura', () => {
    ambiente({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'mycity-marketplace.com/' });
    // Senza questo, `new URL(...)` nel layout farebbe cadere l'intero sito.
    expect(() => new URL(env.appUrl())).not.toThrow();
    expect(env.appUrl()).toBe('https://mycity-marketplace.com');
  });

  it('senza variabile usa il dominio che Vercel ci dà, mai localhost', () => {
    ambiente({
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'mycity-phi.vercel.app',
      NEXT_PUBLIC_VERCEL_URL: 'mycity-abc123.vercel.app',
    });

    expect(indirizzoPubblico()).toEqual({
      url: 'https://mycity-phi.vercel.app',
      fonte: 'dominio-di-produzione',
    });
  });

  it("in un'anteprima resta sull'anteprima: un pagamento di prova non deve rimbalzare in produzione", () => {
    ambiente({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_VERCEL_ENV: 'preview',
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'mycity-phi.vercel.app',
      NEXT_PUBLIC_VERCEL_URL: 'mycity-abc123.vercel.app',
    });

    expect(indirizzoPubblico()).toEqual({
      url: 'https://mycity-abc123.vercel.app',
      fonte: 'questa-pubblicazione',
    });
  });

  it('sul computer di chi sviluppa localhost resta giusto, e il codice sa che è quello', () => {
    ambiente({});
    expect(indirizzoPubblico()).toEqual({
      url: 'http://localhost:3000',
      fonte: 'computer-di-sviluppo',
    });
  });
});

describe('il robots.txt che legge Googlebot', () => {
  it('in produzione manda Google a una sitemap raggiungibile, non a localhost', () => {
    ambiente({ NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production' });

    const r = robots();

    expect(r.sitemap).toBe(`${DOMINIO_PUBBLICO}/sitemap.xml`);
    expect(String(r.sitemap)).not.toContain('localhost');
    expect(r.host).not.toContain('localhost');
  });

  it("segue la variabile quando c'è, senza doppie barre", () => {
    ambiente({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://mycity-marketplace.com/' });

    const r = robots();

    expect(r.sitemap).toBe('https://mycity-marketplace.com/sitemap.xml');
    expect(r.host).toBe('https://mycity-marketplace.com');
  });
});

/**
 * Il cancello vero: la malattia non era il valore sbagliato, era che ogni file
 * se lo calcolava da sé. Se domani qualcuno rimette una copia privata dentro
 * uno dei tre file che parlano a Google, questa prova diventa rossa.
 */
describe('i tre file che parlano a Google chiedono l’indirizzo a un posto solo', () => {
  const FILE_CHE_PARLANO_A_GOOGLE = ['app/layout.tsx', 'app/robots.ts', 'app/sitemap.ts'];

  /** Il codice senza i commenti: qui «localhost» si può raccontare, non eseguire. */
  const soloCodice = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  for (const percorso of FILE_CHE_PARLANO_A_GOOGLE) {
    it(`${percorso} non tiene una copia sua del ripiego`, () => {
      const codice = soloCodice(readFileSync(percorso, 'utf8'));

      expect(codice, 'legge di nuovo la variabile per conto suo').not.toMatch(
        /process\.env\.NEXT_PUBLIC_APP_URL/,
      );
      expect(codice, 'è tornato il ripiego scritto a mano su localhost').not.toContain('localhost');
      expect(codice, "non chiede l'indirizzo a lib/env.ts").toMatch(/from '@\/lib\/env'/);
    });
  }

  it('i metadati e i dati strutturati della home usano quell’unico indirizzo', () => {
    const src = readFileSync('app/layout.tsx', 'utf8');

    // Da qui Next costruisce canonical e og:url di ogni pagina del sito.
    expect(src).toMatch(/const \{ url: APP_URL[^}]*\} = indirizzoPubblico\(\)/);
    expect(src).toContain('metadataBase: new URL(APP_URL)');
    // Lo schema OnlineStore letto dai motori di ricerca deve dire quale sito è.
    const schema = src.slice(src.indexOf('const orgSchema'), src.indexOf('// Preconnect'));
    expect(schema, "lo schema non dichiara l'indirizzo del sito").toContain('url: APP_URL');
  });
});
