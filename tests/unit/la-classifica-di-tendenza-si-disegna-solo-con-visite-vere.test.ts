/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * 31/10/2026 — «TRENDING ORA» NON DÀ MEDAGLIE SENZA VISITE.
 *
 * Senza visite la lettura ripiega sugli ultimi prodotti pubblicati, con `view_count: 0`. Il
 * riquadro li metteva in fila con #1, #2 e #3 sotto «Trending ora»: una classifica finta. Qui il
 * componente si monta davvero e si guarda cosa c'è a schermo.
 */

const globale = globalThis as Record<string, unknown>;

const prodotto = (id: string, name: string, view_count: number) => ({
  product_id: id,
  view_count,
  product: { id, name, price: 4.5, images: null, profiles: { store_name: 'Pane Quotidiano' } },
});

async function aSchermo(items: unknown[]): Promise<string> {
  const componente = (await monta('components/home/TrendingNow.tsx')).default;
  globale.__DATI_QUERY__ = items;
  const s = accendi(componente, {});
  await attendi();
  const testo = testoVisibile(s.radice);
  s.smonta();
  return testo;
}

afterEach(() => {
  delete globale.__DATI_QUERY__;
});

describe('la classifica «Trending ora»', () => {
  it('senza visite misurate non si disegna: niente medaglie agli ultimi prodotti caricati', async () => {
    const testo = await aSchermo([
      prodotto('p-focaccia', 'Focaccia al rosmarino', 0),
      prodotto('p-grissini', 'Grissini stirati', 0),
      prodotto('p-torta', 'Torta di mele', 0),
    ]);
    expect(testo).not.toContain('Trending ora');
    expect(testo).not.toMatch(/#\s*1/);
    expect(testo).not.toContain('Focaccia al rosmarino');
  });

  it('con visite vere mostra solo chi le ha, dal più visto', async () => {
    const testo = await aSchermo([
      prodotto('p-focaccia', 'Focaccia al rosmarino', 12),
      prodotto('p-grissini', 'Grissini stirati', 0),
    ]);
    expect(testo).toContain('Trending ora');
    expect(testo).toContain('Focaccia al rosmarino');
    expect(testo).toMatch(/#\s*1/);
    expect(testo).not.toContain('Grissini stirati');
  });
});
