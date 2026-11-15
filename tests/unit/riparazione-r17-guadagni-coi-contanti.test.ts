// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { riepilogoNegozio, type OrdineNegozio } from '@/lib/guadagni/negozio';
import { computeOrderSplit } from '@/lib/stripe/client';
import { formatPrice } from '@/lib/format';
import { disegna } from './aiuti/cabina-admin';

/**
 * R17-001 — LA PAGINA GUADAGNI, CON I SOLI CONTANTI, DICEVA COMMISSIONE ZERO E SOLDI MAI VERSATI.
 *
 * Al lancio si paga solo in contanti (CARTA_ACCESA = false). Il riepilogo contava lordo e
 * commissione solo sugli ordini con carta: la torre diceva «Commissione − 0,00 €» e «0 ordini»,
 * il grafico restava piatto, lo storico diceva «Ancora nessun ordine pagato con carta». Ogni
 * contrassegno invece nasce con la commissione scritta dalla cassa (app/api/orders/cod/route.ts,
 * `computeOrderSplit`), e il bonifico del lunedì versa solo il netto (`seller_payout_cents`, la
 * somma che controlla `segna_bonifico_manuale` della migrazione 410).
 *
 * Qui gli ordini sono costruiti come li scrive la cassa: 23 € pagati, 3 € di consegna.
 */

// La cassa dei contanti: commissione e netto nascono da qui (app/api/orders/cod/route.ts).
const split = computeOrderSplit({ totalCents: 2300, deliveryFeeCents: 300, shippingCents: 0 });

type Riga = OrdineNegozio & {
  id: string;
  created_at: string;
  delivery_status: string;
  payment_status: string | null;
  payout_at: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
};

const contanti = (id: string, payout_status: string, extra: Partial<Riga> = {}): Riga => ({
  id,
  created_at: '2026-11-12T10:00:00.000Z',
  delivery_status: 'DELIVERED',
  payment_method: 'cod',
  payment_status: 'PAID',
  payout_status,
  payout_at: null,
  total_price: 23,
  seller_payout_cents: split.sellerPayoutCents,
  seller_payout_reversed_cents: 0,
  refunded_amount_cents: 0,
  application_fee_cents: split.applicationFeeCents,
  stripe_transfer_id: null,
  stripe_reversal_id: null,
  pickup_in_store: false,
  wallet_applied_cents: 0,
  ...extra,
});

// Un negozio al lancio: due ordini già pagati a mano il lunedì, uno con la rimessa confermata
// (da versare il prossimo lunedì), uno consegnato coi soldi ancora in mano al fattorino, e uno
// non ancora consegnato.
const ordini: Riga[] = [
  contanti('aaaa1111-pagato-1', 'PAID_MANUALLY', { created_at: '2026-11-12T10:00:00.000Z', payout_at: '2026-11-16T09:00:00.000Z' }),
  contanti('bbbb2222-pagato-2', 'PAID_MANUALLY', { created_at: '2026-11-13T10:00:00.000Z', payout_at: '2026-11-16T09:00:00.000Z' }),
  contanti('cccc3333-da-versare', 'HELD', { created_at: '2026-11-16T10:00:00.000Z' }),
  contanti('dddd4444-dal-fattorino', 'AWAITING_REMITTANCE', { created_at: '2026-11-17T10:00:00.000Z' }),
  contanti('eeee5555-in-viaggio', 'AWAITING_REMITTANCE', { created_at: '2026-11-17T11:00:00.000Z', delivery_status: 'IN_DELIVERY', payment_status: 'PENDING' }),
];
const consegnati = ordini.filter((o) => o.delivery_status === 'DELIVERED');

