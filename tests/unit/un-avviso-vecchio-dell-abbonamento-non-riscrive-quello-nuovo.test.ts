import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 (quinto riesame del lotto) — UN AVVISO VECCHIO SULL'ABBONAMENTO,
 * RIPROVATO DA STRIPE DOPO UNO NUOVO, RIMETTEVA IL NEGOZIO «IN RITARDO DI PAGAMENTO».
 *
 * Da R81 una scrittura caduta fa riprovare Stripe, e Stripe non garantisce
 * l'ordine degli avvisi. Il caso: alle 10:00 arriva «in ritardo» e la
 * scrittura va in timeout; alle 10:30 il negozio aggiorna la carta e arriva
 * «attivo», che passa; alle 11:00 Stripe riprova l'avviso delle 10:00. Il
 * gestore scriveva lo stato che l'avviso portava dentro: il negozio che aveva
 * pagato leggeva «Abbonamento in sospeso» fino al rinnovo dopo. Al contrario,
 * un pagamento dell'abbonamento riprovato dopo la disdetta lo rimetteva «attivo».
 *
 * Gira la rotta VERA del webhook coi gestori VERI. Lo Stripe finto dice com'è
 * l'abbonamento ADESSO (`stato.suStripe`), e cambia fra un avviso e l'altro
 * come cambierebbe quello vero.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

type Evento = { id: string; type: string; data: { object: Record<string, unknown> } };
const stato: { db: FintoDatabase; evento: Evento; suStripe: Record<string, unknown> } = {
  db: fintoDatabase(),
  evento: { id: 'evt_x', type: 'noop', data: { object: {} } },
  suStripe: {},
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    subscriptions: { retrieve: async () => ({ ...stato.suStripe }) },
  }),
  isStripeConfigured: () => true,
  computeOrderSplit: () => ({ subtotalCents: 0, applicationFeeCents: 0, sellerPayoutCents: 0 }),
}));

import { POST } from '@/app/api/stripe/webhook/route';
import { abbonamentoDellaFattura } from '@/lib/stripe/webhook/abbonamenti';

async function consegna(evento: Evento): Promise<number> {
  stato.evento = evento;
  const r = await POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' }, body: '{}',
    }) as never,
  );
  return r.status;
}

const profilo = () => stato.db.tabelle.profiles!.find((r) => r.id === 's1')!;
const avvisiAlNegozio = (titolo: string) => stato.db.tabelle.notifications!.filter((n) => n.user_id === 's1' && n.title === titolo);
/** La scrittura che porta questo stato va in timeout (una volta: poi si toglie a mano). */
const cadeLaScritturaDi = (valore: string) => (s: { tabella: string; valori: unknown }) =>
  s.tabella === 'profiles' && (s.valori as Riga | null)?.subscription_status === valore ? TIMEOUT : null;

const aggiornato = (id: string, status: string): Evento => ({
  id, type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status, current_period_end: 1_800_000_000 } },
});

