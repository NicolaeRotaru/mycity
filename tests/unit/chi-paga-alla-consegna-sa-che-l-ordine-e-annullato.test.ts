import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/10/2026 — CHI PAGA ALLA CONSEGNA NON SAPEVA CHE L'ORDINE ERA SALTATO.
 *
 * Quando un ordine si annulla (il negozio rifiuta, l'amministrazione annulla,
 * il giro notturno lo fa scadere), l'unica email era «Rimborso emesso», e solo
 * per la carta. Per il contrassegno non c'e' niente da rimborsare, quindi niente
 * email: Maria ordina il pane alle 18 in contanti, il negozio rifiuta, e lei
 * resta a casa ad aspettare un fattorino che non arrivera'. Al lancio si paga
 * solo in contanti, quindi e' ogni ordine annullato.
 *
 * Qui si prova il comportamento: dopo l'annullo parte una email di servizio a
 * chi ha ordinato, col motivo e con «non devi pagare niente». E se la posta
 * fallisce, l'annullo resta fatto: la email e' un avviso, non la condizione.
 */

let invio: (m: Record<string, unknown>) => Promise<unknown>;
const spedite: Array<Record<string, unknown>> = [];

vi.mock('@/lib/email/client', () => ({
  sendEmail: (m: Record<string, unknown>) => invio(m),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
const refundOrderMock = vi.fn(async (_a: unknown) => ({ refundId: 're_1', reversedCents: 0 }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: unknown) => refundOrderMock(a) }));

/** Una catena di query qualunque che finisce sempre con lo stesso risultato. */
function catena(risultato: unknown): unknown {
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
      }
      if (typeof k === 'symbol') return undefined;
      return () => c;
    },
  });
  return c;
}

const auth = {
  admin: {
    getUserById: async (id: string) => ({ data: { user: { id, email: 'maria@example.it' } }, error: null }),
  },
};

const stato = { candidati: [] as Array<Record<string, unknown>> };
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'orders') {
        return {
          select: () => catena({ data: stato.candidati, error: null }),
          update: () => catena({ data: [{ id: 'o1' }], error: null }),
        };
      }
      if (t === 'notifications') return { insert: async () => ({ error: null }) };
      return { select: () => catena({ data: [], error: null }) };
    },
    rpc: async () => ({ data: null, error: null }),
    auth,
  }),
}));

const ordineInContanti = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  user_id: 'u1',
  seller_id: 's1',
  total_price: 12,
  payment_method: 'cod',
  payment_status: 'PENDING',
  delivery_status: 'NEW',
  wallet_applied_cents: 0,
  cash_confirmed_at: null,
  coupon_code: null,
  stripe_payment_intent: null,
};

beforeEach(() => {
  spedite.length = 0;
  invio = async (m) => { spedite.push(m); return { ok: true, id: 'm1' }; };
  stato.candidati = [];
  refundOrderMock.mockClear();
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.example';
});

describe('il negozio rifiuta un ordine pagato alla consegna', () => {
  it('Maria riceve una email: ordine annullato, il motivo, e che non deve pagare niente', async () => {
    const { annullaERimborsa } = await import('@/lib/ordini/annulla');
    const admin = {
      from: () => catena({ data: [{ id: ordineInContanti.id }], error: null }),
      rpc: async () => ({ data: null, error: null }),
      auth,
    };
    const esito = await annullaERimborsa(admin as never, ordineInContanti as never, {
      reason: 'Rifiutato dal negozio: pane finito',
    });
    expect(esito.ok).toBe(true);
    expect(spedite, 'nessuna email a chi pagava alla consegna').toHaveLength(1);
    expect(spedite[0].to).toBe('maria@example.it');
    expect(spedite[0].tipo, 'e il suo ordine: deve partire anche senza consenso commerciale').toBe('transazionale');
    expect(String(spedite[0].text)).toMatch(/non devi pagare niente/i);
    expect(String(spedite[0].text)).toContain('pane finito');
    expect(String(spedite[0].text)).toContain('#A1B2C3');
  });

  it('se la posta fallisce, l ordine resta annullato lo stesso', async () => {
    invio = async () => { throw new Error('resend giu'); };
    const { annullaERimborsa } = await import('@/lib/ordini/annulla');
    const admin = {
      from: () => catena({ data: [{ id: ordineInContanti.id }], error: null }),
      rpc: async () => ({ data: null, error: null }),
      auth,
    };
    const esito = await annullaERimborsa(admin as never, ordineInContanti as never, { reason: 'Ordine rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
  });
});

describe('il giro notturno fa scadere un ordine in contanti mai accettato', () => {
  async function giro() {
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
    return res.json();
  }

  it('anche qui parte la email «annullato, non devi pagare niente»', async () => {
    stato.candidati = [{ ...ordineInContanti, id: 'o1', total_price: 20 }];
    const corpo = await giro();
    expect(corpo).toMatchObject({ ok: true, canceled: 1 });
    expect(spedite, 'il cliente in contanti non sa che l ordine e scaduto').toHaveLength(1);
    expect(spedite[0].to).toBe('maria@example.it');
    expect(String(spedite[0].text)).toMatch(/non devi pagare niente/i);
  });

  it('controprova: sulla carta pagata avvisa il rimborso, non una seconda email', async () => {
    stato.candidati = [{
      ...ordineInContanti, id: 'o1', payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', total_price: 50,
    }];
    await giro();
    expect(refundOrderMock).toHaveBeenCalledWith(expect.objectContaining({ notifyBuyer: true }));
    expect(spedite).toHaveLength(0);
  });
});
