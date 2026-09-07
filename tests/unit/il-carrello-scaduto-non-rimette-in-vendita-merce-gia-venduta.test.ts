import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL CARRELLO SCADUTO NON RIMETTE IN VENDITA MERCE CHE INTANTO È STATA VENDUTA.
 *
 * 6/9/2026 — LA STESSA RIPARAZIONE ERA SU UNA STRADA SOLA DELLE DUE.
 *
 * Un carrello scaduto lo chiudono in due: il giro periodico
 * (`app/api/cron/expire-checkouts`) e il webhook di Stripe
 * (`checkout.session.expired` e `async_payment_failed`, che finiscono tutti e
 * due in `handleCheckoutExpired`). Prima di rimettere la merce a scaffale il
 * giro periodico guarda se per quella sessione degli ordini sono già nati, e in
 * quel caso non tocca niente. Il gemello nel webhook quel controllo non ce
 * l'aveva: rivendicava il carrello e chiamava `restore_stock` su tutti i
 * gruppi, anche quando gli ordini c'erano.
 *
 * Quando capita: il pagamento riesce e il webhook muore a metà — creati gli
 * ordini del primo negozio, non quelli del secondo. Gli ordini esistono, il
 * carrello resta PENDING, e chi lo chiude senza guardare rimette in magazzino
 * pezzi che sono già usciti dal negozio. Da lì si vende quello che non c'è, e
 * il secondo cliente lo scopre alla consegna.
 *
 * E il secondo difetto, sulla stessa coppia: quando il giro periodico trova quel
 * caso l'unica cosa che fa è scrivere una riga di avviso agli amministratori —
 * ma l'esito di quella scrittura non lo leggeva nessuno (`await ... .insert()`
 * e via), e il client Supabase non solleva eccezioni. Avviso perso, risposta
 * «ok», e un ordine pagato appeso finché non se ne lamenta il cliente.
 *
 * Queste prove diventano rosse se uno dei due torna.
 */

type Riga = Record<string, unknown>;

const state: {
  /** Cosa risponde la tabella ordini al webhook, che chiede `select('id')`. */
  ordiniDellaSessione: Riga[];
  erroreOrdiniWebhook: { message: string } | null;
  /** Cosa risponde la tabella ordini al giro periodico, che chiede `stripe_session_id`. */
  ordiniDelGiro: Riga[];
  candidati: Riga[];
  rivendicati: Riga[];
  admins: Riga[];
  erroreAdmins: { message: string } | null;
  erroreAvviso: { message: string } | null;
  rpc: Array<{ nome: string; args: Riga }>;
  aggiornamenti: Riga[];
  avvisiScritti: Riga[][];
} = {
  ordiniDellaSessione: [],
  erroreOrdiniWebhook: null,
  ordiniDelGiro: [],
  candidati: [],
  rivendicati: [],
  admins: [{ id: 'admin-1' }],
  erroreAdmins: null,
  erroreAvviso: null,
  rpc: [],
  aggiornamenti: [],
  avvisiScritti: [],
};

