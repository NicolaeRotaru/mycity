import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/** S03 — il lavoro di rilascio e il controllo della deriva (schede 1645, 218, 2657). Lettura del YAML vero. */
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (t: string) => unknown };
type Passo = { name?: string; run?: string; env?: Record<string, string> };
type Doc = { concurrency?: unknown; jobs: Record<string, { concurrency?: { group: string; 'cancel-in-progress': boolean }; steps: Passo[] }> };
const rilascio = yaml.load(readFileSync('.github/workflows/deploy-dopo-ci.yml', 'utf8')) as Doc;
const deriva = yaml.load(readFileSync('.github/workflows/deriva-migrazioni-produzione.yml', 'utf8')) as Doc;

describe('rilascio e deriva', () => {
  it('1645 — la fila dei rilasci sta sul lavoro, non su tutto il file', () => {
    expect(rilascio.concurrency).toBeUndefined();
    const c = rilascio.jobs.vercel.concurrency!;
    expect(c['cancel-in-progress']).toBe(false);
    expect(c.group.startsWith('rilascio-produzione')).toBe(true);
  });

  it('218 — nessuna installazione di librerie con la password del database nell ambiente', () => {
    for (const p of rilascio.jobs.vercel.steps) {
      if (/npm (ci|install)/.test(p.run ?? '')) {
        expect(p.env?.SUPABASE_DB_URL, `«${p.name}» installa con la password a portata di mano`).toBeUndefined();
        expect(p.run).toMatch(/--ignore-scripts/);
      }
    }
  });

  it('2657 — il controllo notturno della deriva non passa per verde se salta', () => {
    const passo = Object.values(deriva.jobs).flatMap((j) => j.steps).find((p) => p.name === 'Confronta il repository con il database vero')!;
    expect(passo.env?.SALTO_E_ERRORE).toBe('1');
  });
});
