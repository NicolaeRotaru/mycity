import { describe, it, expect } from 'vitest';
import {
  contaLaVisita,
  frenoOrario,
  improntaOraria,
  FINESTRA_DELLA_VISITA_MS,
  type Archivio,
} from '@/lib/analytics/visita-prodotto';

/**
 * R02-015 (12/11/2026) — Il browser conta le visite con la regola del database: una per prodotto
 * all'ora, in tutte le schede. Due schede aperte in dieci minuti danno UN «product_viewed», come
 * danno una riga in product_views.
 */

function archivio(): Archivio {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

describe('R02-015 · una visita per prodotto all ora, come nel database', () => {
  it('due schede in dieci minuti: un annuncio solo; dopo un ora: un altro', async () => {
    const condiviso = archivio(); // localStorage è uno per tutte le schede
    let ora = Date.parse('2026-11-12T10:00:00Z');
    const annunci: string[] = [];
    const scheda = () => ({
      consenso: () => true,
      ...frenoOrario(condiviso, () => ora),
      annuncia: () => { annunci.push(new Date(ora).toISOString()); },
      registra: async () => {},
    });

    expect(await contaLaVisita('p-1', scheda())).toBe('contata');
    ora += 10 * 60_000;
    expect(await contaLaVisita('p-1', scheda()), 'seconda scheda, dieci minuti dopo').toBe('gia-contata');
    ora += FINESTRA_DELLA_VISITA_MS;
    expect(await contaLaVisita('p-1', scheda()), 'passata l ora').toBe('contata');
    expect(annunci).toHaveLength(2);
  });

  it('l impronta dei visitatori anonimi è la stessa per un ora in tutte le schede, poi cambia', () => {
    const condiviso = archivio();
    let ora = Date.parse('2026-11-12T10:00:00Z');
    let n = 0;
    const nuova = () => `impronta-${++n}`;
    const prima = improntaOraria(condiviso, () => ora, nuova);
    ora += 20 * 60_000;
    expect(improntaOraria(condiviso, () => ora, nuova)).toBe(prima);
    ora += FINESTRA_DELLA_VISITA_MS;
    expect(improntaOraria(condiviso, () => ora, nuova)).not.toBe(prima);
  });

  it('il tracciatore usa questo freno e questa impronta, non quelli per scheda', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/ProductViewTracker.tsx', 'utf8');
    expect(src).toMatch(/frenoOrario\(/);
    expect(src).toMatch(/improntaOraria\(/);
    expect(src).not.toMatch(/sessionStorage/);
  });
});

describe('R02-015 · dopo il qa: le chiavi scadute non restano nel browser', () => {
  it('contando una visita nuova si tolgono i freni oltre l ora', () => {
    const m = new Map<string, string>();
    const archivio = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
    let ora = Date.parse('2026-11-12T10:00:00Z');
    frenoOrario(archivio, () => ora).segnaContata('mc_viewed_vecchio');
    ora += FINESTRA_DELLA_VISITA_MS + 1;
    frenoOrario(archivio, () => ora).segnaContata('mc_viewed_nuovo');
    expect([...m.keys()]).toEqual(['mc_viewed_nuovo']);
  });
});
