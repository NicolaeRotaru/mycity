import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — L'ORDINE CHE RIMBALZAVA FRA ANNULLATO E NUOVO, PER SEMPRE.
 *
 * Il giro delle mezz'ore annulla gli ordini che il negozio non ha mai
 * accettato e, se erano pagati con carta, chiede il rimborso. Se il rimborso
 * lanciava un errore l'ordine tornava «nuovo» per ritentare al giro dopo —
 * sempre, senza guardare che errore fosse.
 *
 * Ma quando sull'ordine non c'e' piu' niente da rimborsare (un reso lo aveva
 * gia' chiuso, oppure il credito MyCity copriva tutto) il rimborso fallira'
 * allo stesso modo ogni volta: annullato, resuscitato, riannullato mezz'ora
 * dopo, all'infinito. Il negozio se lo vedeva in lista come da accettare e
 * nessun avviso lo diceva.
 *
 * Le due prove qui sotto tengono insieme i due lati della stessa regola:
 *  - errore senza ritorno (marchio `ritentabile: false`) → l'ordine resta
 *    annullato e gli amministratori ricevono un avviso;
 *  - errore passeggero (Stripe non risponde) → l'ordine torna in coda, come
 *    prima.
 *
 * Togliendo il controllo dal cron, la prima diventa rossa.
 */

const state: {
  candidates: Record<string, unknown>[];
  claimed: Array<{ id: string }>;
  updates: Record<string, unknown>[];
  /** Ogni riga finita in `notifications`, cliente e amministratori insieme. */
  notifiche: Record<string, unknown>[];
} = { candidates: [], claimed: [{ id: 'o1' }], updates: [], notifiche: [] };

const refundOrderMock = vi.fn(async (_opts: unknown) => ({ refundId: 're_1', reversedCents: 0 }));

/** L'errore come lo marchia `RimborsoNonRitentabile` in lib/stripe/payout.ts. */
function erroreSenzaRitorno(messaggio: string): Error {
  const e = new Error(messaggio);
  (e as unknown as { ritentabile: boolean }).ritentabile = false;
  return e;
}

function qb(result: unknown) {
  const chain = () => builder;
  const builder: Record<string, unknown> = {
    select: chain,
    eq: chain,
    lt: chain,
    limit: chain,
    update: chain,
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (arg: unknown) => refundOrderMock(arg) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => qb({ data: state.candidates, error: null }),
          update: (valori: Record<string, unknown>) => {
            state.updates.push(valori);
            return qb({ data: state.claimed, error: null });
          },
        };
      }
      if (table === 'notifications') {
        return {
          insert: async (righe: Record<string, unknown> | Record<string, unknown>[]) => {
            state.notifiche.push(...(Array.isArray(righe) ? righe : [righe]));
            return { error: null };
          },
        };
      }
      // Gli amministratori che ricevono l'avviso.
      if (table === 'profiles') return { select: () => qb({ data: [{ id: 'admin1' }], error: null }) };
      return { select: () => qb({ data: [], error: null }) };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

async function giro() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST' }),
  );
}

const ordineCartaPagato = {
  id: 'o1',
  user_id: 'u1',
  payment_method: 'card',
  payment_status: 'PAID',
  stripe_payment_intent: 'pi_1',
  total_price: 50,
  wallet_applied_cents: 0,
};

beforeEach(() => {
  state.candidates = [{ ...ordineCartaPagato }];
  state.claimed = [{ id: 'o1' }];
  state.updates.length = 0;
  state.notifiche.length = 0;
  refundOrderMock.mockReset();
  refundOrderMock.mockResolvedValue({ refundId: 're_1', reversedCents: 0 });
});

describe('un ordine che non si puo\' rimborsare non torna in coda', () => {
  it('resta annullato e avvisa gli amministratori, invece di rimbalzare ogni mezz\'ora', async () => {
    refundOrderMock.mockRejectedValueOnce(
      erroreSenzaRitorno('refundOrder: importo rimborso non valido'),
    );

    const res = await giro();
    expect(await res.json()).toMatchObject({ ok: true, refunded: 0, daChiudereAMano: 1 });

    // Il punto della prova: nessun ritorno a «nuovo».
    const rimesso = state.updates.find((u) => u.delivery_status === 'NEW');
    expect(rimesso).toBeUndefined();

    // E qualcuno lo viene a sapere: prima finiva solo in un contatore.
    const avviso = state.notifiche.find((n) => n.user_id === 'admin1');
    expect(avviso).toBeDefined();
    expect(String(avviso!.title)).toContain('a mano');
  });

  it('con un errore passeggero l\'ordine torna in coda, come prima', async () => {
    refundOrderMock.mockRejectedValueOnce(new Error('Stripe non risponde'));

    const res = await giro();
    expect(await res.json()).toMatchObject({ ok: true, failed: 1, daChiudereAMano: 0 });

    const rimesso = state.updates.find(
      (u) => u.delivery_status === 'NEW' && u.canceled_at === null,
    );
    expect(rimesso).toBeTruthy();
    expect(state.notifiche.find((n) => n.user_id === 'admin1')).toBeUndefined();
  });
});
