import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 15/10/2026 (R81, collaudo giro 2) — DOPO UN ERRORE, STRIPE NON RIUSCIVA PIÙ A
 * FAR LAVORARE L'AVVISO.
 *
 * Il patto della rotta: se il gestore fallisce, si risponde 500, il turno torna
 * libero e la consegna successiva di Stripe rifà il lavoro. Il turno si
 * riprendeva con UNA scrittura che conteneva un «oppure»
 * (`claimed_at.is.null,claimed_at.lt.…`) e chiedeva indietro `event_id`.
 * PostgREST applica l'«oppure» anche alle righe restituite: con
 * `select('event_id')` risponde 42703 e non scrive niente. Il collaudatore l'ha
 * misurato su PostgREST 12.2.3, 12.2.8, 13.0.5 e 14.0: dopo un 500, quattro
 * consegne di fila rispondevano «503 idempotenza non disponibile», l'ordine
 * restava senza contestazione aperta, e un doppione di un avviso già lavorato
 * bene riceveva 503 invece di «già visto».
 *
 * Le prove di prima passavano perché il database finto applicava l'«oppure»
 * solo prima di scrivere. Adesso il finto fa come PostgREST (vedi
 * `il-finto-database-si-comporta-come-postgrest.test.ts`), e qui si fa girare
 * la rotta vera sopra di lui.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const stato: {
  db: FintoDatabase;
  evento: { id: string; type: string; data: { object: Record<string, unknown> } };
} = {
  db: fintoDatabase(),
  evento: { id: 'evt_x', type: 'noop', data: { object: {} } },
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    transfers: {
      createReversal: async (_t: string, _p: unknown, o: { idempotencyKey: string }) => ({ id: `trr_${o.idempotencyKey}` }),
      listReversals: async () => ({ data: [] }),
    },
  }),
  isStripeConfigured: () => true,
}));

import { POST } from '@/app/api/stripe/webhook/route';
import { prendiIlTurno, TURNO_SCADUTO_DOPO_MS } from '@/lib/stripe/webhook/registro-eventi';

function consegna(): Promise<Response> {
  return POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      body: '{}',
    }) as never,
  );
}

const ordineHeld: Riga = {
  id: 'o1',
  total_price: 40,
  gross_total_cents: 4000,
  payment_status: 'PAID',
  delivery_status: 'DELIVERED',
  payout_status: 'HELD',
  dispute_status: null,
  stripe_payment_intent: 'pi_1',
  stripe_charge_id: 'ch_1',
  stripe_transfer_id: null,
  stripe_reversal_id: null,
  seller_payout_cents: 3240,
  seller_payout_reversed_cents: 0,
  rider_id: null,
  rider_transfer_id: null,
  rider_payout_status: null,
};

const registro = () => stato.db.tabelle.stripe_event_log?.find((r) => r.event_id === stato.evento.id);
const ordine = () => stato.db.tabelle.orders?.find((r) => r.id === 'o1');

