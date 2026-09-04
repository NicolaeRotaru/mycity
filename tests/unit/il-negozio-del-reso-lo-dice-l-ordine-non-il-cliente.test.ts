import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL NEGOZIO DI UN RESO LO DICE L'ORDINE, NON LA RIGA DEL RESO.
 *
 * 3/9/2026 — UN CLIENTE SI RIMBORSAVA DA SOLO UN ORDINE CONSEGNATO.
 *
 * Le due rotte che muovono un reso decidevano chi comanda cosi':
 *
 *     if (ret.seller_id !== user.id) { ...403... }
 *
 * `returns.seller_id` e' una colonna della riga del reso, e la riga del reso il
 * cliente se la scriveva da solo: la regola di inserimento della migrazione 024
 * chiedeva soltanto «il compratore sei tu», lasciando liberi stato, importo e
 * venditore. Anna metteva se stessa come negozio, lo stato «merce ricevuta» e
 * quarantadue euro di rimborso, poi chiamava la rotta che fa avanzare il reso:
 * la rotta la riconosceva come il negozio e i soldi uscivano. Il fornaio non ha
 * mai visto arrivare una richiesta, e i quattordici giorni del recesso erano
 * passati da un pezzo.
 *
 * Questa prova ESEGUE le due rotte con quella riga di reso avvelenata. Diventa
 * rossa il giorno in cui il ruolo torna a leggersi da un dato del cliente.
 *
 * La gemella nel database e' tests/sql/rls/28-il-reso-lo-apre-il-server-non-il-cliente.test.sql:
 * li' e' la porta che si chiude, qui e' la rotta che non si fida.
 */

const ANNA = 'anna-cliente';
const FORNAIO = 'fornaio-venditore';

const stato: {
  reso: Record<string, unknown>;
  /** Quello che dice l'ORDINE: la fonte vera del venditore. */
  ordine: Record<string, unknown>;
  ruoli: Record<string, string>;
  /** Chi sta chiamando la rotta in questo momento. */
  chiamante: string;
  scritture: Array<Record<string, unknown>>;
  righePrese: Array<{ id: string }>;
} = {
  reso: {},
  ordine: {},
  ruoli: {},
  chiamante: ANNA,
  scritture: [],
  righePrese: [{ id: 'r1' }],
};

const refundOrderMock = vi.fn(async () => ({ refundId: 'rf_1', reversedCents: 0 }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: stato.chiamante }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: () => refundOrderMock() }));

/**
 * Il finto database tiene separate le due fonti: la riga del reso (che il
 * cliente poteva scriversi) e la riga dell'ordine (che no). E' la separazione
 * che rende la prova capace di fallire.
 */
function tavolo(tabella: string) {
  if (tabella === 'returns') {
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: stato.reso, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        const catena: Record<string, unknown> = {
          eq: () => catena,
          select: async () => {
            stato.scritture.push(patch);
            return { data: stato.righePrese, error: null };
          },
          then: (r: (v: unknown) => unknown) => {
            stato.scritture.push(patch);
            return r({ error: null });
          },
        };
        return catena;
      },
    };
  }
  if (tabella === 'orders') {
    return {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: stato.ordine, error: null }),
          maybeSingle: async () => ({ data: stato.ordine, error: null }),
        }),
      }),
    };
  }
  if (tabella === 'profiles') {
    return {
      select: () => ({
        eq: (_c: string, id: string) => ({
          single: async () => ({ data: { role: stato.ruoli[id] ?? 'buyer' }, error: null }),
          maybeSingle: async () => ({ data: { role: stato.ruoli[id] ?? 'buyer' }, error: null }),
        }),
      }),
    };
  }
  return { insert: async () => ({ error: null }) };
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ from: tavolo }),
  getAdminSupabase: () => ({ from: tavolo }),
}));

import { POST as AVANZA } from '@/app/api/returns/[id]/avanza/route';
import { POST as DECIDE } from '@/app/api/returns/[id]/decide/route';

