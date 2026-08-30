import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL GUARDIANO ANTI-DOPPIONE DEL WEBHOOK STRIPE DEVE CHIUDERSI, NON APRIRSI.
 *
 * 27/8/2026 (R031 · R134 · R137 · R139) — quattro difetti sulla stessa strada,
 * quella su cui passano tutti i soldi del marketplace.
 *
 * R031/R137 — La riga in `stripe_event_log` è il turno: chi la scrive lavora
 * l'evento, gli altri se ne vanno. Se la scrittura falliva per un motivo
 * diverso dal doppione (una colonna non ancora presente in produzione, un
 * intoppo del database, un permesso), il codice scriveva una riga di log e
 * TIRAVA DRITTO: l'evento veniva lavorato senza nessun guardiano acceso. Una
 * riconsegna dello stesso evento lo rilavorava da capo — ordine creato due
 * volte, bonifico al negozio due volte, giacenza scalata due volte. Un
 * guardiano che si apre quando si rompe è peggio di un guardiano che non c'è,
 * perché nessuno se ne accorge finché non arrivano gli ordini doppi.
 *
 * R134 — Quando il gestore falliva, il turno restava preso: la riga rimaneva
 * `processed = false` con `claimed_at` fresco, e la riconsegna di Stripe entro
 * cinque minuti riceveva «già visto» con un 200. Per Stripe la consegna era
 * riuscita, e l'evento spariva. Su `checkout.session.completed` vuol dire: il
 * cliente ha pagato e l'ordine non esiste.
 *
 * R139 — Il codice si dichiarava pronto ai pagamenti asincroni in tre commenti
 * diversi e non lo era: `checkout.session.async_payment_succeeded` finiva nel
 * ramo `default`, cioè in una riga di log. Il giorno in cui si aggiunge un
 * bonifico SEPA o un pagamento differito, i soldi entrano e l'ordine non nasce
 * mai.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

type Evento = { id: string; type: string; data: { object: Record<string, unknown> } };

const stato: {
  evento: Evento;
  /** Esito dell'INSERT che prende il turno sull'evento. */
  esitoInsert: { error: { code?: string; message?: string } | null };
  /** Righe restituite dalla rivendicazione: vuoto = un altro l'ha già presa. */
  rivendicate: Array<{ event_id: string }>;
  /** Tutte le UPDATE viste su stripe_event_log, in ordine. */
  aggiornamenti: Record<string, unknown>[];
} = {
  evento: { id: 'evt_1', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_1' } } },
  esitoInsert: { error: null },
  rivendicate: [{ event_id: 'evt_1' }],
  aggiornamenti: [],
};

const gestori = {
  checkoutCompletato: vi.fn(async (_x: unknown) => {}),
  checkoutScaduto: vi.fn(async (_x: unknown) => {}),
  pagamentoFallito: vi.fn(async (_x: unknown) => {}),
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => stato.evento } }),
  isStripeConfigured: () => true,
}));

vi.mock('@/lib/stripe/webhook/ordini', () => ({
  handleCheckoutCompleted: (s: unknown) => gestori.checkoutCompletato(s as never),
  handleCheckoutExpired: (s: unknown) => gestori.checkoutScaduto(s as never),
}));
vi.mock('@/lib/stripe/webhook/pagamenti', () => ({
  handlePaymentIntentFailed: (p: unknown) => gestori.pagamentoFallito(p as never),
  handlePaymentIntentSucceeded: vi.fn(async () => {}),
}));
vi.mock('@/lib/stripe/webhook/giftcard', () => ({ handleGiftCardPurchase: vi.fn(async () => {}) }));
vi.mock('@/lib/stripe/webhook/sponsorizzati', () => ({ handleSponsoredPurchase: vi.fn(async () => {}) }));
vi.mock('@/lib/stripe/webhook/abbonamenti', () => ({
  handleSellerSubscription: vi.fn(async () => {}),
  handleSubscriptionChanged: vi.fn(async () => {}),
  handleInvoicePaymentFailed: vi.fn(async () => {}),
}));
vi.mock('@/lib/stripe/webhook/rimborsi', () => ({
  handleChargeRefunded: vi.fn(async () => {}),
  handleRefundUpdated: vi.fn(async () => {}),
}));
vi.mock('@/lib/stripe/webhook/dispute', () => ({
  handleDisputeCreated: vi.fn(async () => {}),
  handleDisputeClosed: vi.fn(async () => {}),
}));
vi.mock('@/lib/stripe/webhook/trasferimenti', () => ({
  handleTransferReversed: vi.fn(async () => {}),
  handlePayoutFailed: vi.fn(async () => {}),
  handleAccountUpdated: vi.fn(async () => {}),
}));

/** L'UPDATE su stripe_event_log serve a tre cose: rivendicare, liberare il
 *  turno e marcare come lavorato. Le raccogliamo tutte, in ordine. */
function catenaUpdate(patch: Record<string, unknown>) {
  stato.aggiornamenti.push(patch);
  const catena: Record<string, unknown> = {
    eq: () => catena,
    or: () => catena,
    select: () => Promise.resolve({ data: stato.rivendicate, error: null }),
    then: (risolvi: (v: unknown) => unknown) => risolvi({ error: null }),
  };
  return catena;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'stripe_event_log') {
        return {
          insert: () => Promise.resolve(stato.esitoInsert),
          update: catenaUpdate,
        };
      }
      return {
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  })),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function richiesta(): never {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
    body: '{}',
  }) as never;
}

