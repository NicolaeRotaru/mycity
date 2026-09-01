import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ambienteSentry } from '@/lib/analytics/ambiente';

/**
 * GLI ERRORI DELLE ANTEPRIME FINIVANO MESCOLATI A QUELLI VERI.
 *
 * Radiografia del 27/8/2026 (R187). Su Vercel `NODE_ENV` vale `production` in
 * ogni pubblicazione compilata: l'anteprima di un ramo di lavoro a meta' e il
 * sito che usano i clienti finivano nello stesso mucchio di errori. Il rumore
 * delle anteprime copre il segnale della produzione, e quell'elenco smette di
 * essere guardato.
 *
 * La prova mette la funzione nei tre ambienti che esistono davvero, e poi
 * verifica che nessuno dei tre punti di accensione sia rimasto indietro con la
 * sua copia: il difetto era proprio che la stessa riga stava scritta in tre
 * posti, quindi bastava ripararne due.
 */

/** `NODE_ENV` e dichiarato di sola lettura nei tipi: qui va scritto davvero. */
const env = () => process.env as Record<string, string | undefined>;

const salvato = { ...process.env };
afterEach(() => { process.env = { ...salvato }; });

describe('da quale ambiente arriva un errore', () => {
  it('su Vercel in produzione dice produzione', () => {
    process.env.VERCEL_ENV = 'production';
    env().NODE_ENV = 'production';
    expect(ambienteSentry()).toBe('production');
  });

  it('su un anteprima di ramo NON dice produzione, anche se NODE_ENV lo dice', () => {
    process.env.VERCEL_ENV = 'preview';
    env().NODE_ENV = 'production'; // e' cosi' che Vercel compila le anteprime
    expect(
      ambienteSentry(),
      'l anteprima si dichiara produzione: i suoi errori si mescolano a quelli dei clienti',
    ).toBe('preview');
  });

  it('fuori da Vercel ripiega su NODE_ENV', () => {
    delete process.env.VERCEL_ENV;
    env().NODE_ENV = 'development';
    expect(ambienteSentry()).toBe('development');
  });

  it('senza niente non resta a mani vuote', () => {
    delete process.env.VERCEL_ENV;
    delete env().NODE_ENV;
    expect(ambienteSentry()).toBe('development');
  });

  it('nessuno dei tre punti di accensione e rimasto con la sua copia', () => {
    const punti = ['lib/analytics/sentry-config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts'];
    for (const p of punti) {
      const sorgente = readFileSync(join(process.cwd(), p), 'utf8');
      const riga = sorgente.split('\n').find((r) => r.trim().startsWith('environment:'));
      expect(riga, `${p} non dichiara nessun ambiente a Sentry`).toBeDefined();
      expect(
        riga,
        `${p} decide l ambiente per conto suo invece di usare ambienteSentry(): la riga era in tre copie, ed e cosi che se ne ripara solo una`,
      ).toContain('ambienteSentry()');
    }
  });
});
