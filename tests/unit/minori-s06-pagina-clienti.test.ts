import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { clientiDagliOrdini, ordineMedio, type OrdineDelCliente } from '@/app/seller/customers/clienti';

/**
 * S06 — La pagina Clienti del negozio.
 * 648: annullati, mai pagati e rimborsati non contano.
 * 265: l'ordine medio è il totale diviso gli ordini, e la somma non si chiama «ricavi».
 * 581 · 399: niente «4× di più» inventato, niente offerta che non si può mandare.
 */

const o = (p: Partial<OrdineDelCliente>): OrdineDelCliente => ({
  id: Math.random().toString(36).slice(2), user_id: 'a', created_at: '2026-11-01T10:00:00Z',
  delivery_full_name: 'Maria', total_price: 10, delivery_status: 'DELIVERED', payment_status: 'PAID', ...p,
});

describe('648 — si conta solo quello che è entrato', () => {
  it('annullato, non pagato e rimborsato non gonfiano lo speso', () => {
    const c = clientiDagliOrdini([
      o({ total_price: 25, delivery_status: 'CANCELED', payment_status: 'PAID' }),
      o({ total_price: 25, payment_status: 'PENDING' }),
      o({ total_price: 40, payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1500 }),
      o({ total_price: 10 }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].ordersCount).toBe(2);
    expect(c[0].totalSpent).toBeCloseTo(35);
  });
  it('cinque ordini annullati non fanno un VIP', () => {
    const c = clientiDagliOrdini(Array.from({ length: 5 }, () => o({ delivery_status: 'CANCELED' })));
    expect(c).toHaveLength(0);
  });
});

describe('265 — ordine medio vero', () => {
  it('1 ordine da 100 e 10 da 10 fanno 18,18, non 55', () => {
    const c = clientiDagliOrdini([
      o({ user_id: 'a', total_price: 100 }),
      ...Array.from({ length: 10 }, () => o({ user_id: 'b', total_price: 10 })),
    ]);
    expect(ordineMedio(c)).toBeCloseTo(200 / 11);
  });
  it('il sottotitolo non chiama «ricavi» lo speso dei clienti', () => {
    const src = readFileSync('app/seller/customers/page.tsx', 'utf8');
    expect(src).not.toContain('di ricavi');
  });
});

describe('581 · 399 — niente numeri inventati', () => {
  it('il suggerimento «4× di più» non c\'è più', () => {
    const src = readFileSync('app/seller/customers/page.tsx', 'utf8');
    expect(src).not.toMatch(/4× di più\. Considera/);
    expect(src).not.toContain('<strong>Suggerimento</strong>');
  });
});

describe('399 — la lista «Completa il tuo negozio»', () => {
  it('non promette «3x di più»', () => {
    const src = readFileSync('components/seller/SellerOnboardingChecklist.tsx', 'utf8');
    expect(src).not.toMatch(/3x di più|3× di più/);
  });
});
