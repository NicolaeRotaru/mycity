// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, type Domanda } from './aiuti/cabina-admin';

/**
 * S05 · schede 332 e 360 — il dettaglio ordine dell'amministrazione stampava la
 * fascia così com'era salvata («Domani · …» anche il giorno dopo), le tappe col
 * solo giorno e i codici inglesi del database (cod · PENDING, AWAITING_REMITTANCE).
 */

const ID = '11111111-2222-4333-8444-555555555555';
vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: ID }), useRouter: () => ({ push: () => {} }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const ORDINE = {
  id: ID, user_id: 'u', seller_id: 's', rider_id: null, total_price: 12, shipping_cost: 3,
  discount_amount: 0, coupon_code: null, payment_method: 'cod', payment_status: 'PENDING',
  delivery_status: 'DELIVERED', pickup_in_store: false, delivery_slot: 'Domani · 11:00–13:00',
  created_at: '2026-11-03T10:00:00Z', accepted_at: '2026-11-04T09:05:00Z', ready_at: null,
  picked_up_at: null, delivered_at: '2026-11-04T11:40:00Z', canceled_at: null,
  delivery_full_name: 'Maria', delivery_phone: null, delivery_address: 'Via Roma 1', delivery_city: 'Piacenza',
  delivery_zip: '29121', delivery_notes: null, refunded_amount_cents: 0, payout_status: 'AWAITING_REMITTANCE',
  dispute_status: null, seller: { store_name: 'Forno' }, rider: null, order_items: [],
};

async function apri(): Promise<HTMLElement> {
  fake.rispondi = (q: Domanda) => (q.tabella === 'orders' ? { data: ORDINE, error: null } : { data: [], error: null });
  const mod = (await import('@/app/admin/orders/[id]/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

function riga(host: HTMLElement, etichetta: string): string {
  const dt = [...host.querySelectorAll('dt')].find((d) => d.textContent === etichetta);
  return dt?.nextElementSibling?.textContent ?? '(manca)';
}

describe('dettaglio ordine admin', () => {
  it('la fascia è il giorno vero, non «Domani» riferito al giorno dell’ordine', async () => {
    const host = await apri();
    expect(riga(host, 'Fascia')).toBe('mer 4/11 · 11:00–13:00');
  });

  it('pagamento, bonifico e contestazione in italiano', async () => {
    const host = await apri();
    expect(riga(host, 'Pagamento')).toBe('contanti alla consegna · in attesa');
    expect(riga(host, 'Bonifico al negozio')).toBe('in attesa dei contanti dal fattorino');
    expect(host.textContent).not.toMatch(/PENDING|AWAITING_REMITTANCE/);
  });

  it('le tappe hanno anche l’ora di Piacenza', async () => {
    const host = await apri();
    expect(riga(host, 'Consegnato')).toMatch(/12:40/);
  });
});
