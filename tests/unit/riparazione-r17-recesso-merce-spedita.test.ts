import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R17-003 — IL CLIENTE DICE DI AVER RISPEDITO LA MERCE, E IL RECESSO NON SI CHIUDE PIU' SENZA RIMBORSO.
 *
 * Il caso della voce: recesso (CHANGED_MIND) chiesto l'1/11 e approvato il 2/11. Il cliente
 * spedisce il 15/11, nei suoi 14 giorni. Il 17/11 il negozio non ha ancora il pacco e la scheda
 * gli offre «Chiudi senza rimborso»: lo preme, il reso diventa CANCELED, il bonifico al negozio
 * riparte, e il pacco che arriva il 18/11 non riapre niente. «In rientro» lo scriveva solo il
 * negozio: il cliente non aveva modo di dirlo (Cod. Cons. art. 56 c.3: il rimborso si trattiene
 * solo finche' non arrivano i beni o la prova della spedizione).
 *
 * Qui, con l'orologio fermo al 17/11 (giorno 15 dall'approvazione), si chiama la rotta vera e si
 * disegna la scheda vera: senza la dichiarazione il negozio chiude come oggi; il cliente dichiara
 * (giorno e numero) e il reso va in rientro; da li' il negozio non chiude piu' senza rimborso; il
 * negozio non puo' dichiarare al posto del cliente.
 */

const COLONNA = 'customer_shipped_back_on';

const stato = vi.hoisted(() => ({
  utente: { id: 'seller-1' },
  reso: {} as Record<string, unknown>,
  ordine: {} as Record<string, unknown>,
  scritture: [] as Array<Record<string, unknown>>,
  avvisi: [] as Array<Record<string, unknown>>,
  /** Simula il database senza la migrazione 411: PostgREST non trova la colonna del giorno. */
  senza411: false,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: stato.utente, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({
  AccreditoGiaUscitoConAltroImporto: class extends Error {},
  RimborsoInAttesaDellaDivisione: class extends Error {},
  cosaMancaAlBonifico: vi.fn(async () => 'niente'),
  refundOrder: vi.fn(async () => ({ refundId: 'rf_1', reversedCents: 0 })),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { ...stato.reso }, error: null }) }) }) }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'returns') {
        return {
          update: (patch: Record<string, unknown>) => {
            const filtri: Record<string, unknown> = {};
            const scrivi = () => {
              stato.scritture.push(patch);
              if (stato.senza411 && COLONNA in patch) {
                return {
                  data: null,
                  error: { code: 'PGRST204', message: `Could not find the '${COLONNA}' column of 'returns' in the schema cache` },
                };
              }
              // Il turno si prende con la scrittura: passa solo dallo stato letto.
              if (filtri.status !== undefined && filtri.status !== stato.reso.status) return { data: [], error: null };
              Object.assign(stato.reso, patch);
              return { data: [{ id: 'r1' }], error: null };
            };
            const catena: Record<string, unknown> = {
              eq: (colonna: string, valore: unknown) => {
                filtri[colonna] = valore;
                return catena;
              },
              select: async () => scrivi(),
              then: (r: (v: unknown) => unknown) => r({ error: scrivi().error }),
            };
            return catena;
          },
        };
      }
      if (tabella === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { ...stato.ordine }, error: null }) }) }) };
      }
      if (tabella === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { role: stato.utente.id === 'admin-1' ? 'admin' : 'buyer' }, error: null }) }),
          }),
        };
      }
      return {
        insert: async (riga: Record<string, unknown>) => {
          stato.avvisi.push(riga);
          return { error: null };
        },
      };
    },
  }),
}));

import { POST } from '@/app/api/returns/[id]/avanza/route';
import ReturnRequestCard, { type ReturnRow } from '@/components/seller/ReturnRequestCard';
import { percheIlRecessoNonSiChiude } from '@/lib/rimborsi/regole-del-rimborso';

