import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sessione S02 (5/11/2026) — «Riordina».
 *  · 289: chi chiude la domanda (Esc, tocco fuori) non si ritrova i prodotti aggiunti;
 *  · 290: un prodotto ancora in promozione non fa dire «un prezzo è cambiato»;
 *  · 165: gli articoli che non si possono più riordinare si dicono, non spariscono in silenzio;
 *  · 1731: la variante passa al carrello.
 */
const stato = vi.hoisted(() => ({
  carrello: [] as Array<Record<string, unknown>>,
  esito: 'alternativa' as 'conferma' | 'alternativa' | 'chiusa',
  prezzi: [] as Array<{ id: string; price: number }>,
  sconti: new Map<string, number>(),
  successi: [] as string[],
}));
vi.mock('@/lib/cart', () => ({
  getCart: () => stato.carrello,
  clearCart: () => { stato.carrello = []; },
  addToCart: (item: Record<string, unknown>) => { stato.carrello.push(item); },
}));
vi.mock('@/components/ConfirmDialog', () => ({
  confirmDialog: async () => stato.esito === 'conferma',
  sceltaDialog: async () => stato.esito,
}));
vi.mock('sonner', () => ({ toast: { success: (m: string) => stato.successi.push(m), error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ in: async () => ({ data: stato.prezzi }) }) }) },
}));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  fetchActiveDiscounts: async () => stato.sconti,
}));

async function carica() {
  vi.resetModules();
  return import('@/lib/riordino');
}
const TORTA = { productId: 'p1', name: 'Torta', quantity: 1, prezzoStorico: 8, variantId: 'v-grande', variantLabel: 'grande' };

beforeEach(() => {
  stato.carrello = [];
  stato.esito = 'alternativa';
  stato.prezzi = [{ id: 'p1', price: 10 }];
  stato.sconti = new Map([['p1', 20]]);
  stato.successi = [];
});

describe('riordina', () => {
  it('289 · carrello pieno e domanda chiusa senza scegliere: il carrello resta com era', async () => {
    stato.carrello = [{ id: 'altro', name: 'Latte', quantity: 1 }];
    stato.esito = 'chiusa';
    const { riordina } = await carica();
    expect(await riordina([TORTA])).toBe(0);
    expect(stato.carrello).toEqual([{ id: 'altro', name: 'Latte', quantity: 1 }]);
  });

  it('289 · «Aggiungi» aggiunge, «Sostituisci» sostituisce', async () => {
    stato.carrello = [{ id: 'altro', name: 'Latte', quantity: 1 }];
    let { riordina } = await carica();
    expect(await riordina([TORTA])).toBe(1);
    expect(stato.carrello.map((r) => r.id)).toEqual(['altro', 'p1']);
    stato.carrello = [{ id: 'altro', name: 'Latte', quantity: 1 }];
    stato.esito = 'conferma';
    ({ riordina } = await carica());
    await riordina([TORTA]);
    expect(stato.carrello.map((r) => r.id)).toEqual(['p1']);
  });

  it('290 · 10 € con il 20% ancora attivo, comprato a 8 €: nessun «prezzo cambiato», entra a 8 €', async () => {
    const { riordina } = await carica();
    await riordina([TORTA]);
    expect(stato.successi[0]).not.toContain('cambiat');
    expect(stato.carrello[0].price).toBe(8);
  });

  it('1731 · la variante comprata entra nel carrello', async () => {
    const { riordina } = await carica();
    await riordina([TORTA]);
    expect(stato.carrello[0]).toMatchObject({ variantId: 'v-grande', variantLabel: 'grande' });
  });

  it('165 · un articolo che non si può più riordinare si dice', async () => {
    const { riordina } = await carica();
    await riordina([TORTA, { productId: '', name: '', quantity: 1, prezzoStorico: 3 }]);
    expect(stato.successi[0]).toContain('1 articolo non è più disponibile');
  });
});

describe('165 · 1731 · le due pagine leggono la copia della riga e la variante', () => {
  it('lista e dettaglio chiedono product_name, product_image, variant_id, variant_label', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['app/orders/page.tsx', 'app/orders/[id]/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/product_name, product_image, variant_id, variant_label/);
      expect(src, f).toContain('variantId: it.variant_id');
    }
    const lista = readFileSync('app/orders/page.tsx', 'utf8');
    expect(lista).toContain('fotoDellaRigaOrdine(it)');
    expect(lista).not.toContain("name: it.products?.name ?? ''");
  });
});

describe('289 · la finestra di conferma distingue «Aggiungi» dalla chiusura', () => {
  it('Esc e il tocco fuori chiudono con «chiusa», il pulsante secondario con «alternativa»', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('components/ConfirmDialog.tsx', 'utf8');
    expect(src).toContain("if (e.key === 'Escape') { e.preventDefault(); closeWith('chiusa'); return; }");
    expect(src).toContain("if (e.target === e.currentTarget) closeWith('chiusa');");
    expect(src).toContain("onClick={() => closeWith('alternativa')}");
    expect(src).toContain("return sceltaDialog(opts).then((esito) => esito === 'conferma');");
  });
});

describe('1726 · 630 · 2531 · il ritorno dal pagamento con la carta', () => {
  it('niente «ordine confermato» prima dell ordine; il ramo d errore e il vuoto dopo il pagamento dicono di non ripagare', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/orders/page.tsx', 'utf8');
    expect(src).not.toContain('Il tuo ordine è confermato');
    expect(src).toContain('Pagamento ricevuto: stiamo confermando il tuo ordine.');
    const ramoErrore = src.slice(src.indexOf('if (isError) {'), src.indexOf('if (orders.length === 0 && stripeInCorso)'));
    expect(ramoErrore).toContain('<StripeReturnHandler />');
    expect(ramoErrore).toContain('non pagare di nuovo');
    expect(src).toContain('Il tuo ordine non è ancora comparso');
  });
});
