// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';
import { riepilogoNegozio, type OrdineNegozio } from '@/lib/guadagni/negozio';

/**
 * R03 — La pagina Guadagni, con i soli contanti (CARTA_ACCESA = false).
 *
 * Il negozio deve leggere la commissione vera dei contrassegni, il bonifico del
 * lunedì fatto a mano fra i versati (PAID_MANUALLY, migrazione 916) e gli ordini in
 * contanti nello storico col loro stato. E nessun rimando a Stripe finché la carta
 * è spenta: né la dashboard né «Collega conto per ricevere pagamenti», perché i
 * contanti arrivano col bonifico sull'IBAN. Il netto sotto la commissione dice che
 * consegna e spedizione non sono del negozio: 23 − 2 non fa 18.
 */

const stato = vi.hoisted(() => ({ righe: [] as unknown[] }));
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: stato.righe, error: null }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: () => catena(), auth: { getUser: async () => ({ data: { user: { id: 'forno' } } }), getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('@/lib/funzioni-al-lancio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/funzioni-al-lancio')>()),
  CARTA_ACCESA: false,
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/seller/StripeConnectButton', () => ({ default: () => createElement('span', null, 'COLLEGA-STRIPE') }));
vi.mock('@/components/seller/StripeDashboardButton', () => ({ default: () => createElement('span', null, 'DASHBOARD-STRIPE') }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T10:00:00Z')); // lunedì
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
});

/** Un contrassegno da 23 €: 2 € di commissione, 18 € al negozio, 3 € di consegna. */
const contanti = (id: string, payout_status: string, extra: Record<string, unknown> = {}) => ({
  id, total_price: 23, created_at: '2026-11-20T09:00:00Z', delivery_status: 'DELIVERED', payment_method: 'cod',
  payment_status: 'PAID', payout_status, payout_at: null, seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
  refunded_amount_cents: 0, application_fee_cents: 200, stripe_transfer_id: null, stripe_reversal_id: null,
  pickup_in_store: false, wallet_applied_cents: 0, billing_iban: 'IT00X', ...extra,
});

const righe = () => [
  contanti('pagato-1', 'PAID_MANUALLY', { payout_at: '2026-11-23T08:00:00Z' }),
  contanti('rimesso-2', 'HELD'),
  contanti('fattorino-3', 'AWAITING_REMITTANCE'),
  contanti('in-strada-4', 'AWAITING_REMITTANCE', { delivery_status: 'IN_TRANSIT' }),
  contanti('rimborsato-5', 'REFUNDED', { refunded_amount_cents: 2300 }),
];

const testo = (host: HTMLElement) => (host.textContent ?? '').replace(/[  ]/g, ' ');

describe('R03 — Guadagni coi soli contanti: il calcolo', () => {
  it('commissione, lordo e netto contano i contrassegni consegnati; il bonifico a mano è versato', () => {
    const r = riepilogoNegozio(righe() as OrdineNegozio[]);
    expect(r.ordiniContanti, 'consegnati, non rimborsati').toBe(3);
    expect(r.commissioniCents, 'la commissione dei contanti non è zero').toBe(600);
    expect(r.lordoCents).toBe(6900);
    expect(r.nettoCents).toBe(5400);
    expect(r.versatiCents, 'il bonifico del lunedì segnato PAID_MANUALLY è versato').toBe(1800);
    expect(r.inArrivoCents, 'HELD e contanti ancora dal fattorino').toBe(3600);
  });
});

describe('R03 — Guadagni coi soli contanti: la pagina', () => {
  it('mostra commissione vera, versato del lunedì, storico dei contanti e nessun rimando a Stripe', async () => {
    stato.righe = righe();
    const mod = (await import('@/app/seller/earnings/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const t = testo(r.host);

    expect(t, 'la torre diceva «− 0,00 €» con i soli contanti').toMatch(/−\s*6,00\s*€/);
    expect(t).toMatch(/18,00\s*€\s*già versati/);
    expect(t, 'lo storico elenca i contanti col bonifico del lunedì').toMatch(/Pagato 23 nov/);
    expect(t).toContain('#pagato-1');

    expect(t, 'con la carta spenta niente dashboard Stripe').not.toContain('DASHBOARD-STRIPE');
    expect(t).not.toContain('conto Stripe');
    expect(t, 'con la carta spenta i contanti arrivano col bonifico: niente «Collega conto per ricevere pagamenti»').not.toContain('COLLEGA-STRIPE');
    expect(t, '23 € di lordo meno 2 € di commissione non fa 18 €: la consegna non è del negozio').toMatch(
      /a te 54,00\s*€ netti, senza consegna e spedizione/,
    );
  });
});
