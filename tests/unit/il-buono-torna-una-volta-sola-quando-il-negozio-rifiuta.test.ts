import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL BUONO TORNA UNA VOLTA SOLA QUANDO IL NEGOZIO RIFIUTA.
 *
 * 3/9/2026 — IL CODICE SCONTO TORNAVA INDIETRO DUE VOLTE. Il rifiuto del
 * negoziante passa da `annullaERimborsa`, il modulo condiviso dell'annullamento,
 * che dal 27/8 (R121) restituisce anche il codice sconto: su entrambi i rami,
 * carta e contanti. La rotta del rifiuto però aveva tenuto la sua copia vecchia
 * e richiamava `release_coupon` per conto suo. Per UN solo ordine rifiutato il
 * contatore degli usi scendeva di 2.
 *
 * `release_coupon` toglie un uso a ogni chiamata e non sa per quale ordine la
 * stanno chiamando: non può accorgersi del doppione. Un buono da 100 usi, dopo
 * 30 rifiuti del negozio — prodotto finito, il caso più normale del primo mese —
 * ne regala 30 in più di quelli decisi. E al cliente il messaggio dice «il
 * codice torna utilizzabile» una volta sola.
 *
 * Le altre due strade di annullamento (il cliente e l'amministrazione) non
 * facevano il doppione: tre percorsi, due comportamenti.
 *
 * Questa prova percorre la rotta vera del rifiuto e conta: quante volte il buono
 * è stato restituito per un solo ordine?
 */

const FAKE_SELLER = { id: 'seller-1' };

type Ordine = Record<string, unknown>;

const stato: {
  ordine: Ordine | null;
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  notifiche: Array<Record<string, unknown>>;
} = { ordine: null, rpc: [], notifiche: [] };

const refundOrderMock = vi.fn(async (_o: { orderId: string; amountCents: number }) => ({ refundId: 're_1', reversedCents: 0 }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: typeof FAKE_SELLER; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: FAKE_SELLER, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (o: unknown) => refundOrderMock(o as { orderId: string; amountCents: number }) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stato.ordine, error: null }) }) }),
          // L'annullamento RIVENDICA l'ordine: `.eq(id).neq(stato,'CANCELED').select('id')`.
          // Una riga restituita = il turno è mio.
          update: () => {
            const catena: Record<string, unknown> = {
              eq: () => catena,
              neq: () => catena,
              select: () => Promise.resolve({ data: [{ id: 'o1' }], error: null }),
            };
            return catena;
          },
        };
      }
      return {
        insert: async (righe: Array<Record<string, unknown>>) => {
          stato.notifiche.push(...righe);
          return { error: null };
        },
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      stato.rpc.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import { POST } from '@/app/api/seller/orders/[id]/reject/route';

function ordine(p: Ordine = {}): Ordine {
  return {
    id: 'o1',
    user_id: 'buyer-1',
    seller_id: 'seller-1',
    total_price: 24,
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'NEW',
    stripe_payment_intent: null,
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    coupon_code: 'PROVA10',
    rider_id: null,
    ...p,
  };
}

function chiama(body: unknown = {}) {
  const req = new Request('http://localhost/api/seller/orders/o1/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'o1' }) });
}

const restituzioni = () => stato.rpc.filter((c) => c.name === 'release_coupon');

beforeEach(() => {
  stato.ordine = ordine();
  stato.rpc = [];
  stato.notifiche = [];
  refundOrderMock.mockClear();
  refundOrderMock.mockResolvedValue({ refundId: 're_1', reversedCents: 0 });
});

describe('il negozio rifiuta un ordine pagato in contanti', () => {
  it('IL CASO CHE ROMPEVA — il buono torna una volta sola, non due', async () => {
    const res = await chiama({ reason: 'Focacce finite' });

    expect(res.status).toBe(200);
    expect(
      restituzioni(),
      'un solo ordine rifiutato ha restituito il codice più di una volta: ogni uso in più è uno sconto regalato',
    ).toHaveLength(1);
    expect(restituzioni()[0].args).toMatchObject({ p_code: 'PROVA10' });
  });

  it('la restituzione porta l id dell ordine: è la chiave che impedisce il doppione', async () => {
    // `release_coupon` è un contatore globale: senza sapere PER QUALE ORDINE la
    // stanno chiamando non può rifiutare la seconda chiamata. Con l'id, il
    // database scala l'uso solo se quell'ordine non l'ha già restituito.
    await chiama();
    expect(restituzioni()[0].args).toMatchObject({ p_code: 'PROVA10', p_order_id: 'o1' });
  });

  it('quello che leggiamo al cliente è quello che facciamo: una volta sola', async () => {
    await chiama();
    const alCliente = stato.notifiche.find((n) => n.user_id === 'buyer-1');
    expect(String(alCliente?.body)).toContain('Il codice sconto PROVA10 torna utilizzabile.');
    expect(restituzioni()).toHaveLength(1);
  });
});

describe('il negozio rifiuta un ordine pagato con carta', () => {
  it('IL CASO CHE ROMPEVA — anche dopo il rimborso il buono torna una volta sola', async () => {
    stato.ordine = ordine({
      payment_method: 'card',
      payment_status: 'PAID',
      stripe_payment_intent: 'pi_1',
    });

    const res = await chiama();

    expect(res.status).toBe(200);
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    expect(restituzioni(), 'sul ramo carta il codice è stato restituito due volte').toHaveLength(1);
  });
});

describe('senza codice sconto non si restituisce niente', () => {
  it('un ordine senza buono non chiama nessuno', async () => {
    stato.ordine = ordine({ coupon_code: null });
    await chiama();
    expect(restituzioni()).toHaveLength(0);
  });
});

/**
 * La chiave per ordine vive nella funzione del database, e quella funzione
 * arriva con una migrazione che Nicola deve ancora firmare. Nel frattempo il
 * sito gira: queste due prove dicono cosa succede in quella finestra.
 */
describe('finché la migrazione della chiave non è applicata', () => {
  type Chiamata = { nome: string; args: Record<string, unknown> };

  /** Un finto database che risponde con l'errore scelto alla PRIMA chiamata. */
  function adminCheRisponde(erroreIniziale: { code?: string; message: string } | null) {
    const chiamate: Chiamata[] = [];
    let prima = true;
    const admin = {
      from: () => ({
        update: () => {
          const catena: Record<string, unknown> = {
            eq: () => catena,
            neq: () => catena,
            select: () => Promise.resolve({ data: [{ id: 'o1' }], error: null }),
          };
          return catena;
        },
      }),
      rpc: (nome: string, args: Record<string, unknown>) => {
        chiamate.push({ nome, args });
        if (nome === 'release_coupon' && prima) {
          prima = false;
          return Promise.resolve({ data: null, error: erroreIniziale });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { admin, chiamate };
  }

  const daAnnullare = {
    id: 'o1',
    user_id: 'buyer-1',
    seller_id: 'seller-1',
    total_price: 24,
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'NEW',
    stripe_payment_intent: null,
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    coupon_code: 'PROVA10',
  };

  it('se la funzione con la chiave non esiste ancora, il buono torna lo stesso', async () => {
    // PGRST202 = «questa funzione non c'è». È un errore di forma della chiamata:
    // non può aver scritto niente, quindi riprovare con la firma vecchia è
    // sicuro. Senza questo ripiego il cliente perderebbe il buono senza aver
    // comprato niente — il difetto R121 che tornerebbe indietro.
    const { annullaERimborsa } = await import('@/lib/ordini/annulla');
    const { admin, chiamate } = adminCheRisponde({ code: 'PGRST202', message: 'Could not find the function' });

    await annullaERimborsa(admin, daAnnullare, { reason: 'rifiutato' });

    const rese = chiamate.filter((c) => c.nome === 'release_coupon');
    expect(rese, 'il buono non è tornato a chi non ha comprato niente').toHaveLength(2);
    expect(rese[1].args).toEqual({ p_code: 'PROVA10' });
  });

  it('su un errore qualunque NON si riprova: potrebbe aver già scalato l uso', async () => {
    // Un errore di rete può aver scalato l'uso davvero e aver perso solo la
    // risposta. Riprovare lo scalerebbe due volte: è il danno che stiamo chiudendo.
    const { annullaERimborsa } = await import('@/lib/ordini/annulla');
    const { admin, chiamate } = adminCheRisponde({ message: 'connessione caduta' });

    await annullaERimborsa(admin, daAnnullare, { reason: 'rifiutato' });

    expect(
      chiamate.filter((c) => c.nome === 'release_coupon'),
      'ritentata una restituzione che poteva essere già andata a buon fine',
    ).toHaveLength(1);
  });
});