const marcature = () => stato.aggiornamenti.filter((u) => 'processed' in u);
const liberazioni = () => stato.aggiornamenti.filter((u) => u.claimed_at === null);

beforeEach(() => {
  vi.clearAllMocks();
  stato.evento = { id: 'evt_1', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_1' } } };
  stato.esitoInsert = { error: null };
  stato.rivendicate = [{ event_id: 'evt_1' }];
  stato.aggiornamenti = [];
});

describe('quando il registro degli eventi non risponde, il webhook si ferma', () => {
  it('IL CASO CHE ROMPEVA — errore diverso dal doppione: nessun gestore parte', async () => {
    // Una colonna che in produzione non c'è ancora, o un intoppo del database:
    // prima si tirava dritto e l'evento veniva lavorato senza guardiano.
    stato.esitoInsert = { error: { code: '42703', message: 'column "claimed_at" does not exist' } };

    const res = await POST(richiesta());

    expect(
      gestori.pagamentoFallito,
      'l evento è stato lavorato senza guardiano anti-doppione: una riconsegna di Stripe lo rifà da capo',
    ).not.toHaveBeenCalled();
    expect(res.status, 'con 2xx Stripe considera la consegna riuscita e non ritenta').toBeGreaterThanOrEqual(500);
    expect(marcature(), 'marcato come lavorato un evento che non è stato lavorato').toHaveLength(0);
  });

  it('il doppione vero resta trattato come prima: 200 e nessun lavoro', async () => {
    stato.esitoInsert = { error: { code: '23505' } };
    stato.rivendicate = []; // un altra consegna ha già il turno in mano
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect((await res.json()).duplicated).toBe(true);
    expect(gestori.pagamentoFallito).not.toHaveBeenCalled();
  });
});

describe('quando il gestore fallisce, il turno torna libero', () => {
  it('IL CASO CHE ROMPEVA — gestore in errore: la riconsegna deve poter lavorare', async () => {
    // Prima la riga restava con il turno fresco e `processed = false`: la
    // riconsegna di Stripe entro cinque minuti riceveva «già visto» con 200 e
    // l evento spariva. Su un pagamento riuscito vuol dire cliente addebitato
    // e ordine mai nato.
    gestori.pagamentoFallito.mockRejectedValueOnce(new Error('database irraggiungibile'));

    const res = await POST(richiesta());

    expect(res.status, 'Stripe deve vedere un errore per ritentare').toBe(500);
    expect(
      liberazioni(),
      'il turno è rimasto preso: la riconsegna entro cinque minuti riceve «già visto» e l evento si perde',
    ).toHaveLength(1);
    expect(marcature(), 'un evento fallito non va marcato come lavorato').toHaveLength(0);
  });

  it('se il gestore riesce, il turno NON viene liberato e l evento risulta lavorato', async () => {
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(liberazioni()).toHaveLength(0);
    expect(marcature()).toHaveLength(1);
  });
});

describe('la sessione completata ma non pagata è uno stato finale', () => {
  it('IL CASO CHE ROMPEVA — resta a verbale come chiusa, non come turno preso per sempre', async () => {
    // Usciva con 200 lasciando la riga `processed = false` e rivendicata: un
    // residuo permanente che rende falsa qualunque conta degli eventi non
    // lavorati.
    stato.evento = {
      id: 'evt_np',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'unpaid', metadata: {} } },
    };

    const res = await POST(richiesta());

    expect(res.status).toBe(200);
    expect((await res.json()).nonPagata).toBe(true);
    expect(gestori.checkoutCompletato, 'ordine creato su una sessione non pagata').not.toHaveBeenCalled();
    expect(
      marcature(),
      'la riga resta rivendicata e non lavorata per sempre: gli eventi arretrati non si possono più contare',
    ).toHaveLength(1);
  });
});

describe('i pagamenti asincroni', () => {
  it('IL CASO CHE ROMPEVA — bonifico arrivato dopo: l ordine deve nascere', async () => {
    // Finiva nel ramo `default`, cioè in una riga di log: soldi incassati e
    // nessun ordine, senza nessun errore che lo dica.
    stato.evento = {
      id: 'evt_async_ok',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_async', payment_status: 'paid', metadata: {} } },
    };

    const res = await POST(richiesta());

    expect(res.status).toBe(200);
    expect(
      gestori.checkoutCompletato,
      'il pagamento è arrivato e l ordine non è stato creato da nessuno',
    ).toHaveBeenCalledTimes(1);
  });

  it('bonifico non arrivato: merce e codice sconto tornano disponibili', async () => {
    stato.evento = {
      id: 'evt_async_ko',
      type: 'checkout.session.async_payment_failed',
      data: { object: { id: 'cs_async_ko', payment_status: 'unpaid', metadata: {} } },
    };

    const res = await POST(richiesta());

    expect(res.status).toBe(200);
    expect(
      gestori.checkoutScaduto,
      'la riserva di merce e il codice sconto restano bloccati su un pagamento mai arrivato',
    ).toHaveBeenCalledTimes(1);
  });
});