function chiama(rotta: typeof AVANZA, corpo: unknown) {
  const req = new Request('http://localhost/api/returns/r1/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return rotta(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

beforeEach(() => {
  // La riga del reso e' quella che Anna si sarebbe scritta da sola: se stessa
  // come negozio, merce gia' «ricevuta», quarantadue euro di rimborso.
  stato.reso = {
    id: 'r1',
    status: 'RECEIVED',
    seller_id: ANNA,
    buyer_id: ANNA,
    order_id: 'o1',
    reason: 'DAMAGED',
    refund_amount_cents: 4200,
  };
  // L'ordine dice la verita': il negozio e' il fornaio.
  stato.ordine = {
    seller_id: FORNAIO,
    stripe_payment_intent: 'pi_1',
    payment_method: 'card',
    gross_total_cents: 4200,
    total_price: 42,
    refunded_amount_cents: 0,
  };
  stato.ruoli = { [ANNA]: 'buyer', [FORNAIO]: 'seller' };
  stato.chiamante = ANNA;
  stato.scritture = [];
  stato.righePrese = [{ id: 'r1' }];
  refundOrderMock.mockClear();
});

describe('il reso che il cliente si e scritto da solo', () => {
  it('IL CASO CHE FACEVA USCIRE I SOLDI — Anna non si rimborsa da sola, anche se sul reso c e scritto che il negozio e lei', async () => {
    const res = await chiama(AVANZA, { stato: 'REFUNDED', refundAmountCents: 4200 });

    expect(res.status, 'la rotta ha creduto al campo scritto dal cliente').toBe(403);
    expect(refundOrderMock, 'quarantadue euro usciti senza che il fornaio approvasse').not.toHaveBeenCalled();
    expect(stato.scritture, 'il reso non deve nemmeno essere toccato').toHaveLength(0);
  });

  it('Anna non approva nemmeno il proprio reso dalla rotta della decisione', async () => {
    stato.reso = { ...stato.reso, status: 'REQUESTED' };

    const res = await chiama(DECIDE, { decision: 'APPROVED', refundAmountCents: 4200 });

    expect(res.status).toBe(403);
    expect(refundOrderMock).not.toHaveBeenCalled();
    expect(stato.scritture).toHaveLength(0);
  });

  it('nemmeno un terzo estraneo passa, per quanto la riga del reso lo nomini', async () => {
    stato.chiamante = 'estraneo';
    stato.reso = { ...stato.reso, seller_id: 'estraneo' };

    const res = await chiama(AVANZA, { stato: 'REFUNDED', refundAmountCents: 4200 });

    expect(res.status).toBe(403);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });
});

describe('chi comanda davvero passa ancora', () => {
  it('il fornaio dell ordine rimborsa, anche se sul reso c e scritto un altro nome', async () => {
    stato.chiamante = FORNAIO;

    const res = await chiama(AVANZA, { stato: 'REFUNDED', refundAmountCents: 4200 });

    expect(res.status, 'il venditore vero e rimasto fuori dalla sua stessa pratica').toBe(200);
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    expect(stato.scritture.map((s) => s.status)).toContain('REFUNDED');
  });

  it('l amministratore puo intervenire', async () => {
    stato.chiamante = 'capo';
    stato.ruoli = { ...stato.ruoli, capo: 'admin' };

    const res = await chiama(AVANZA, { stato: 'CANCELED' });

    expect(res.status).toBe(200);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });
});

describe('le tappe si salgono una alla volta', () => {
  it('dal fornaio vero, un reso solo richiesto non salta al rimborso', async () => {
    stato.chiamante = FORNAIO;
    stato.reso = { ...stato.reso, status: 'REQUESTED' };

    const res = await chiama(AVANZA, { stato: 'REFUNDED', refundAmountCents: 4200 });

    expect(res.status).toBe(409);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('un reso gia chiuso non si riapre', async () => {
    stato.chiamante = FORNAIO;
    stato.reso = { ...stato.reso, status: 'REFUNDED' };

    const res = await chiama(AVANZA, { stato: 'CANCELED' });

    expect(res.status).toBe(409);
  });
});