/** Una catena di query che si può attendere: `select().eq().in().limit()` e poi `await`. */
function qb(risultato: unknown) {
  const b: Record<string, unknown> = {};
  for (const metodo of ['select', 'eq', 'in', 'lt', 'limit', 'order', 'update']) {
    b[metodo] = () => b;
  }
  b.then = (risolvi: (v: unknown) => unknown) => risolvi(risultato);
  return b;
}

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({}),
  computeOrderSplit: () => ({ feeCents: 0, payoutCents: 0 }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: (colonne: string) =>
            colonne.includes('stripe_session_id')
              ? qb({ data: state.ordiniDelGiro, error: null })
              : qb({ data: state.ordiniDellaSessione, error: state.erroreOrdiniWebhook }),
        };
      }
      if (tabella === 'pending_checkouts') {
        return {
          select: () => qb({ data: state.candidati, error: null }),
          update: (valori: Riga) => {
            state.aggiornamenti.push(valori);
            return qb({ data: state.rivendicati, error: null });
          },
        };
      }
      if (tabella === 'profiles') {
        return { select: () => qb({ data: state.admins, error: state.erroreAdmins }) };
      }
      if (tabella === 'notifications') {
        return {
          insert: (righe: Riga[]) => {
            state.avvisiScritti.push(righe);
            return Promise.resolve({ error: state.erroreAvviso });
          },
        };
      }
      return { select: () => qb({ data: [], error: null }) };
    },
    rpc: (nome: string, args: Riga) => {
      state.rpc.push({ nome, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

/** Il carrello riservato: un pezzo di un prodotto e un codice sconto bruciato. */
const CARRELLO_RISERVATO = {
  id: 'pc_1',
  groups: [{ items: [{ productId: 'p1', quantity: 1, variantId: null }] }],
  coupon_code: 'BENVENUTO',
};

const sessioneScaduta = { id: 'cs_test_1', client_reference_id: 'pc_1', metadata: {} };

async function webhookCarrelloScaduto(sessione: unknown) {
  const { handleCheckoutExpired } = await import('@/lib/stripe/webhook/ordini');
  return handleCheckoutExpired(sessione as never);
}

async function giroDelleScadenze() {
  const { POST } = await import('@/app/api/cron/expire-checkouts/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST' }),
  );
}

beforeEach(() => {
  state.ordiniDellaSessione = [];
  state.erroreOrdiniWebhook = null;
  state.ordiniDelGiro = [];
  state.candidati = [];
  state.rivendicati = [CARRELLO_RISERVATO];
  state.admins = [{ id: 'admin-1' }];
  state.erroreAdmins = null;
  state.erroreAvviso = null;
  state.rpc = [];
  state.aggiornamenti = [];
  state.avvisiScritti = [];
});

describe('il webhook che chiude un carrello scaduto', () => {
  it('con ordini già nati non rimette la merce a scaffale e non restituisce il codice sconto', async () => {
    // Il pagamento è riuscito e il webhook è morto a metà: l'ordine del primo
    // negozio esiste, il carrello è rimasto PENDING.
    state.ordiniDellaSessione = [{ id: 'ord_1' }];

    await webhookCarrelloScaduto(sessioneScaduta);

    expect(
      state.rpc.map((c) => c.nome),
      'la merce di un ordine già nato è tornata in vendita: da qui si vende quello che non c’è',
    ).toEqual([]);
    expect(
      state.aggiornamenti,
      'il carrello è stato dichiarato scaduto mentre degli ordini erano già partiti',
    ).toEqual([]);
  });

  it('senza ordini fa quello che ha sempre fatto: merce e codice sconto tornano disponibili', async () => {
    state.ordiniDellaSessione = [];

    await webhookCarrelloScaduto(sessioneScaduta);

    expect(state.aggiornamenti).toEqual([{ status: 'EXPIRED' }]);
    expect(state.rpc.map((c) => c.nome)).toEqual(['restore_stock', 'release_coupon']);
    expect(state.rpc[0].args).toMatchObject({
      p_items: [{ product_id: 'p1', variant_id: null, qty: 1 }],
    });
  });

  it('se il controllo degli ordini non riesce, non tocca niente e lascia ritentare Stripe', async () => {
    // Non sapere è diverso da sapere che non ci sono ordini: nel dubbio non si
    // ripristina. L'eccezione fa rispondere 500 al webhook, e Stripe riconsegna.
    state.erroreOrdiniWebhook = { message: 'connessione persa' };

    await expect(webhookCarrelloScaduto(sessioneScaduta)).rejects.toThrow(/controllo ordini fallito/);
    expect(state.rpc).toEqual([]);
    expect(state.aggiornamenti).toEqual([]);
  });
});

describe('il giro periodico, quando trova un carrello pagato a metà', () => {
  /** Un candidato scaduto che però ha già i suoi ordini: il caso da avvisare. */
  function candidatoConOrdini() {
    state.candidati = [{ ...CARRELLO_RISERVATO, stripe_session_id: 'cs_test_1' }];
    state.ordiniDelGiro = [{ stripe_session_id: 'cs_test_1' }];
    state.rivendicati = [];
  }

  it('se l’avviso agli amministratori non si scrive, il giro non risponde «ok»', async () => {
    candidatoConOrdini();
    state.erroreAvviso = { message: 'categoria non ammessa' };

    const res = await giroDelleScadenze();

    expect(state.avvisiScritti.length, 'l’avviso non è nemmeno stato tentato').toBe(1);
    expect(
      res.status,
      'l’unico avviso su merce già venduta è sparito e il giro si è dichiarato riuscito',
    ).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, saltati: 1 });
  });

  it('se non c’è nessun amministratore a cui scrivere, non finisce in silenzio', async () => {
    candidatoConOrdini();
    state.admins = [];

    const res = await giroDelleScadenze();

    expect(state.avvisiScritti).toEqual([]);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it('quando l’avviso parte davvero, il giro resta verde e la merce non si tocca', async () => {
    candidatoConOrdini();

    const res = await giroDelleScadenze();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, expired: 0, saltati: 1 });
    expect(state.rpc, 'la merce di un carrello con ordini già nati non torna in vendita').toEqual([]);
    expect(state.avvisiScritti[0][0]).toMatchObject({ category: 'system', user_id: 'admin-1' });
  });
});
