// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { computeOrderSplit } from '@/lib/stripe/client';
import { formatPrice } from '@/lib/format';
import { disegna } from './aiuti/cabina-admin';

/**
 * R17-001 (completamento) — Due punti lasciati dal revisore sulla pagina Guadagni.
 *
 * ② Con la carta spenta (CARTA_ACCESA = false) i soldi arrivano col bonifico sull'IBAN ogni lunedì,
 *    ma il riquadro «Bonifici» mostrava ancora il pulsante di Stripe Connect («Collega conto per
 *    ricevere pagamenti»): mandava il negozio a collegare un conto che al lancio non serve.
 * ③ Sotto la commissione c'era «Già tolta: a te X netti»: pareva che lordo meno commissione desse il
 *    netto, ma il lordo comprende la consegna. Su 23 € pagati (3 € di consegna) il negozio leggeva
 *    23,00 − 2,00 e «a te 18,00 netti», e 3 € sparivano. Adesso la consegna si dice, e i numeri tornano.
 *
 * Gli ordini sono costruiti come li scrive la cassa dei contanti (`computeOrderSplit`).
 */

const split = computeOrderSplit({ totalCents: 2300, deliveryFeeCents: 300, shippingCents: 0 });

const contanti = (id: string, payout_status: string, created_at: string) => ({
  id,
  created_at,
  delivery_status: 'DELIVERED',
  payment_method: 'cod',
  payment_status: 'PAID',
  payout_status,
  payout_at: payout_status === 'PAID_MANUALLY' ? '2026-11-16T09:00:00.000Z' : null,
  total_price: 23,
  seller_payout_cents: split.sellerPayoutCents,
  seller_payout_reversed_cents: 0,
  refunded_amount_cents: 0,
  application_fee_cents: split.applicationFeeCents,
  stripe_transfer_id: null,
  stripe_reversal_id: null,
  pickup_in_store: false,
  wallet_applied_cents: 0,
});

const ordini = [
  contanti('aaaa1111-pagato', 'PAID_MANUALLY', '2026-11-12T10:00:00.000Z'),
  contanti('bbbb2222-da-versare', 'HELD', '2026-11-16T10:00:00.000Z'),
];

const stato = vi.hoisted(() => ({ righe: [] as unknown[], carta: false }));
function catena(tabella: string): unknown {
  const risposta = () => ({ data: tabella === 'orders' ? stato.righe : { billing_iban: 'IT60X0542811101000000123456' }, error: null });
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => catena(t),
    auth: { getUser: async () => ({ data: { user: { id: 'pane-quotidiano' } } }), getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = await originale<Record<string, unknown>>();
  return {
    ...vero,
    get CARTA_ACCESA() {
      return stato.carta;
    },
  };
});
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// Il pulsante vero chiede lo stato del conto a Stripe: qui basta la sua scritta.
vi.mock('@/components/seller/StripeConnectButton', () => ({
  default: () => createElement('button', { type: 'button' }, 'Collega conto per ricevere pagamenti'),
}));
vi.mock('@/components/seller/StripeDashboardButton', () => ({ default: () => null }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
  stato.carta = false;
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
});

async function apriLaPagina(): Promise<string> {
  stato.righe = ordini;
  const mod = (await import('@/app/seller/earnings/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host.textContent ?? '';
}

describe('R17-001 (completamento) — la pagina Guadagni con la carta spenta', () => {
  it('② niente pulsante di Stripe Connect: i soldi arrivano col bonifico del lunedì sull IBAN', async () => {
    const testo = await apriLaPagina();
    expect(testo).toContain('in attesa del bonifico del lunedì');
    expect(testo, 'con la carta spenta il negozio era mandato a collegare un conto Stripe').not.toContain('Collega conto per ricevere pagamenti');
  });

  it('② con la carta accesa il pulsante torna', async () => {
    stato.carta = true;
    expect(await apriLaPagina()).toContain('Collega conto per ricevere pagamenti');
  });

  it('③ lordo, commissione, consegna e netto tornano: la consegna non sparisce fra lordo e netto', async () => {
    const testo = await apriLaPagina();
    const lordo = 2 * 2300;
    const commissione = 2 * split.applicationFeeCents;
    const netto = 2 * split.sellerPayoutCents;
    const consegna = lordo - commissione - netto;
    expect(consegna, 'la differenza è la consegna dei due ordini').toBe(2 * 300);
    expect(testo).toContain(formatPrice(lordo / 100));
    expect(testo).toContain(`− ${formatPrice(commissione / 100)}`);
    expect(testo, 'la frase sotto la commissione faceva pensare lordo − commissione = netto').toContain(
      `Il lordo comprende anche ${formatPrice(consegna / 100)} di consegna`,
    );
    expect(testo).toContain(`a te ${formatPrice(netto / 100)} netti`);
  });
});
