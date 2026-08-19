import { describe, it, expect } from 'vitest';
import { buildCatalogBatchRequests } from '@/lib/ai/catalogBatch';
import { resolveAiPatch } from '@/lib/products/aiPatch';

/**
 * 192 — «Applica a tutti» non può riscrivere i soldi di duecento prodotti.
 *
 * Il lavoro massivo dell'AI Studio proponeva un patch con lo schema completo —
 * prezzo, disponibilità e stato compresi — e il pulsante «Applica a tutti» lo
 * scriveva su ogni prodotto selezionato senza mostrare cosa cambiava. Un prezzo
 * sbagliato su duecento schede non lo scopri prima degli ordini.
 *
 * Due prove, tutte e due sul comportamento: che cosa il modello può proporre nel
 * lotto, e che cosa il server accetta di scrivere.
 */

const PRODOTTO = {
  id: 'p1',
  name: 'Coppa Piacentina DOP',
  description: 'Salume tipico stagionato.',
  price: 20,
  compare_at_price: null,
  unit: 'pezzo',
  condition: 'nuovo',
  stock: 5,
  status: 'available',
  category_id: 'c1',
  images: [],
  attributes: null,
  tags: null,
  has_variants: false,
};

describe('il lavoro massivo dell AI non tocca prezzo, disponibilità e stato', () => {
  it('lo strumento del lotto non offre nemmeno i campi economici', () => {
    const richieste = buildCatalogBatchRequests({
      operation: 'improve',
      products: [PRODOTTO],
      categories: [],
    });
    expect(richieste).toHaveLength(1);

    const strumento = richieste[0].tools?.[0] as
      | { input_schema?: { properties?: { patch?: { properties?: Record<string, unknown> } } } }
      | undefined;
    const campiProponibili = Object.keys(
      strumento?.input_schema?.properties?.patch?.properties ?? {},
    );

    expect(campiProponibili.length).toBeGreaterThan(0); // il lotto serve ancora a qualcosa
    for (const economico of ['price', 'compare_at_price', 'stock', 'unlimited_stock', 'status']) {
      expect(campiProponibili).not.toContain(economico);
    }
    // Il testo resta il suo mestiere.
    expect(campiProponibili).toContain('description');
  });
});

describe('la banda di sicurezza sul prezzo', () => {
  const base = { attributes: null, category_id: 'c1', price: 20 };

  it('un ritocco dentro il 30% si applica', () => {
    const { update, changed } = resolveAiPatch({
      patch: { price: 24 },
      current: base,
      categories: [],
    });
    expect(update.price).toBe(24);
    expect(changed).toContain('prezzo');
  });

  it('un salto oltre il 30% NON si applica, e si dice perché', () => {
    const { update, changed } = resolveAiPatch({
      patch: { price: 2 }, // il classico zero perso: 20 € diventano 2 €
      current: base,
      categories: [],
    });
    expect(update.price).toBeUndefined();
    expect(changed.join(' ')).toContain('NON applicato');
  });

  it('senza prezzo attuale la banda non si inventa un limite', () => {
    const { update } = resolveAiPatch({
      patch: { price: 99 },
      current: { attributes: null, category_id: 'c1' },
      categories: [],
    });
    expect(update.price).toBe(99);
  });
});
