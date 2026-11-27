import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL RIFIUTO DEL NEGOZIO, QUANDO L'ORDINE CAMBIA FRA LA LETTURA E LA SCRITTURA.
 *
 * Ordine in contanti da 18 €. La rotta legge l'ordine, poi `annullaERimborsa` scrive solo se lo
 * stato è ancora quello letto; se no risponde GIA_ANNULLATO, che vuol dire «lo stato è cambiato»,
 * non per forza «annullato».
 * · doppio tocco: la prima richiesta annulla, la seconda trova CANCELED → 409 «Ordine già annullato»
 *   (prima: 500 «Rifiuto fallito», un avviso rosso accanto a quello verde);
 * · un collega segna l'ordine pronto mentre il negoziante lo rifiuta → l'ordine è vivo: niente
 *   «già annullato», un 409 che dice di ricaricare.
 * E l'aiuto dei negozi dice il vero sul rifiuto, sul pronto e sui bonifici.
 */

const FAKE_SELLER = { id: 'seller-1' };
type Riga = Record<string, unknown>;

const stato: {
  riga: Riga;
  /** Quello che fa un'altra mano fra la lettura della rotta e la scrittura dell'annullo. */
  nelFrattempo: ((r: Riga) => void) | null;
  notifiche: Riga[];
} = { riga: {}, nelFrattempo: null, notifiche: [] };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: typeof FAKE_SELLER; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: FAKE_SELLER, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1', reversedCents: 0 })) }));

/** Una riga sola di `orders`, con i filtri della scrittura applicati davvero. */
function tabellaOrdini() {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { ...stato.riga }, error: null }) }),
    }),
    update: (valori: Riga) => {
      const filtri: Array<(r: Riga) => boolean> = [];
      const catena = {
        eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return catena; },
        neq: (c: string, v: unknown) => { filtri.push((r) => r[c] !== v); return catena; },
        select: async () => {
          if (stato.nelFrattempo) { stato.nelFrattempo(stato.riga); stato.nelFrattempo = null; }
          if (!filtri.every((f) => f(stato.riga))) return { data: [], error: null };
          Object.assign(stato.riga, valori);
          return { data: [{ id: stato.riga.id }], error: null };
        },
      };
      return catena;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') return tabellaOrdini();
      return {
        insert: async (righe: Riga[]) => { stato.notifiche.push(...righe); return { error: null }; },
        select: () => ({ eq: () => ({ data: [], error: null }), in: async () => ({ data: [], error: null }) }),
      };
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

import { POST } from '@/app/api/seller/orders/[id]/reject/route';
import { TOPICS } from '@/app/seller/help/domande';
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/ritiro-in-negozio';

function ordineInContanti(p: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'buyer-1', seller_id: 'seller-1', total_price: 18, payment_method: 'cod',
    payment_status: 'PENDING', delivery_status: 'ACCEPTED', stripe_payment_intent: null, wallet_applied_cents: 0,
    cash_confirmed_at: null, refunded_amount_cents: 0, coupon_code: null, rider_id: null, ...p,
  };
}

async function rifiuta(): Promise<{ status: number; messaggio?: string }> {
  const req = new Request('http://localhost/api/seller/orders/o1/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: null }),
  });
  const res = (await POST(req as never, { params: Promise.resolve({ id: 'o1' }) })) as Response;
  const corpo = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: corpo.error?.message };
}

beforeEach(() => {
  stato.riga = ordineInContanti();
  stato.nelFrattempo = null;
  stato.notifiche = [];
});

describe('la rotta del rifiuto quando l ordine cambia nel frattempo', () => {
  it('il rifiuto vero: 200, ordine annullato, il cliente avvisato una volta', async () => {
    const r = await rifiuta();
    expect(r.status).toBe(200);
    expect(stato.riga.delivery_status).toBe('CANCELED');
    expect(stato.notifiche.filter((n) => n.user_id === 'buyer-1')).toHaveLength(1);
  });

  it('doppio tocco: la prima richiesta ha già annullato → 409 «Ordine già annullato», non 500', async () => {
    stato.nelFrattempo = (r) => { r.delivery_status = 'CANCELED'; };
    const r = await rifiuta();
    expect(r).toEqual({ status: 409, messaggio: 'Ordine già annullato' });
    expect(stato.notifiche, 'la seconda richiesta non riavvisa il cliente').toEqual([]);
  });

  it('un collega lo segna pronto mentre lo rifiuti → l ordine è vivo: niente «già annullato», si dice di ricaricare', async () => {
    stato.nelFrattempo = (r) => { r.delivery_status = 'READY'; };
    const r = await rifiuta();
    expect(stato.riga.delivery_status).toBe('READY');
    expect(r.status).toBe(409);
    expect(r.messaggio).not.toMatch(/annullato/i);
    expect(r.messaggio).toMatch(/cambiato nel frattempo.*ricarica/i);
    expect(stato.notifiche).toEqual([]);
  });

  it('già annullato quando la rotta lo legge: 409 «Ordine già annullato», come prima', async () => {
    stato.riga = ordineInContanti({ delivery_status: 'CANCELED' });
    expect(await rifiuta()).toEqual({ status: 409, messaggio: 'Ordine già annullato' });
  });
});

describe('l aiuto dei negozi', () => {
  const risposta = (q: RegExp) => TOPICS.flatMap((t) => t.items).find((i) => q.test(i.q))?.a ?? '';

  it('rifiuto: il motivo è facoltativo, e coi contanti non c è niente da restituire', () => {
    const a = risposta(/Posso rifiutare un ordine/);
    expect(a).not.toMatch(/Fornisci sempre un motivo/);
    expect(a).toMatch(/motivo è facoltativo/);
    expect(a).toMatch(/se paga alla consegna non ha pagato niente, quindi non c'è niente da restituire/);
  });

  it('pronto: col ritiro in negozio spento non propone il cliente che passa in negozio', () => {
    const a = risposta(/ordine pronto/);
    expect(a).toContain('"Pronto per il fattorino"');
    expect(/passa in negozio|Pronto per il ritiro/.test(a)).toBe(RITIRO_IN_NEGOZIO_ATTIVO);
  });

  it('bonifici: niente «prossimo importo previsto», che la pagina Guadagni non mostra', () => {
    const a = risposta(/Quando ricevo i soldi/);
    expect(a).not.toMatch(/prossimo importo previsto/);
    expect(a).toMatch(/già stato versato e quanto è in attesa del bonifico/);
  });
});
