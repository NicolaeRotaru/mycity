import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * Collaudo finale della semplificazione, 17/10/2026 (lente B, «nasce rotto?»).
 *
 * Su un ordine pagato in parte col credito MyCity la parte di credito torna
 * subito, quella in contanti arriva dopo col bonifico. Tre testi lo dicevano
 * male:
 *  · la notifica al cliente dopo «rimborsato» diceva solo «arriva con un
 *    bonifico», e taceva il credito gia' disponibile;
 *  · l'email metteva «Per farlo ci servono l'IBAN» subito dopo la frase sul
 *    credito, e «farlo» sembrava il credito; il titolo era «Rimborso in arrivo»;
 *  · l'avviso «rimborso non registrato» chiamava lo stesso reso in due modi
 *    nella stessa frase (8 caratteri minuscoli, poi 6 maiuscoli nella causale).
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia' }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { refundIssuedTemplate } from '@/lib/email/templates';
import { avvisoDelRimborsoNonRegistrato, causaleDelBonifico, titoloDelResoRimborsato } from '@/lib/rimborsi/bonifici-da-fare';
import { formatPriceFromCents } from '@/lib/format';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** 40 € in tutto: 10 € pagati col credito MyCity, 30 € in contanti al fattorino. */
function misto(id: string): Riga {
  return {
    id, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 1000,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null,
  };
}

beforeEach(() => {
  finto.utente = 'giulia';
  finto.db = creaFintoDatabase({
    orders: [misto(ORDINE)],
    returns: [],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [],
    cod_reconciliations: [],
  });
  finto.db.email.giulia = 'giulia.bianchi@example.it';
});

describe('il reso di un ordine pagato in parte col credito dice il vero', () => {
  it('IL CASO CHE ROMPEVA — dopo «rimborsato» il cliente legge anche il credito già tornato, non solo il bonifico', async () => {
    const aperto = await (apriReso as unknown as Rotta)(
      new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })),
      undefined,
    );
    const id = (await aperto.json()).id as string;
    finto.utente = 'negozio';
    expect((await (decidi as unknown as Rotta)(new Request('http://localhost/x', json({ decision: 'APPROVED' })), { params: Promise.resolve({ id }) })).status).toBe(200);
    for (const stato of ['RECEIVED', 'REFUNDED'] as const) {
      const r = await (avanza as unknown as Rotta)(
        new Request('http://localhost/x', json(stato === 'REFUNDED' ? { stato, refundAmountCents: 4000 } : { stato })),
        { params: Promise.resolve({ id }) },
      );
      expect(r.status).toBe(200);
    }
    // I contanti, 30 € su 40, vanno col bonifico: il resto e' credito.
    expect(String(finto.db.tabelle.orders[0].stripe_refund_id)).toMatch(/^bonifico:3000:/);
    const titoli = (finto.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'giulia').map((n) => String(n.title));
    const chiuso = titoli.find((t) => t.startsWith('✓ Reso chiuso'));
    expect(chiuso, `nessuna notifica di reso chiuso fra: ${titoli.join(' | ')}`).toBeTruthy();
    expect(chiuso).toContain(formatPriceFromCents(1000));
    expect(chiuso).toContain('credito MyCity');
    expect(chiuso).toContain('bonifico');
    expect(titoli, 'il cliente legge «rimborsato» prima che parta il bonifico').not.toContain('✓ Reso rimborsato');
  }, 60000);

  it('il titolo cambia coi soldi: carta o credito «rimborsato», tutto in contanti solo il bonifico, misto tutti e due', () => {
    expect(titoloDelResoRimborsato({ importoCents: 4000, bonificoCents: 0 })).toBe('✓ Reso rimborsato');
    const contanti = titoloDelResoRimborsato({ importoCents: 4000, bonificoCents: 4000 });
    expect(contanti).toContain('bonifico');
    expect(contanti).not.toContain('credito');
    const conCredito = titoloDelResoRimborsato({ importoCents: 4000, bonificoCents: 3000 });
    expect(conCredito).toContain(`${formatPriceFromCents(1000)} sono già tornati come credito MyCity`);
    expect(conCredito).toContain('il resto arriva con un bonifico');
  });

  it("l'email del misto chiede l'IBAN «per il bonifico», e il titolo non dice «in arrivo» per il credito già arrivato", () => {
    const e = refundIssuedTemplate({ orderId: ORDINE, amount: 40, modo: 'misto', creditoEuro: 10, bonificoEuro: 30 });
    expect(e.text).toContain("Per il bonifico ci servono l'IBAN");
    expect(e.text).not.toContain('Per farlo');
    expect(e.html).not.toContain('Rimborso in arrivo');
    expect(e.html).toContain('Rimborso in credito MyCity e con bonifico');
    // Il bonifico da solo resta come prima: la stessa frase vale anche li'.
    const solo = refundIssuedTemplate({ orderId: ORDINE, amount: 40, modo: 'bonifico' });
    expect(solo.text).toContain("Per il bonifico ci servono l'IBAN");
  });

  it("l'avviso del rimborso non registrato chiama il reso come la causale, una volta sola", () => {
    const reso = 'abcdef12-2222-4222-8222-222222222222';
    const a = avvisoDelRimborsoNonRegistrato({ resoId: reso, ordineId: ORDINE, refundId: 'bonifico:3000:x', bonificoCents: 3000 });
    expect(causaleDelBonifico(ORDINE, `return_${reso}`)).toContain('reso ABCDEF');
    expect(a.testo).not.toContain('abcdef12');
    expect(a.testo.match(/reso ABCDEF/g)?.length, 'il reso deve chiamarsi allo stesso modo nella frase e nella causale').toBe(2);
  });
});
