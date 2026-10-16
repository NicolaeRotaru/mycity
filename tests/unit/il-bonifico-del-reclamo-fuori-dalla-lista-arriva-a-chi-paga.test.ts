import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * Riesame del 16/10, terzo giro — IL BONIFICO DEL RECLAMO USCIVA DALLA LISTA E LO SAPEVA SOLO IL REGISTRO.
 *
 * Chiuso un reclamo a favore della cliente su un ordine in contanti, il bonifico si scrive in
 * `bonifici_dei_reclami`, ed e' li' che la lista dei bonifici da fare lo trova. Il caso:
 *  1. ordine in contanti da 24 €, incassato;
 *  2. Nicola chiude il reclamo a favore della cliente con 24 €;
 *  3. `refundOrder` segna l'ordine «rimborsato» e manda l'avviso «Bonifico di rimborso da fare»;
 *  4. la riga in `bonifici_dei_reclami` va in timeout;
 *  5. la rotta lo scriveva solo nel registro e rispondeva «ok»: Nicola apre la lista, il bonifico
 *     non c'e', l'ordine dice gia' «rimborsato», e nessun messaggio dice che manca.
 *
 * Girano la rotta VERA dei reclami e la `refundOrder` VERA; il guasto e' uno solo, sull'inserimento.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, guasto: false }));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const c = finto.db.client;
    return {
      ...c,
      from: (tabella: string) => {
        const q = c.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
        if (tabella !== 'bonifici_dei_reclami' || !finto.guasto) return q;
        q.insert = () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
        return q;
      },
    };
  };
  return { getAdminSupabase: () => client() };
});
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
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'nicola' }, req, params: (await ctx?.params) ?? {} }),
}));

import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';

const ORDINE = '77777777-7777-4777-8777-777777777777';

function ordineInContanti(): Riga {
  return {
    id: ORDINE, user_id: 'cliente', seller_id: 'negozio',
    total_price: 24, gross_total_cents: 2400, wallet_applied_cents: 0,
    seller_payout_cents: 2160, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    internal_dispute_status: 'OPEN',
  };
}

beforeEach(() => {
  finto.guasto = false;
  finto.db = creaFintoDatabase({
    orders: [ordineInContanti()],
    disputes: [{ id: 'd1', status: 'open', order_id: ORDINE, opener_id: 'cliente', against_id: 'negozio' }],
    bonifici_dei_reclami: [],
    profiles: [{ id: 'nicola', role: 'admin' }],
    notifications: [],
  });
});

function chiudi() {
  return risolvi(
    new Request('http://localhost/api/admin/disputes/d1/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved_buyer', notes: 'Merce rovinata: rimborsiamo i contanti.', refundCents: 2400 }),
    }) as never,
    { params: Promise.resolve({ id: 'd1' }) } as never,
  );
}

describe('il bonifico di un reclamo che non entra nella lista lo sa chi paga', () => {
  it('IL CASO CHE ROMPEVA — la riga del bonifico va in timeout: chi paga riceve l avviso con cifra e ordine', async () => {
    finto.guasto = true;
    await chiudi();

    expect(finto.db.tabelle.orders[0].refunded_amount_cents, 'il rimborso non e partito: la prova non misura niente').toBe(2400);
    expect(finto.db.tabelle.bonifici_dei_reclami, 'il guasto non e avvenuto: la prova non misura niente').toHaveLength(0);

    const avvisi = notificheConTitolo(finto.db, 'fuori dalla lista');
    expect(avvisi, 'il bonifico non e nella lista e lo sa solo il registro degli errori').toHaveLength(1);
    const testo = String(avvisi[0].body);
    expect(testo).toMatch(/24,00\s€/u);
    expect(testo).toContain('#77777777');
    expect(testo).toContain('d1');
  });

  it('senza guasto la riga c e e nessun avviso di guasto', async () => {
    await chiudi();
    expect(finto.db.tabelle.bonifici_dei_reclami).toHaveLength(1);
    expect(notificheConTitolo(finto.db, 'fuori dalla lista')).toHaveLength(0);
  });

  it('senza la migrazione 162 (tabella che manca) nessun avviso in piu: la pagina lo dice gia', async () => {
    finto.db = creaFintoDatabase(
      {
        orders: [ordineInContanti()],
        disputes: [{ id: 'd1', status: 'open', order_id: ORDINE, opener_id: 'cliente', against_id: 'negozio' }],
        profiles: [{ id: 'nicola', role: 'admin' }],
        notifications: [],
      },
      { tabelleMancanti: ['bonifici_dei_reclami'] },
    );
    await chiudi();
    expect(notificheConTitolo(finto.db, 'fuori dalla lista')).toHaveLength(0);
  });
});