beforeEach(() => {
  stato.db = fintoDatabase({
    profiles: [{ id: 's1', role: 'seller', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'active', subscription_renews_at: null }],
    notifications: [],
    stripe_event_log: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
  stato.suStripe = { id: 'sub_1', status: 'active', current_period_end: 1_802_000_000 };
});

describe('un avviso dell abbonamento riprovato dopo uno più nuovo', () => {
  it('IL CASO DEL RIESAME — «in ritardo» delle 10:00 riprovato alle 11:00, dopo «attivo» delle 10:30: resta attivo', async () => {
    stato.suStripe = { id: 'sub_1', status: 'past_due', current_period_end: 1_800_000_000 };
    stato.db.guasto = cadeLaScritturaDi('past_due');
    expect(await consegna(aggiornato('evt_10_00', 'past_due')), 'la scrittura è caduta: Stripe deve riprovare').toBe(500);

    // 10:30 — il negozio aggiorna la carta: su Stripe l'abbonamento torna attivo.
    stato.db.guasto = () => null;
    stato.suStripe = { id: 'sub_1', status: 'active', current_period_end: 1_802_000_000 };
    expect(await consegna(aggiornato('evt_10_30', 'active'))).toBe(200);

    // 11:00 — Stripe riprova l'avviso delle 10:00.
    expect(await consegna(aggiornato('evt_10_00', 'past_due'))).toBe(200);
    expect(profilo().subscription_status, 'il negozio ha pagato e torna «in ritardo di pagamento»').toBe('active');
    expect(profilo().subscription_renews_at).toBe(new Date(1_802_000_000 * 1000).toISOString());
  });

  const fatturaRifiutata = (fattura: Record<string, unknown>): Evento => ({
    id: 'evt_fattura', type: 'invoice.payment_failed', data: { object: { id: 'in_1', customer: 'cus_1', ...fattura } },
  });

  for (const [come, fattura] of [
    ['con l abbonamento sulla fattura', { subscription: 'sub_1' }],
    ['con l abbonamento dove lo mettono le versioni nuove di Stripe', { parent: { subscription_details: { subscription: 'sub_1' } } }],
    ['senza l abbonamento sulla fattura: si guarda quello del negozio', {}],
  ] as const) {
    it(`fattura rifiutata riprovata dopo il pagamento, ${come}: resta attivo e nessun avviso «non riuscito»`, async () => {
      stato.suStripe = { id: 'sub_1', status: 'past_due', current_period_end: 1_800_000_000 };
      stato.db.guasto = cadeLaScritturaDi('past_due');
      expect(await consegna(fatturaRifiutata(fattura))).toBe(500);

      stato.db.guasto = () => null;
      stato.suStripe = { id: 'sub_1', status: 'active', current_period_end: 1_802_000_000 };
      expect(await consegna(aggiornato('evt_pagato', 'active'))).toBe(200);

      expect(await consegna(fatturaRifiutata(fattura))).toBe(200);
      expect(profilo().subscription_status).toBe('active');
      expect(avvisiAlNegozio('⚠️ Pagamento abbonamento non riuscito'), 'al negozio che ha pagato: «aggiorna il metodo di pagamento»').toEqual([]);
    });
  }

  it('il pagamento dell abbonamento riprovato dopo la disdetta non lo rimette attivo', async () => {
    stato.db.tabelle.profiles = [{ id: 's1', role: 'seller', stripe_customer_id: null, stripe_subscription_id: 'sub_1', subscription_status: null, subscription_renews_at: null }];
    const pagato: Evento = {
      id: 'evt_checkout', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', mode: 'subscription', payment_status: 'paid', status: 'complete', customer: 'cus_1', subscription: 'sub_1', metadata: { kind: 'seller_subscription', seller_id: 's1' } } },
    };
    stato.db.guasto = cadeLaScritturaDi('active');
    expect(await consegna(pagato)).toBe(500);

    // Il negozio disdice: su Stripe l'abbonamento è cancellato.
    stato.db.guasto = () => null;
    stato.suStripe = { id: 'sub_1', status: 'canceled', current_period_end: 1_802_000_000 };
    expect(await consegna({ id: 'evt_disdetta', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } })).toBe(200);

    expect(await consegna(pagato)).toBe(200);
    expect(profilo().subscription_status, 'abbonamento cancellato su Stripe, «attivo» qui').toBe('canceled');
    expect(avvisiAlNegozio('✅ Abbonamento attivo')).toEqual([]);
  });
});

describe('quando l avviso dice il vero, si scrive come prima', () => {
  it('la carta rifiutata e l abbonamento ancora in ritardo: «in ritardo» e l avviso al negozio', async () => {
    stato.suStripe = { id: 'sub_1', status: 'past_due', current_period_end: 1_800_000_000 };
    expect(await consegna({ id: 'evt_f', type: 'invoice.payment_failed', data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1' } } })).toBe(200);
    expect(profilo().subscription_status).toBe('past_due');
    expect(avvisiAlNegozio('⚠️ Pagamento abbonamento non riuscito')).toHaveLength(1);
  });

  it('il primo pagamento: attivo, col grazie', async () => {
    expect(await consegna({
      id: 'evt_c', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', customer: 'cus_1', subscription: 'sub_1', metadata: { kind: 'seller_subscription', seller_id: 's1' } } },
    })).toBe(200);
    expect(profilo().subscription_status).toBe('active');
    expect(avvisiAlNegozio('✅ Abbonamento attivo')).toHaveLength(1);
  });

  it('Stripe non risponde quando si rilegge l abbonamento: si riprova, non si scrive uno stato inventato', async () => {
    stato.suStripe = { get status(): never { throw new Error('Stripe non risponde'); } } as unknown as Record<string, unknown>;
    expect(await consegna(aggiornato('evt_cieco', 'past_due'))).toBe(500);
    expect(profilo().subscription_status).toBe('active');
  });
});

describe('dove sta l abbonamento sulla fattura', () => {
  it('nelle due forme di Stripe, e da nessuna parte', () => {
    expect(abbonamentoDellaFattura({ subscription: 'sub_a' } as never)).toBe('sub_a');
    expect(abbonamentoDellaFattura({ subscription: { id: 'sub_b' } } as never)).toBe('sub_b');
    expect(abbonamentoDellaFattura({ parent: { subscription_details: { subscription: 'sub_c' } } } as never)).toBe('sub_c');
    expect(abbonamentoDellaFattura({} as never)).toBeNull();
  });
});
