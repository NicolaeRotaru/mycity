import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R82 — SE UN RIMBORSO IN CONTANTI SI INCEPPA A META', SI DEVE POTER RIFARE.
 *
 * La funzione dei rimborsi prima «prenota» l'importo sull'ordine
 * (`accumula_rimborso`), poi muove i soldi. Il ramo della carta, se qualcosa
 * cadeva dopo la prenotazione, la restituiva. Il ramo dei contanti no, e in piu'
 * riprendeva la quota al negozio PRIMA di accreditare il cliente, fuori da ogni
 * protezione.
 *
 * Il caso della scheda: una cliente paga 20 € in contanti, il pane e'
 * ammuffito, il negozio approva il reso. Il database va in timeout
 * sull'accredito. (17/10/2026: i contanti tornano col bonifico e il credito
 * MyCity solo per la parte pagata col credito; qui il pane e' pagato meta' col
 * credito, cosi' l'accredito c'e' ancora, e viene per ULTIMO: dopo il segno del
 * bonifico e dopo l'avviso, che se l'accredito cade se ne vanno.) Il sito risponde «rimborso fallito» e rimette il reso in
 * attesa; il negozio riprova e legge «questo ordine e' gia' stato rimborsato per
 * intero». La cliente non ha ricevuto niente, il negozio ha gia' restituito la
 * sua quota, e nessuna strada del sito puo' piu' emettere quel rimborso.
 *
 * Gira la `refundOrder` VERA (e, in fondo, la rotta VERA della decisione sul
 * reso); finti solo il database, Stripe, l'autenticazione e la posta.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

const createReversal = vi.fn(async () => ({ id: 'trr_1' }));
const stornoAlNegozio = { cade: false };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: {
      createReversal: async (...a: unknown[]) => {
        if (stornoAlNegozio.cade) throw new Error('Stripe non risponde');
        return (createReversal as unknown as (...x: unknown[]) => Promise<unknown>)(...a);
      },
    },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'fornaio' }, req, params: (await ctx?.params) ?? {} }),
}));

import { refundOrder } from '@/lib/stripe/payout';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';

/**
 * Il pane: 20 €, 10 pagati col credito MyCity e 10 in contanti, consegnato, e il negozio GIA'
 * pagato con il bonifico dei contanti. Un rimborso pieno: 10 € di credito e 10 col bonifico.
 */
function pane(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'cliente', seller_id: 'fornaio',
    total_price: 10, gross_total_cents: 2000, wallet_applied_cents: 1000,
    seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
    payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1', stripe_reversal_id: null,
    stripe_payment_intent: null, refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    ...extra,
  };
}

const ordine = () => finto.db.tabelle.orders[0];
const SEGNO = 'bonifico:1000:return_r1';
const avvisiDelBonifico = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');

beforeEach(() => {
  stornoAlNegozio.cade = false;
  createReversal.mockClear();
  finto.db = creaFintoDatabase({
    orders: [pane()],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'fornaio', role: 'seller' }],
    notifications: [],
    returns: [{
      id: 'r1', order_id: 'o1', buyer_id: 'cliente', seller_id: 'fornaio', reason: 'DAMAGED',
      status: 'REQUESTED', refund_amount_cents: null, created_at: '2026-10-11T09:00:00Z',
    }],
  });
});

