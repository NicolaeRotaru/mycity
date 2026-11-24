import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 24/11/2026 — Nicola: «Ora del Gusto deve già poter selezionare il servizio e effettuare il
 * pagamento»; «sono servizi che offre mycity, ma tramite SDG». Queste prove dicono cosa deve
 * succedere davvero coi soldi:
 *  · la cassa Stripe è un abbonamento mensile al canone del server, col primo mese a metà;
 *  · il browser sceglie solo la fascia: un prezzo mandato da lui non conta;
 *  · niente cassa se il canone è su richiesta, se c'è già un abbonamento, o se la tabella non si legge;
 *  · la cassa non porta `client_reference_id` (il gestore delle casse scadute lo legge come carrello);
 *  · il webhook scrive SOLO in `abbonamenti_servizi`, mai sul profilo della vetrina.
 */

const stato = vi.hoisted(() => ({
  configurato: true,
  agenzia: {} as unknown,
  attivi: [] as unknown[],
  erroreAttivi: null as null | { code: string; message: string },
  sessioni: [] as Record<string, unknown>[],
  opzioniSessioni: [] as Record<string, unknown>[],
  buonoEsiste: true,
  buoniCreati: [] as Record<string, unknown>[],
  scritture: [] as { tabella: string; tipo: string; valori: unknown; filtro?: [string, unknown] }[],
  righeServizi: [] as { seller_id: string; fascia: string }[],
  erroreLetturaServizi: null as null | { code: string; message: string },
  statoStripe: 'active' as 'active' | 'past_due' | 'canceled',
  avvisi: [] as { titolo: string; corpo: string }[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'negozio-1', email: 'oradelgusto@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => stato.configurato,
  getStripe: () => ({
    coupons: {
      retrieve: async (id: string) => {
        if (!stato.buonoEsiste) throw new Error('No such coupon');
        return { id };
      },
      create: async (v: Record<string, unknown>) => {
        stato.buoniCreati.push(v);
        stato.buonoEsiste = true;
        return { id: v.id };
      },
    },
    checkout: {
      sessions: {
        create: async (v: Record<string, unknown>, o: Record<string, unknown>) => {
          stato.sessioni.push(v);
          stato.opzioniSessioni.push(o);
          return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
        },
      },
    },
  }),
}));
vi.mock('@/lib/stripe/webhook/abbonamenti', () => ({
  handleSellerSubscription: async () => { stato.avvisi.push({ titolo: 'vetrina', corpo: '' }); },
  statoDaStripe: async () => ({ subscription_status: stato.statoStripe, subscription_renews_at: '2026-12-24T10:00:00.000Z' }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (titolo: string, corpo: string) => {
    stato.avvisi.push({ titolo, corpo });
    return 'scritto';
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const c: Record<string, unknown> = {};
      let filtro: [string, unknown] | undefined;
      let tipo = 'select';
      let valori: unknown;
      const fine = () => {
        if (tipo !== 'select') {
          stato.scritture.push({ tabella, tipo, valori, filtro });
          return { data: [], error: null };
        }
        return { data: null, error: null };
      };
      c.select = () => c;
      c.eq = (col: string, v: unknown) => { filtro = filtro ?? [col, v]; return c; };
      c.in = () => c;
      c.limit = async () => (tabella === 'abbonamenti_servizi'
        ? { data: stato.erroreAttivi ? null : stato.attivi, error: stato.erroreAttivi }
        : { data: [], error: null });
      c.maybeSingle = async () => {
        if (tabella === 'profiles') return { data: { store_name: 'Ora del Gusto' }, error: null };
        if (tabella === 'site_settings') return { data: { agenzia: stato.agenzia }, error: null };
        if (tabella === 'abbonamenti_servizi') {
          return stato.erroreLetturaServizi
            ? { data: null, error: stato.erroreLetturaServizi }
            : { data: stato.righeServizi[0] ?? null, error: null };
        }
        return { data: null, error: null };
      };
      c.upsert = (v: unknown) => { tipo = 'upsert'; valori = v; return Promise.resolve(fine()); };
      c.update = (v: unknown) => { tipo = 'update'; valori = v; return c; };
      c.insert = (v: unknown) => { tipo = 'insert'; valori = v; return Promise.resolve(fine()); };
      c.then = (ok: (x: unknown) => unknown) => Promise.resolve(fine()).then(ok);
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/seller/preventivo/paga/route');
const servizi = await import('@/lib/stripe/webhook/servizi');

const paga = (corpo: unknown) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/preventivo/paga', { method: 'POST', body: JSON.stringify(corpo) }),
  );

beforeEach(() => {
  stato.configurato = true;
  stato.agenzia = {};
  stato.attivi = [];
  stato.erroreAttivi = null;
  stato.sessioni = [];
  stato.opzioniSessioni = [];
  stato.buonoEsiste = true;
  stato.buoniCreati = [];
  stato.scritture = [];
  stato.righeServizi = [];
  stato.erroreLetturaServizi = null;
  stato.statoStripe = 'active';
  stato.avvisi = [];
});

describe('la cassa dell abbonamento dei servizi', () => {
  it('apre un abbonamento mensile al canone del listino, col buono del primo mese', async () => {
    const r = await paga({ abbonamento: 'business' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { url: string } }).data.url).toBe('https://checkout.stripe.com/c/pay/cs_1');
    const s = stato.sessioni[0] as Record<string, any>;
    expect(s.mode).toBe('subscription');
    expect(s.line_items[0].price_data).toMatchObject({ currency: 'eur', unit_amount: 50000, recurring: { interval: 'month' } });
    expect(s.line_items[0].price_data.product_data.description).toContain('SDG Agenzia');
    expect(s.discounts).toEqual([{ coupon: 'mycity-servizi-primo-mese-meta' }]);
    expect(s.metadata).toEqual({ kind: 'servizi_subscription', seller_id: 'negozio-1', fascia: 'business', canone_centesimi: '50000', negozio: 'Ora del Gusto' });
    expect(s.subscription_data.metadata).toEqual(s.metadata);
    expect(s.customer_email).toBe('oradelgusto@esempio.it');
    expect('client_reference_id' in s).toBe(false); // il gestore delle casse scadute lo leggerebbe come carrello
    expect('customer' in s).toBe(false); // non il cliente Stripe della vetrina
    expect(s.success_url).toBe('https://www.mycity-marketplace.com/seller/preventivo?pagato=1');
    expect(s.cancel_url).toBe('https://www.mycity-marketplace.com/seller/preventivo?pagato=0');
    expect(String(stato.opzioniSessioni[0].idempotencyKey)).toMatch(/^servizi:negozio-1:business:50000:\d+$/);
  });

  it('il canone lo decide il server: un prezzo mandato dal browser non conta', async () => {
    stato.agenzia = { abbonamenti: { premium: 120000 } };
    await paga({ abbonamento: 'premium', prezzo: 1, canone_centesimi: 1, unit_amount: 1 });
    expect((stato.sessioni[0] as Record<string, any>).line_items[0].price_data.unit_amount).toBe(120000);
  });

  it('se il buono del primo mese non c è, lo crea: -50%, una volta sola', async () => {
    stato.buonoEsiste = false;
    await paga({ abbonamento: 'base' });
    expect(stato.buoniCreati).toEqual([{ id: 'mycity-servizi-primo-mese-meta', percent_off: 50, duration: 'once', name: 'Primo mese a metà prezzo' }]);
  });

  it('niente cassa con canone su richiesta, abbonamento già attivo, tabella illeggibile, fascia sbagliata o Stripe spento', async () => {
    stato.agenzia = { abbonamenti: { base: null } };
    expect((await paga({ abbonamento: 'base' })).status).toBe(409);
    stato.agenzia = {};
    stato.attivi = [{ fascia: 'base' }];
    expect((await paga({ abbonamento: 'business' })).status).toBe(409);
    stato.attivi = [];
    stato.erroreAttivi = { code: '42P01', message: 'relation does not exist' };
    expect((await paga({ abbonamento: 'business' })).status).toBe(503);
    stato.erroreAttivi = null;
    expect((await paga({ abbonamento: 'gold' })).status).toBe(400);
    expect((await paga({ scelte: ['social'] })).status).toBe(400);
    stato.configurato = false;
    expect((await paga({ abbonamento: 'business' })).status).toBe(503);
    expect(stato.sessioni).toHaveLength(0);
  });
});

describe('il webhook dell abbonamento dei servizi', () => {
  const sessione = (meta: Record<string, string>) => ({
    id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', metadata: meta,
  }) as never;
  const META = { kind: 'servizi_subscription', seller_id: 'negozio-1', fascia: 'business', canone_centesimi: '50000', negozio: 'Ora del Gusto' };

  it('scrive l abbonamento in abbonamenti_servizi, mai sul profilo, e avvisa Nicola e il negozio', async () => {
    await servizi.handleServiziSubscription(sessione(META));
    expect(stato.scritture.some((w) => w.tabella === 'profiles')).toBe(false);
    const riga = stato.scritture.find((w) => w.tabella === 'abbonamenti_servizi' && w.tipo === 'upsert');
    expect(riga?.valori).toMatchObject({
      seller_id: 'negozio-1', fascia: 'business', canone_centesimi: 50000,
      stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', stato: 'active', rinnovo_il: '2026-12-24T10:00:00.000Z',
    });
    expect(stato.avvisi[0].corpo).toMatch(/Ora del Gusto ha pagato l'abbonamento Business \(500,00\s€ al mese, il primo mese 250,00\s€\)/);
    expect(stato.scritture.some((w) => w.tabella === 'notifications' && w.tipo === 'insert')).toBe(true);
  });

  it('con dati incompleti si ferma e fa riprovare Stripe; un abbonamento non attivo non manda «grazie»', async () => {
    await expect(servizi.handleServiziSubscription(sessione({ ...META, fascia: 'gold' }))).rejects.toThrow(/incompleti/);
    await expect(servizi.handleServiziSubscription(sessione({ ...META, canone_centesimi: 'x' }))).rejects.toThrow(/incompleti/);
    stato.statoStripe = 'canceled';
    await servizi.handleServiziSubscription(sessione(META));
    expect(stato.avvisi).toHaveLength(0);
    expect(stato.scritture.some((w) => w.tabella === 'notifications')).toBe(false);
  });

  it('smista le sessioni pagate: la vetrina al suo gestore, i servizi alla loro tabella', async () => {
    expect(servizi.eSessioneDiAbbonamento({ metadata: { kind: 'servizi_subscription' } } as never)).toBe(true);
    expect(servizi.eSessioneDiAbbonamento({ metadata: { kind: 'seller_subscription' } } as never)).toBe(true);
    expect(servizi.eSessioneDiAbbonamento({ metadata: { kind: 'gift_card' } } as never)).toBe(false);
    expect(servizi.eSessioneDiAbbonamento({ metadata: {} } as never)).toBe(false); // un ordine
    await servizi.handleAbbonamentoPagato(sessione({ kind: 'seller_subscription', seller_id: 'negozio-1' }));
    expect(stato.avvisi.map((a) => a.titolo)).toEqual(['vetrina']);
    expect(stato.scritture.some((w) => w.tabella === 'abbonamenti_servizi')).toBe(false);
  });
});