beforeEach(() => {
  stato.db = fintoDatabase({
    orders: [{ ...ordineHeld }],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    stripe_event_log: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
  stato.evento = {
    id: 'evt_dispute_open',
    type: 'charge.dispute.created',
    data: { object: { id: 'dp_1', amount: 4000, payment_intent: 'pi_1', charge: 'ch_1', created: 1 } },
  };
});

describe('dopo un 500, la consegna successiva di Stripe rifà il lavoro', () => {
  it('IL CASO DEL COLLAUDO — contestazione aperta durante un intoppo: alla seconda consegna l ordine si blocca', async () => {
    let cadute = 0;
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && (s.valori as Riga | null)?.dispute_status === 'OPEN' && cadute++ === 0 ? TIMEOUT : null;

    const prima = await consegna();
    expect(prima.status).toBe(500);
    expect(registro()?.claimed_at, 'il turno torna libero dopo il 500').toBeNull();

    const seconda = await consegna();
    expect(seconda.status, 'col 503 (o col 200 «già visto») l avviso non si lavora mai più').toBe(200);
    expect(await seconda.json()).not.toHaveProperty('duplicated');
    expect(ordine()?.dispute_status, 'senza OPEN il giro dei bonifici paga il negozio').toBe('OPEN');
    expect(registro()?.processed).toBe(true);
  });

  it('e anche dopo più consegne fallite di fila, la prima che trova il database sano lavora', async () => {
    let cadute = 0;
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && (s.valori as Riga | null)?.dispute_status === 'OPEN' && cadute++ < 3 ? TIMEOUT : null;
    const esiti = [];
    for (let i = 0; i < 4; i++) esiti.push((await consegna()).status);
    expect(esiti).toEqual([500, 500, 500, 200]);
    expect(ordine()?.dispute_status).toBe('OPEN');
  });
});

describe('i doppioni', () => {
  it('un avviso già lavorato bene, consegnato di nuovo, riceve 200 «già visto» e non 503', async () => {
    expect((await consegna()).status).toBe(200);
    const notificheDopoLaPrima = stato.db.tabelle.notifications.length;

    const doppione = await consegna();
    expect(doppione.status, 'con 503 Stripe riprova per tre giorni un avviso già lavorato').toBe(200);
    expect(await doppione.json()).toMatchObject({ duplicated: true });
    expect(stato.db.tabelle.notifications.length, 'il gestore non deve ripartire').toBe(notificheDopoLaPrima);
  });

  it('un turno preso da meno di cinque minuti (un altra consegna sta lavorando): «già visto», il gestore non parte', async () => {
    stato.db.tabelle.stripe_event_log = [
      { event_id: stato.evento.id, processed: false, claimed_at: new Date(Date.now() - 60_000).toISOString() },
    ];
    const risposta = await consegna();
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toMatchObject({ duplicated: true });
    expect(ordine()?.dispute_status).toBeNull();
  });

  it('un turno preso più di cinque minuti fa (processo morto a metà) si riprende, e il lavoro si fa', async () => {
    stato.db.tabelle.stripe_event_log = [
      { event_id: stato.evento.id, processed: false, claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() },
    ];
    const risposta = await consegna();
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).not.toHaveProperty('duplicated');
    expect(ordine()?.dispute_status).toBe('OPEN');
  });

  it('se il database non risponde alla presa del turno: 503, Stripe riprova, il gestore non parte', async () => {
    stato.db.tabelle.stripe_event_log = [{ event_id: stato.evento.id, processed: false, claimed_at: null }];
    stato.db.guasto = (s) => (s.tabella === 'stripe_event_log' && s.operazione === 'update' ? TIMEOUT : null);
    expect((await consegna()).status).toBe(503);
    expect(ordine()?.dispute_status).toBeNull();
  });
});

describe('prendiIlTurno, da solo', () => {
  const adesso = new Date('2026-10-15T12:00:00.000Z');
  const riga = (claimed_at: string | null, processed = false) => {
    stato.db.tabelle.stripe_event_log = [{ event_id: 'evt_t', processed, claimed_at }];
  };

  it('turno libero: lo prende la prima consegna, la seconda in gara lo trova occupato', async () => {
    riga(null);
    expect(await prendiIlTurno(stato.db.client as never, 'evt_t', adesso)).toBe('preso');
    expect(await prendiIlTurno(stato.db.client as never, 'evt_t', adesso)).toBe('occupato');
    expect(stato.db.tabelle.stripe_event_log[0].claimed_at).toBe(adesso.toISOString());
  });

  it('turno scaduto: si riprende una volta sola', async () => {
    riga(new Date(adesso.getTime() - TURNO_SCADUTO_DOPO_MS - 1000).toISOString());
    expect(await prendiIlTurno(stato.db.client as never, 'evt_t', adesso)).toBe('preso');
    expect(await prendiIlTurno(stato.db.client as never, 'evt_t', adesso)).toBe('occupato');
  });

  it('turno preso un attimo fa, o avviso già lavorato: occupato', async () => {
    riga(new Date(adesso.getTime() - 1000).toISOString());
    expect(await prendiIlTurno(stato.db.client as never, 'evt_t', adesso)).toBe('occupato');
    riga(null, true);
    expect(await prendiIlTurno(stato.db.client as never, 'evt_t', adesso)).toBe('occupato');
  });
});
