import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R14-019 — Se il cliente ritira il reso mentre il negozio lo approva con
 * rimborso, il reso restava «annullato» coi soldi già usciti.
 *
 * Il negozio preme «Approva» con l'importo: la rotta prende il turno (il reso
 * passa ad APPROVED), poi il rimborso parte. Da APPROVED il cliente può ancora
 * ritirare la richiesta (`avanza`, CANCELED): se lo fa nei secondi del rimborso,
 * la scrittura finale cercava ancora APPROVED e non toccava niente. Il reso
 * restava «annullato», per tutti un reso chiuso senza rimborso, coi soldi fuori.
 *
 * Qui il finto database tiene la riga del reso con le stesse condizioni delle
 * scritture vere (`.eq('status', …)`), e il ritiro del cliente arriva mentre il
 * rimborso è in volo. Il contratto: soldi usciti una volta, reso «rimborsato».
 */

const db = vi.hoisted(() => ({
  reso: {} as Record<string, unknown>,
  rimborsi: 0,
  ritiroDuranteIlRimborso: true,
  rimborsoFallisce: false,
  avvisiAdmin: [] as string[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'seller-1' }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/app/api/returns/chi-comanda-il-reso', () => ({
  chiComandaIlReso: async () => ({ autorizzato: true }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: vi.fn(async (titolo: string) => { db.avvisiAdmin.push(titolo); }),
}));
vi.mock('@/lib/ordini/campanella', () => ({ scriviCampanella: vi.fn(async () => {}) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

/** Il ritiro del cliente come lo scrive `avanza`: da REQUESTED o APPROVED a CANCELED. */
function ilClienteRitira() {
  if (['REQUESTED', 'APPROVED'].includes(String(db.reso.status))) {
    db.reso = { ...db.reso, status: 'CANCELED', decision_notes: 'Non mi serve più' };
  }
}

vi.mock('@/lib/stripe/payout', () => {
  class AccreditoGiaUscitoConAltroImporto extends Error {}
  class RimborsoInAttesaDellaDivisione extends Error {}
  return {
    AccreditoGiaUscitoConAltroImporto,
    RimborsoInAttesaDellaDivisione,
    refundOrder: vi.fn(async () => {
      // Il cliente ritira la richiesta mentre il rimborso è in volo.
      if (db.ritiroDuranteIlRimborso) ilClienteRitira();
      await new Promise((r) => setTimeout(r, 1));
      if (db.rimborsoFallisce) throw new Error('stripe giù');
      db.rimborsi++;
      return { refundId: 're_1', bonificoCents: 0 };
    }),
  };
});

/** Una scrittura sulla riga del reso: tocca la riga solo se tutti i filtri tornano. */
function scritturaSulReso(valori: Record<string, unknown>) {
  const filtri: Record<string, unknown> = {};
  const passo = {
    eq(colonna: string, valore: unknown) { filtri[colonna] = valore; return passo; },
    select: async () => {
      const tocca = Object.entries(filtri).every(([c, v]) => (c === 'id' ? v === db.reso.id : db.reso[c] === v));
      if (tocca) db.reso = { ...db.reso, ...valori };
      return { data: tocca ? [{ id: db.reso.id }] : [], error: null };
    },
    then(ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) {
      return passo.select().then(ok, ko);
    },
  };
  return passo;
}

const ORDINE = {
  stripe_payment_intent: 'pi_1', payment_method: 'card', gross_total_cents: 3000, total_price: 30,
  refunded_amount_cents: 0, wallet_applied_cents: 0, cash_confirmed_at: null, payment_status: 'PAID',
  delivery_status: 'DELIVERED', discount_amount: 0,
};

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { ...db.reso }, error: null }) }) }) }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'returns') return { update: (v: Record<string, unknown>) => scritturaSulReso(v) };
      if (tabella === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: ORDINE, error: null }) }) }) };
      }
      return { insert: async () => ({ error: null }) };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'cliente@example.it' } } }) } },
  }),
}));

import { POST } from '@/app/api/returns/[id]/decide/route';

function approvaConRimborso(cents: number) {
  const req = new Request('http://localhost/api/returns/r1/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'APPROVED', refundAmountCents: cents, notes: 'Arrivato rotto' }),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

beforeEach(() => {
  db.reso = {
    id: 'r1', status: 'REQUESTED', seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1',
    reason: 'DAMAGED', refund_amount_cents: null, created_at: '2026-11-10T10:00:00Z', order_item_id: null,
  };
  db.rimborsi = 0;
  db.ritiroDuranteIlRimborso = true;
  db.rimborsoFallisce = false;
  db.avvisiAdmin.length = 0;
});

describe('R14-019 — il ritiro del cliente durante il rimborso', () => {
  it('i soldi escono una volta e il reso dice «rimborsato», non «annullato»', async () => {
    const res = await approvaConRimborso(1500);

    expect(db.rimborsi, 'il rimborso deve partire una volta sola').toBe(1);
    expect(db.reso.status, 'il reso resta annullato coi soldi già usciti').toBe('REFUNDED');
    expect(db.reso.refund_id).toBe('re_1');
    expect(db.reso.refund_amount_cents).toBe(1500);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'REFUNDED', refundId: 're_1' });
  });

  it('se il rimborso non parte, il ritiro del cliente resta com è: niente rimborso, niente «rimborsato»', async () => {
    db.rimborsoFallisce = true;
    const res = await approvaConRimborso(1500);

    expect(db.rimborsi).toBe(0);
    expect(db.reso.status).toBe('CANCELED');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('senza ritiro tutto come prima: approvato e rimborsato', async () => {
    db.ritiroDuranteIlRimborso = false;
    const res = await approvaConRimborso(1500);

    expect(res.status).toBe(200);
    expect(db.rimborsi).toBe(1);
    expect(db.reso.status).toBe('REFUNDED');
    expect(db.avvisiAdmin).toHaveLength(0);
  });

  it('un reso ritirato PRIMA della decisione non si rimborsa', async () => {
    ilClienteRitira();
    const res = await approvaConRimborso(1500);

    expect(res.status).toBe(409);
    expect(db.rimborsi).toBe(0);
    expect(db.reso.status).toBe('CANCELED');
  });
});