const NEGOZIO = { id: 'seller-1' };
const CLIENTE = { id: 'b1' };
const NOTA_DEL_NEGOZIO = 'Rispedisci a Via Roma 1, Piacenza';

function avanza(chi: { id: string }, corpo: Record<string, unknown>) {
  stato.utente = chi;
  const req = new Request('http://localhost/api/returns/r1/avanza', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

function scheda(): string {
  const ret: ReturnRow = {
    id: 'r1',
    status: String(stato.reso.status),
    reason: 'CHANGED_MIND',
    notes: null,
    photo_urls: null,
    refund_amount_cents: null,
    decision_notes: (stato.reso.decision_notes as string | null) ?? null,
    created_at: String(stato.reso.created_at),
    decided_at: (stato.reso.decided_at as string | null) ?? null,
    customer_shipped_back_on: (stato.reso[COLONNA] as string | null) ?? null,
    tracking_number: (stato.reso.tracking_number as string | null) ?? null,
  };
  return renderToStaticMarkup(createElement(ReturnRequestCard, { ret, orderTotal: 30, onDecided: () => {} }));
}

const dichiara = (corpo: Record<string, unknown> = {}) =>
  avanza(CLIENTE, { stato: 'SHIPPED_BACK', speditoIl: '2026-11-15', numeroSpedizione: 'RR123456789IT', ...corpo });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Giorno 15 dall'approvazione del 2/11: per la regola dei 14 giorni il recesso si chiuderebbe.
  vi.setSystemTime(new Date('2026-11-17T10:00:00+01:00'));
  stato.reso = {
    id: 'r1', status: 'APPROVED', reason: 'CHANGED_MIND', seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1',
    refund_amount_cents: null, refund_id: null, order_item_id: null,
    created_at: '2026-11-01T10:00:00+01:00', decided_at: '2026-11-02T10:00:00+01:00',
    decision_notes: NOTA_DEL_NEGOZIO, tracking_number: null,
  };
  stato.ordine = {
    seller_id: 'seller-1', user_id: 'b1', stripe_payment_intent: 'pi_1', payment_method: 'card',
    gross_total_cents: 3000, total_price: 30, refunded_amount_cents: 0, stripe_refund_id: null,
  };
  stato.scritture = [];
  stato.avvisi = [];
  stato.senza411 = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('R17-003 — al giorno 15 del recesso approvato', () => {
  it('senza la dichiarazione del cliente il negozio chiude senza rimborso, come oggi', async () => {
    expect(scheda()).toContain('Chiudi senza rimborso');
    const res = await avanza(NEGOZIO, { stato: 'CANCELED' });
    expect(res.status).toBe(200);
    expect(stato.reso.status).toBe('CANCELED');
  });

  it('il cliente dichiara la spedizione: il reso va in rientro col giorno e il numero, e il negozio lo sa', async () => {
    const res = await dichiara();
    expect(res.status).toBe(200);
    expect(stato.reso.status).toBe('SHIPPED_BACK');
    expect(stato.reso[COLONNA]).toBe('2026-11-15');
    expect(stato.reso.tracking_number).toBe('RR123456789IT');
    // La nota che il negozio ha scritto approvando (l'indirizzo per il reso) resta sua.
    expect(stato.reso.decision_notes).toBe(NOTA_DEL_NEGOZIO);
    const avviso = stato.avvisi.find((a) => a.user_id === 'seller-1');
    expect(avviso?.link).toBe('/seller/orders/o1');
    expect(String(avviso?.body)).toContain('15/11/2026');
    expect(String(avviso?.body)).toContain('RR123456789IT');
    expect(stato.avvisi.some((a) => a.user_id === 'b1')).toBe(false);
  });

  it('con la dichiarazione il negozio non chiude piu\' senza rimborso, e la scheda gliela mostra', async () => {
    expect((await dichiara()).status).toBe(200);
    const res = await avanza(NEGOZIO, { stato: 'CANCELED' });
    expect(res.status).toBe(409);
    expect(stato.reso.status).toBe('SHIPPED_BACK');

    const html = scheda();
    expect(html).not.toContain('Chiudi senza rimborso');
    expect(html).toContain('Il cliente dichiara di aver rispedito la merce');
    expect(html).toContain('15 novembre 2026');
    expect(html).toContain('RR123456789IT');
    // La strada giusta resta: la merce arriva e si rimborsa.
    expect(html).toContain('Ho ricevuto la merce');
  });

  it('il negozio (o l\'amministratore) non dichiara la spedizione al posto del cliente', async () => {
    const res = await avanza(NEGOZIO, { stato: 'SHIPPED_BACK', speditoIl: '2026-11-15' });
    expect(res.status).toBe(403);
    const resAdmin = await avanza({ id: 'admin-1' }, { stato: 'SHIPPED_BACK', speditoIl: '2026-11-15', numeroSpedizione: 'X1' });
    expect(resAdmin.status).toBe(403);
    expect(stato.scritture).toEqual([]);
    expect(stato.reso.status).toBe('APPROVED');
    expect(stato.reso[COLONNA]).toBeUndefined();
  });

  it('il suo «Il cliente ha rispedito» senza giorno ne\' numero resta com\'era', async () => {
    const res = await avanza(NEGOZIO, { stato: 'SHIPPED_BACK' });
    expect(res.status).toBe(200);
    expect(stato.reso.status).toBe('SHIPPED_BACK');
    expect(stato.reso[COLONNA]).toBeUndefined();
  });

  it('chi non e\' il cliente dell\'ordine non dichiara niente: 403', async () => {
    const res = await avanza({ id: 'estraneo' }, { stato: 'SHIPPED_BACK', speditoIl: '2026-11-15' });
    expect(res.status).toBe(403);
    expect(stato.scritture).toEqual([]);
  });

  it('il giorno serve, e non puo\' essere nel futuro, prima della richiesta o inventato: 400', async () => {
    for (const speditoIl of [undefined, '2026-11-18', '2026-10-31', '2026-02-30']) {
      const res = await avanza(CLIENTE, { stato: 'SHIPPED_BACK', ...(speditoIl ? { speditoIl } : {}) });
      expect(res.status, `giorno ${speditoIl}`).toBe(400);
    }
    // Il giorno di oggi vale.
    expect((await dichiara({ speditoIl: '2026-11-17' })).status).toBe(200);
    expect(stato.scritture).toHaveLength(1);
  });

  it('su un reso che il negozio non ha ancora approvato: 409, il cliente aspetta la risposta', async () => {
    stato.reso.status = 'REQUESTED';
    const res = await dichiara();
    expect(res.status).toBe(409);
    expect(stato.scritture).toEqual([]);
  });

  it('prima della migrazione 411 lo stato si scrive lo stesso, e il giorno arriva nell\'avviso', async () => {
    stato.senza411 = true;
    const res = await dichiara();
    expect(res.status).toBe(200);
    expect(stato.reso.status).toBe('SHIPPED_BACK');
    expect(stato.reso.tracking_number).toBe('RR123456789IT');
    expect(stato.scritture[1]).not.toHaveProperty(COLONNA);
    expect(String(stato.avvisi.find((a) => a.user_id === 'seller-1')?.body)).toContain('15/11/2026');
    expect((await avanza(NEGOZIO, { stato: 'CANCELED' })).status).toBe(409);
  });

  it('la regola: al giorno 15 da APPROVED si chiude, da SHIPPED_BACK no', () => {
    const adesso = Date.now();
    const base = { reason: 'CHANGED_MIND', created_at: '2026-11-01T10:00:00+01:00', decided_at: '2026-11-02T10:00:00+01:00' };
    expect(percheIlRecessoNonSiChiude({ ...base, status: 'APPROVED' }, adesso)).toBeNull();
    expect(percheIlRecessoNonSiChiude({ ...base, status: 'SHIPPED_BACK' }, adesso)).toMatch(/non si può chiudere senza rimborso/);
  });
});
