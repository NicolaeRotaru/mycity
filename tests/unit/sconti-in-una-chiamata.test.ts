import { describe, it, expect, vi } from 'vitest';
import { fetchActiveDiscounts, discountedUnitCents } from '@/lib/promotions';

/**
 * #86 — Al momento di pagare si faceva una chiamata al database PER OGNI
 * articolo del carrello. Venti articoli, venti viaggi — in parallelo, ma tutti
 * da aspettare, proprio nel punto in cui la persona ha la carta in mano.
 *
 * Ora è una sola chiamata. E se la funzione nuova non c'è ancora (migrazione
 * 122 non applicata), si torna al giro vecchio invece di far pagare a tutti il
 * prezzo pieno.
 */

function clientFinto(risposte: Record<string, unknown>) {
  const chiamate: Array<{ nome: string; args: unknown }> = [];
  return {
    chiamate,
    rpc: vi.fn(async (nome: string, args: unknown) => {
      chiamate.push({ nome, args });
      const r = risposte[nome];
      if (r instanceof Error) return { data: null, error: { message: r.message } };
      if (typeof r === 'function') return { data: (r as (a: unknown) => unknown)(args), error: null };
      return { data: r ?? null, error: null };
    }),
  };
}

const IDS = ['p1', 'p2', 'p3'];

describe('gli sconti del carrello', () => {
  it('si chiedono in una volta sola', async () => {
    const c = clientFinto({
      product_active_discounts: [
        { product_id: 'p1', discount_percent: 20 },
        { product_id: 'p3', discount_percent: 5 },
      ],
    });
    const mappa = await fetchActiveDiscounts(c as never, IDS);
    expect(c.rpc).toHaveBeenCalledTimes(1);
    expect(c.chiamate[0].nome).toBe('product_active_discounts');
    expect(mappa.get('p1')).toBe(20);
    expect(mappa.get('p2')).toBe(0); // nessuna promozione: zero, non «assente»
    expect(mappa.get('p3')).toBe(5);
  });

  it('non chiede niente per un carrello vuoto', async () => {
    const c = clientFinto({});
    expect((await fetchActiveDiscounts(c as never, [])).size).toBe(0);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('se la funzione nuova non c\'è ancora, ripiega su quella vecchia', async () => {
    const c = clientFinto({
      product_active_discounts: new Error('function does not exist'),
      product_active_discount: (args: unknown) => ((args as { p_product: string }).p_product === 'p2' ? 30 : 0),
    });
    const mappa = await fetchActiveDiscounts(c as never, IDS);
    expect(mappa.get('p2')).toBe(30);
    expect(c.chiamate.filter((x) => x.nome === 'product_active_discount')).toHaveLength(3);
  });

  it('uno sconto fuori scala viene riportato dentro i limiti', async () => {
    const c = clientFinto({
      product_active_discounts: [
        { product_id: 'p1', discount_percent: 900 },
        { product_id: 'p2', discount_percent: -10 },
      ],
    });
    const mappa = await fetchActiveDiscounts(c as never, ['p1', 'p2']);
    expect(mappa.get('p1')).toBe(70);
    expect(mappa.get('p2')).toBe(0);
  });

  it('il prezzo scontato è quello che il cliente vede', () => {
    expect(discountedUnitCents(20, 25)).toBe(1500);
    expect(discountedUnitCents('9.90', 0)).toBe(990);
  });
});
