/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca, attendi } from './aiuti/schermo';
import { getCart } from '@/lib/cart';

const globali = globalThis as Record<string, unknown>;
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FIORI = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const base = (id: string, nome: string, prezzo: number, stock: number | null) => ({
  id, name: nome, price: prezzo, images: null, status: 'available', stock, seller_id: 'neg', has_variants: false,
});

/** Un database finto con promozioni: risponde a tavole e alla funzione degli sconti. */
function database(prodotti: unknown[], sconti: Record<string, number> = {}) {
  const catena = (tavola: string) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'in', 'eq', 'order', 'limit']) c[k] = () => c;
    c.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve({
        data: tavola === 'seller_public_profiles' ? [{ id: 'neg', store_name: 'Pane Quotidiano', is_approved: true }] : prodotti,
        error: null,
      }).then(ok);
    return c;
  };
  return {
    from: catena,
    rpc: async (nome: string) =>
      nome === 'product_active_discounts'
        ? { data: Object.entries(sconti).map(([product_id, discount_percent]) => ({ product_id, discount_percent })), error: null }
        : { data: 0, error: null },
  };
}

async function apri(cart: string) {
  globali.__QUERY_FINTA__ = `cart=${cart}`;
  const mod = await monta('app/shared-cart/page.tsx');
  const s = accendi(mod.default, {});
  await attendi();
  await attendi();
  await attendi();
  return s;
}
const aggiungi = (r: HTMLElement) => [...r.querySelectorAll('button')].find((b) => /aggiungi tutto/i.test(b.textContent ?? ''))!;

describe('S07 · la lista condivisa', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    globali.__CLIENT_SUPABASE__ = undefined;
    globali.__QUERY_FINTA__ = undefined;
    localStorage.clear();
  });

  it('una quantità con la virgola non entra (la cassa accetta solo interi)', async () => {
    globali.__CLIENT_SUPABASE__ = database([base(PANE, 'Focaccia', 3, null)]);
    const s = await apri(`${PANE}:1.5`);
    expect(s.radice.textContent).toContain('Link non valido');
    expect(s.radice.textContent).not.toMatch(/scaduto|malformato|e'/);
    s.smonta();
  }, 60000);

  it('lo stesso prodotto ripetuto si somma: la lista mostra quello che entra nel carrello', async () => {
    globali.__CLIENT_SUPABASE__ = database([base(PANE, 'Focaccia', 3, null)]);
    const s = await apri(`${PANE}:2,${PANE}:3`);
    expect(s.radice.textContent).toContain('×5');
    s.agisci(() => clicca(aggiungi(s.radice)));
    expect(getCart().map((r) => [r.id, r.quantity])).toEqual([[PANE, 5]]);
    s.smonta();
  }, 60000);

  it('merce finita o scarsa: la lista mostra le quantità e i prezzi che entrano davvero', async () => {
    globali.__CLIENT_SUPABASE__ = database([base(PANE, 'Focaccia', 3, 2), base(FIORI, 'Pane', 2, 0)]);
    const s = await apri(`${PANE}:5,${FIORI}:2`);
    const t = s.radice.textContent ?? '';
    expect(t).toContain('×2');
    expect(t).toContain('ne restano solo 2 dei 5 suggeriti');
    expect(t).toContain('6,00');
    expect(t).not.toContain('15,00');
    expect(t).toContain('1 prodotto non disponibile è stato escluso dalla lista.');
    s.smonta();
  }, 60000);

  it('con una promozione attiva mostra e mette nel carrello il prezzo scontato', async () => {
    globali.__CLIENT_SUPABASE__ = database([base(PANE, 'Focaccia', 10, null)], { [PANE]: 20 });
    const s = await apri(`${PANE}:1`);
    expect(s.radice.textContent).toContain('8,00');
    s.agisci(() => clicca(aggiungi(s.radice)));
    expect(getCart()[0]?.price).toBe(8);
    s.smonta();
  }, 60000);
});

describe('S07 · la variante viaggia con la lista', () => {
  afterEach(() => {
    globali.__CLIENT_SUPABASE__ = undefined;
    globali.__QUERY_FINTA__ = undefined;
  });
  it('chi riceve vede quale variante aveva scelto chi ha condiviso', async () => {
    const TORTA = 'cccccccc-3333-4333-8333-cccccccccccc';
    globali.__CLIENT_SUPABASE__ = database([{ ...base(TORTA, 'Torta della nonna', 20, null), has_variants: true }]);
    const s = await apri(`${TORTA}:1:${encodeURIComponent('grande')},${TORTA}:2:${encodeURIComponent('piccola')}`);
    expect(s.radice.textContent).toContain('Torta della nonna — scegli le opzioni');
    expect(s.radice.textContent).toContain('nella lista: grande × 1, piccola × 2');
    s.smonta();
  }, 60000);

  it('il pulsante «Condividi» mette la variante nel testo e nel link', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/ShareCartButton.tsx', 'utf8');
    expect(src).toMatch(/i\.variantLabel \? `:\$\{encodeURIComponent\(i\.variantLabel\)\}`/);
    expect(src).toMatch(/i\.variantLabel \? ` · \$\{i\.variantLabel\}`/);
  });
});
