import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 20/11/2026 (R04-008) — OGNI TAPPA DEL RESO CANCELLAVA LA NOTA DEL NEGOZIO, ANCHE QUELLA DEL CLIENTE.
 *
 * La rotta `avanza` scriveva `decision_notes: body.note ?? null` a ogni tappa. Il negozio approva
 * con la nota «Rimandalo nella scatola originale»; il cliente ritira la richiesta (la pagina manda
 * solo `{ stato: 'CANCELED' }`) e la nota del negozio diventava vuota. Lo stesso per una tappa del
 * negozio senza nota («merce ricevuta» col campo vuoto).
 *
 * Adesso la nota si scrive solo quando la tappa la fa il negozio (o chi amministra) e porta una nota.
 */

const FORNAIO = 'fornaio-venditore';
const ANNA = 'anna-cliente';
const NOTA = 'Rimandalo nella scatola originale';

const stato = vi.hoisted(() => ({
  chiamante: '',
  reso: {} as Record<string, unknown>,
  scritture: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: stato.chiamante }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/ordini/campanella', () => ({ scriviCampanella: vi.fn(async () => undefined) }));

vi.mock('@/lib/supabase/server', () => {
  const tavolo = (tabella: string) => {
    let aggiorna = false;
    const b: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'is', 'neq', 'order', 'limit', 'not']) b[m] = () => b;
    b.select = () => b;
    b.update = (patch: Record<string, unknown>) => {
      if (tabella === 'returns') stato.scritture.push(patch);
      aggiorna = true;
      return b;
    };
    const riga = () => {
      if (tabella === 'returns') return { data: stato.reso, error: null };
      if (tabella === 'orders') {
        return {
          data: { seller_id: FORNAIO, user_id: ANNA, payment_method: 'card', stripe_payment_intent: null, gross_total_cents: 4200, refunded_amount_cents: 0, payment_status: 'PAID', delivery_status: 'DELIVERED' },
          error: null,
        };
      }
      if (tabella === 'profiles') return { data: { role: 'buyer' }, error: null };
      return { data: null, error: null };
    };
    b.single = async () => riga();
    b.maybeSingle = async () => riga();
    b.insert = async () => ({ error: null });
    b.then = (ok: (v: unknown) => unknown) => ok(aggiorna ? { data: [{ id: 'r1' }], error: null } : { data: [], error: null });
    return b;
  };
  return {
    getServerSupabase: async () => ({ from: tavolo }),
    getAdminSupabase: () => ({ from: tavolo, rpc: async () => ({ data: null, error: null }) }),
  };
});

import { POST as AVANZA } from '@/app/api/returns/[id]/avanza/route';

function avanza(corpo: unknown) {
  const req = new Request('http://localhost/api/returns/r1/avanza', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return AVANZA(req as never, { params: Promise.resolve({ id: 'r1' }) } as never) as Promise<Response>;
}

const presa = () => stato.scritture[0] ?? {};

beforeEach(() => {
  stato.scritture.length = 0;
  stato.reso = {
    id: 'r1', status: 'APPROVED', seller_id: FORNAIO, buyer_id: ANNA, order_id: 'o1', reason: 'DAMAGED',
    refund_amount_cents: 4200, created_at: '2026-11-10T10:00:00Z', refund_id: null, order_item_id: null, decision_notes: NOTA,
  };
});

describe('R04-008 · la nota del negozio la scrive solo il negozio', () => {
  it('il cliente ritira la richiesta: la tappa non tocca la nota del negozio', async () => {
    stato.chiamante = ANNA;
    const res = await avanza({ stato: 'CANCELED' });
    expect(res.status, 'il ritiro del cliente doveva passare').toBe(200);
    expect(presa().status).toBe('CANCELED');
    expect('decision_notes' in presa(), `il ritiro del cliente cancella la nota del negozio: ${JSON.stringify(presa())}`).toBe(false);
  });

  it('il cliente ritira con una nota sua: non diventa la nota del negozio', async () => {
    stato.chiamante = ANNA;
    const res = await avanza({ stato: 'CANCELED', note: 'ho cambiato idea' });
    expect(res.status).toBe(200);
    expect('decision_notes' in presa(), 'la nota del cliente è finita al posto di quella del negozio').toBe(false);
  });

  it('il negozio segna «merce ricevuta» senza nota: la nota di prima resta', async () => {
    stato.chiamante = FORNAIO;
    const res = await avanza({ stato: 'RECEIVED' });
    expect(res.status).toBe(200);
    expect(presa().status).toBe('RECEIVED');
    expect('decision_notes' in presa(), 'una tappa del negozio senza nota cancella la nota di prima').toBe(false);
  });

  it('il negozio segna «merce ricevuta» con una nota: la nota si aggiorna', async () => {
    stato.chiamante = FORNAIO;
    const res = await avanza({ stato: 'RECEIVED', note: 'Arrivato con la scatola rotta' });
    expect(res.status).toBe(200);
    expect(presa().decision_notes).toBe('Arrivato con la scatola rotta');
  });
});