describe('l accredito sul portafoglio cade', () => {
  it('IL CASO CHE ROMPEVA — la prenotazione torna indietro: l ordine non risulta rimborsato', async () => {
    finto.db.guasti.walletCredit = { code: '57014', message: 'canceling statement due to statement timeout' };

    await expect(refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' }))
      .rejects.toThrow();

    expect(ordine().refunded_amount_cents, 'risulta rimborsato un ordine per cui la cliente non ha avuto niente').toBe(0);
    expect(creditoDi(finto.db, 'cliente')).toBe(0);
    // E il bonifico non resta chiesto: via l'avviso, via il segno, lo stato di prima.
    expect(avvisiDelBonifico(), 'chi amministra paga un bonifico per un rimborso tornato indietro').toHaveLength(0);
    expect(String(ordine().stripe_refund_id ?? '')).not.toContain('bonifico:');
    expect(ordine().payment_status).toBe('PAID');
  });

  it('e il negozio non ha restituito niente per un rimborso che non c e stato', async () => {
    finto.db.guasti.walletCredit = { code: '57014', message: 'timeout' };

    await expect(refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' }))
      .rejects.toThrow();

    expect(createReversal, 'al negozio sono stati ripresi 18 € prima che la cliente ricevesse qualcosa').not.toHaveBeenCalled();
    expect(ordine().seller_payout_reversed_cents).toBe(0);
    expect(ordine().payout_status).toBe('TRANSFERRED');
  });

  it('il secondo tentativo funziona, e accredita una volta sola', async () => {
    finto.db.guasti.walletCredit = { code: '57014', message: 'timeout' };
    await expect(refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' }))
      .rejects.toThrow();

    finto.db.guasti.walletCredit = null;
    const esito = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

    expect(esito.refundId).toBe(SEGNO);
    expect(creditoDi(finto.db, 'cliente')).toBe(1000);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 2000, payment_status: 'REFUNDED', payout_status: 'REVERSED' });
    expect(ordine().stripe_refund_id).toBe(SEGNO);
    expect(avvisiDelBonifico()).toHaveLength(1);
    expect(createReversal).toHaveBeenCalledTimes(1);
  });
});

/**
 * Collaudo del 15/10, secondo giro — LA RISPOSTA PERSA ARRIVA COME UN ERRORE.
 * Il database scrive l'accredito e a noi arriva «socket hang up». Prima ci si
 * fidava dell'errore: la prenotazione tornava indietro e il reso tornava «da
 * decidere» con la cliente gia' accreditata — il negozio poteva perfino
 * rifiutarlo, e lei teneva il credito su un ordine rimborsato per 0. Adesso il
 * primo tentativo guarda il diario, vede l'accredito e va in fondo.
 */
describe('l accredito riesce ma la risposta si perde (la variante scomoda)', () => {
  for (const comeLa143 of [false, true]) {
    it(`il primo tentativo se ne accorge dal diario e chiude il rimborso, una volta sola (${comeLa143 ? 'dopo' : 'prima della'} 143)`, async () => {
      finto.db.comeLa143 = comeLa143;
      finto.db.guasti.walletCreditaPoiCade = true;

      const esito = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

      expect(esito.refundId).toBe(SEGNO);
      expect(creditoDi(finto.db, 'cliente')).toBe(1000);
      expect(ordine(), 'la cliente ha il credito e l ordine dice «non rimborsato»').toMatchObject({
        refunded_amount_cents: 2000, payment_status: 'REFUNDED',
      });
      expect(createReversal, 'la quota del negozio deve rientrare, una volta').toHaveBeenCalledTimes(1);

      // Un ritentativo non accredita di nuovo e non registra niente in piu'.
      await expect(refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' }))
        .rejects.toThrow();
      expect(creditoDi(finto.db, 'cliente'), 'credito accreditato due volte').toBe(1000);
      expect(ordine().refunded_amount_cents).toBe(2000);
      expect(avvisiDelBonifico(), 'il bonifico chiesto due volte').toHaveLength(1);
    });

    it(`se anche il diario non si legge si torna indietro, e il secondo tentativo chiude una volta sola (${comeLa143 ? 'dopo' : 'prima della'} 143)`, async () => {
      finto.db.comeLa143 = comeLa143;
      finto.db.guasti.walletCreditaPoiCade = true;
      finto.db.guasti.diarioIlleggibile = 1;
      await expect(refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' }))
        .rejects.toThrow();
      expect(creditoDi(finto.db, 'cliente')).toBe(1000);
      expect(ordine().refunded_amount_cents).toBe(0);
      expect(avvisiDelBonifico()).toHaveLength(0);

      const esito = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

      expect(creditoDi(finto.db, 'cliente'), 'credito accreditato due volte').toBe(1000);
      expect(esito.refundId).toBe(SEGNO);
      expect(avvisiDelBonifico()).toHaveLength(1);
      expect(ordine()).toMatchObject({ refunded_amount_cents: 2000, payment_status: 'REFUNDED' });
      expect(createReversal, 'la quota del negozio deve rientrare, una volta').toHaveBeenCalledTimes(1);
    });
  }
});

/**
 * Collaudo del 15/10 — LA VARIANTE CON L'IMPORTO CAMBIATO. La chiave dei resi
 * (`return_<id>`) non porta l'importo. Il primo tentativo accredita 10 € e
 * perde la risposta, e il diario in quel momento non si legge: la prenotazione
 * torna indietro e il negozio riprova con 15 € (7,50 di credito). Il portafoglio
 * riconosce la chiave e non accredita di nuovo, ma la funzione registrava il
 * rimborso nuovo mentre la cliente aveva avuto il credito del primo.
 */
describe('risposta persa, e il negozio riprova con un importo diverso', () => {
  for (const comeLa143 of [false, true]) {
    it(`si ferma e dice quanto e gia uscito, invece di registrare un'altra cifra (${comeLa143 ? 'dopo' : 'prima della'} 143)`, async () => {
      finto.db.comeLa143 = comeLa143;
      finto.db.guasti.walletCreditaPoiCade = true;
      finto.db.guasti.diarioIlleggibile = 1;
      await expect(refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' }))
        .rejects.toThrow();
      expect(creditoDi(finto.db, 'cliente')).toBe(1000);

      const diverso = refundOrder({ orderId: 'o1', amountCents: 1500, idempotencyKey: 'return_r1' });
      await expect(diverso).rejects.toThrow(/già accreditato/);

      expect(ordine().refunded_amount_cents, 'registrato 15 € mentre la cliente ha avuto il credito dei 20').toBe(0);
      expect(creditoDi(finto.db, 'cliente'), 'accreditato una seconda volta').toBe(1000);
      expect(createReversal, 'al negozio e stata ripresa una quota su una cifra sbagliata').not.toHaveBeenCalled();
      expect(avvisiDelBonifico(), 'resta chiesto un bonifico per un rimborso fermato').toHaveLength(0);

      // Con l'importo del primo tentativo il rimborso va in fondo, una volta sola.
      const esito = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });
      expect(esito.importoCents).toBe(2000);
      expect(ordine()).toMatchObject({ refunded_amount_cents: 2000, payment_status: 'REFUNDED' });
      expect(creditoDi(finto.db, 'cliente')).toBe(1000);
    });
  }
});

describe('lo storno della quota al negozio cade, a cliente gia accreditato', () => {
  it('il rimborso arriva in fondo, e il recupero diventa un lavoro dichiarato', async () => {
    stornoAlNegozio.cade = true;

    const esito = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

    expect(esito.refundId).toBe(SEGNO);
    expect(creditoDi(finto.db, 'cliente')).toBe(1000);
    expect(ordine().payment_status).toBe('REFUNDED');
    expect(ordine().payout_status, 'nessuno sa che i 18 € del negozio vanno ripresi a mano').toBe('REVERSAL_FAILED');
    expect(notificheConTitolo(finto.db, 'Storno al venditore non riuscito')).toHaveLength(1);
  });
});

describe('dalla parte del negozio: la decisione sul reso si puo rifare', () => {
  function decisione() {
    const req = new Request('http://localhost/api/returns/r1/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED', refundAmountCents: 2000 }),
    });
    return decidi(req as never, { params: Promise.resolve({ id: 'r1' }) });
  }

  function decisioneCon(corpo: Record<string, unknown>) {
    const req = new Request('http://localhost/api/returns/r1/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    return decidi(req as never, { params: Promise.resolve({ id: 'r1' }) });
  }

  it('IL CASO DEL COLLAUDO — risposta persa: il reso si chiude rimborsato, e il negozio non lo puo piu rifiutare', async () => {
    finto.db.guasti.walletCreditaPoiCade = true;

    const primo = await decisioneCon({ decision: 'APPROVED', refundAmountCents: 2000 });
    const corpo = await primo.json();

    expect(primo.status, `il negozio legge: ${JSON.stringify(corpo)}`).toBe(200);
    expect(creditoDi(finto.db, 'cliente')).toBe(1000);
    expect(finto.db.tabelle.returns[0]).toMatchObject({ status: 'REFUNDED', refund_id: SEGNO });
    expect(ordine().refunded_amount_cents, 'la cliente ha 10 € di credito e l ordine risulta rimborsato per 0').toBe(2000);

    const rifiuto = await decisioneCon({ decision: 'REJECTED' });
    expect(rifiuto.status, 'un reso gia rimborsato si rifiuta: la cliente tiene il credito e il negozio la quota').toBe(409);
    expect(finto.db.tabelle.returns[0].status).toBe('REFUNDED');
  });

  it('guasto doppio e cifra cambiata: il negozio legge quanto e gia uscito, non «riprova»', async () => {
    finto.db.guasti.walletCreditaPoiCade = true;
    finto.db.guasti.diarioIlleggibile = 1;
    const primo = await decisioneCon({ decision: 'APPROVED', refundAmountCents: 2000 });
    expect(primo.status).toBe(502);
    expect(finto.db.tabelle.returns[0].status).toBe('REQUESTED');

    const secondo = await decisioneCon({ decision: 'APPROVED', refundAmountCents: 1500 });
    const corpo = await secondo.json();

    expect(secondo.status).toBe(409);
    expect(corpo.error.message, 'il negozio non sa quale cifra rimettere').toContain('già accreditato');
    expect(corpo.error.message).toContain('10,00');
    expect(finto.db.tabelle.returns[0].status).toBe('REQUESTED');

    const terzo = await decisioneCon({ decision: 'APPROVED', refundAmountCents: 2000 });
    expect(terzo.status).toBe(200);
    expect(creditoDi(finto.db, 'cliente')).toBe(1000);
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(avvisiDelBonifico(), 'tre tentativi, un bonifico solo').toHaveLength(1);
  });

  it('IL CASO DELLA SCHEDA — primo tentativo fallito, il secondo rimborsa invece di dire «gia rimborsato»', async () => {
    finto.db.guasti.walletCredit = { code: '57014', message: 'timeout' };
    const primo = await decisione();
    expect(primo.status).toBe(502);
    expect(finto.db.tabelle.returns[0].status, 'il reso deve tornare decidibile').toBe('REQUESTED');

    finto.db.guasti.walletCredit = null;
    const secondo = await decisione();
    const corpo = await secondo.json();

    expect(secondo.status, `il negozio legge: ${JSON.stringify(corpo)}`).toBe(200);
    expect(corpo.status).toBe('REFUNDED');
    expect(creditoDi(finto.db, 'cliente')).toBe(1000);
    expect(finto.db.tabelle.returns[0]).toMatchObject({ status: 'REFUNDED', refund_id: SEGNO });
  });
});
