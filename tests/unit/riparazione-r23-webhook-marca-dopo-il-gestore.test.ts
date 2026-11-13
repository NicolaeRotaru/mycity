import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Scrittura } from './aiuti/finto-database-dei-pagamenti';

/**
 * R23-001 — Una prova sul webhook di Stripe controllava l'ordine delle righe cercando una parola
 * («processed: true» dopo «switch (event.type)»), e bastava togliere uno spazio per ingannarla.
 *
 * Qui non si legge il testo: si chiama la rotta vera e si guarda cosa FA. Il gestore finto
 * annota quando lavora; il database finto annota quando l'avviso viene segnato come lavorato.
 *  · gestore riuscito → la marcatura arriva DOPO il gestore;
 *  · gestore caduto   → nessuna marcatura, risposta 500, turno liberato: Stripe riprova.
 * Uno spazio, un commento o una costante al posto della parola non cambiano niente di questo.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const stato = vi.hoisted(() => ({
  db: null as unknown as { client: unknown },
  diario: [] as string[],
  gestoreCade: false,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => ({ id: 'evt_rimborso', type: 'charge.refunded', data: { object: { id: 'ch_1' } } }) },
  }),
  isStripeConfigured: () => true,
}));
vi.mock('@/lib/stripe/webhook/rimborsi', () => ({
  handleChargeRefunded: vi.fn(async () => {
    stato.diario.push('gestore');
    if (stato.gestoreCade) throw new Error('il database del rimborso non risponde');
  }),
  handleRefundUpdated: vi.fn(),
}));

import { POST } from '@/app/api/stripe/webhook/route';

let db: FintoDatabase;

async function consegna(): Promise<number> {
  const r = await POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' }, body: '{}',
    }) as never,
  );
  return r.status;
}

beforeEach(() => {
  stato.diario = [];
  stato.gestoreCade = false;
  db = fintoDatabase({ stripe_event_log: [] });
  db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  db.unici.stripe_event_log = [['event_id']];
  db.guasto = (s: Scrittura) => {
    const valori = s.valori as Record<string, unknown> | undefined;
    if (s.tabella === 'stripe_event_log' && s.operazione === 'update' && valori && valori.processed === true) {
      stato.diario.push('marcatura');
    }
    return null;
  };
  stato.db = db;
});

const avviso = () => db.tabelle.stripe_event_log!.find((r) => r.event_id === 'evt_rimborso');

describe('R23-001 — l avviso si segna come lavorato DOPO il gestore, e solo se il gestore riesce', () => {
  it('gestore riuscito: prima il gestore, poi la marcatura', async () => {
    expect(await consegna()).toBe(200);
    expect(stato.diario).toEqual(['gestore', 'marcatura']);
    expect(avviso()?.processed).toBe(true);
  });

  it('gestore caduto: nessuna marcatura, 500, e il turno torna libero perché Stripe riprovi', async () => {
    stato.gestoreCade = true;
    expect(await consegna()).toBe(500);
    expect(stato.diario, 'segnato come lavorato prima del gestore: Stripe non riproverebbe mai').toEqual(['gestore']);
    expect(avviso()?.processed).toBe(false);
    expect(avviso()?.claimed_at ?? null).toBeNull();
  });
});