describe('R17-001 — il riepilogo del negozio coi soli contanti', () => {
  it('la commissione è quella scritta dalla cassa su ogni contrassegno consegnato, non zero', () => {
    const r = riepilogoNegozio(ordini);
    const delServer = consegnati.reduce((s, o) => s + (o.application_fee_cents ?? 0), 0);
    expect(split.applicationFeeCents).toBeGreaterThan(0);
    expect(r.commissioniCents, 'con i soli contanti la torre diceva «Commissione − 0,00 €»').toBe(delServer);
    expect(r.commissioniCents).toBe(4 * split.applicationFeeCents);
  });

  it('il lordo e il netto contano i contanti consegnati, per metodo', () => {
    const r = riepilogoNegozio(ordini);
    expect(r.lordoCents, 'fatturato lordo 0,00 € con 4 consegne in contanti').toBe(4 * 2300);
    expect(r.nettoCents).toBe(4 * split.sellerPayoutCents);
    expect(r.ordiniContanti).toBe(4);
    expect(r.ordiniCarta).toBe(0);
    expect(r.contati.map((o) => o.id)).not.toContain('eeee5555-in-viaggio');
  });

  it('«versato» solo i bonifici fatti (a mano o da Stripe), «in attesa» gli altri consegnati', () => {
    const r = riepilogoNegozio(ordini);
    expect(r.versatiCents).toBe(2 * split.sellerPayoutCents);
    // HELD (rimessa confermata) e AWAITING_REMITTANCE consegnato: soldi del negozio non ancora versati.
    expect(r.inArrivoCents, 'i contanti in mano al fattorino non comparivano da nessuna parte').toBe(2 * split.sellerPayoutCents);
    expect(r.versatiCents + r.inArrivoCents).toBe(r.nettoCents);
  });

  it('nei contanti il credito MyCity speso torna nel lordo, come nel cruscotto', () => {
    const conCredito = contanti('ffff6666-credito', 'HELD', { total_price: 18, wallet_applied_cents: 500 });
    expect(riepilogoNegozio([conCredito]).lordoCents).toBe(2300);
  });

  it('un contrassegno rimborsato, o non ancora consegnato, non entra nel fatturato', () => {
    const r = riepilogoNegozio([
      contanti('g-rimborsato', 'REFUNDED'),
      contanti('h-in-viaggio', 'AWAITING_REMITTANCE', { delivery_status: 'IN_DELIVERY' }),
    ]);
    expect(r.lordoCents + r.commissioniCents + r.inArrivoCents + r.ordiniContanti).toBe(0);
  });

  it('il ritiro pagato al banco resta nel suo riquadro: quella commissione la deve il negozio', () => {
    const r = riepilogoNegozio([contanti('i-banco', 'CASH_IN_STORE', { pickup_in_store: true })]);
    expect(r.commissioniCents).toBe(0);
    expect(r.versatiCents + r.inArrivoCents).toBe(0);
  });
});

// ── La pagina vera, coi finti ──────────────────────────────────────────────────────────────
const stato = vi.hoisted(() => ({ righe: [] as unknown[] }));
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
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/seller/StripeConnectButton', () => ({ default: () => null }));
vi.mock('@/components/seller/StripeDashboardButton', () => ({ default: () => null }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  // Solo l'orologio: i tempi di React Query restano veri.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
});

async function apriLaPagina(): Promise<HTMLElement> {
  stato.righe = ordini;
  const mod = (await import('@/app/seller/earnings/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R17-001 — la pagina Guadagni coi soli contanti', () => {
  it('la torre dice la commissione vera, il netto e con che cosa si è incassato', async () => {
    const testo = (await apriLaPagina()).textContent ?? '';
    const commissione = (4 * split.applicationFeeCents) / 100;
    expect(testo, 'la torre diceva «Commissione MyCity − 0,00 €»').toContain(`− ${formatPrice(commissione)}`);
    expect(testo).toContain(`a te ${formatPrice((4 * split.sellerPayoutCents) / 100)} netti`);
    expect(testo).toContain('4 ordini · 4 in contanti, 0 con carta');
  });

  it('i bonifici dicono cosa è già versato e cosa aspetta il lunedì', async () => {
    const testo = (await apriLaPagina()).textContent ?? '';
    const due = formatPrice((2 * split.sellerPayoutCents) / 100);
    expect(testo, 'dopo il bonifico a mano il negozio leggeva ancora «0,00 € già versati»').toContain(`${due} già versati`);
    expect(testo).toContain(`${due} in attesa del bonifico del lunedì`);
    expect(testo, 'i contanti non passano da Stripe: niente rimando al conto Stripe').not.toMatch(/apri il tuo conto Stripe/);
  });

  it('lo storico elenca i contanti consegnati col loro stato', async () => {
    const testo = (await apriLaPagina()).textContent ?? '';
    expect(testo, 'lo storico diceva «Ancora nessun ordine pagato con carta»').not.toMatch(/Ancora nessun ordine pagato/);
    for (const o of consegnati) expect(testo).toContain(`#${o.id.slice(0, 8)}`);
    expect(testo, 'un ordine non ancora consegnato non è un pagamento').not.toContain('#eeee5555');
    expect(testo).toContain('Pagato 16 nov');
    expect(testo).toContain('In liquidazione');
    expect(testo).toContain('Attesa cassa fattorino');
    expect(testo).toContain('Contanti');
  });

  it('il grafico dei sette giorni non resta piatto', async () => {
    const host = await apriLaPagina();
    const barre = [...host.querySelectorAll('[title][style*="height"]')].map((b) => b.getAttribute('title'));
    expect(barre).toHaveLength(7);
    expect(barre.filter((t) => t !== formatPrice(0)), 'con i soli contanti tutte le barre erano a zero').toHaveLength(4);
  });
});
