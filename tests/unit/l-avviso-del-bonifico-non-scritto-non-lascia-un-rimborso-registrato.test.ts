import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R82 — UN RIMBORSO DEI CONTANTI E' REGISTRATO SOLO SE L'AVVISO A CHI PAGA E' SCRITTO.
 *
 * Senza la lista dei bonifici (decisione di Nicola del 17/10/2026), l'avviso agli amministratori
 * «💶 Bonifico di rimborso da fare» e' l'unico promemoria del debito. Se il rimborso si registrava e
 * l'avviso no, il cliente aspettava soldi che nessuno sapeva di dovergli. Adesso i passi del ramo
 * dei contanti stanno tutti nello stesso blocco, in quest'ordine:
 *   prenotazione → segno del bonifico con lo stato del pagamento → avviso → credito MyCity (ultimo)
 * e se uno cade, quelli fatti prima tornano indietro: «rimborso registrato» vuol dire segno, stato,
 * avviso (e credito), oppure niente.
 *
 * La variante scomoda e' l'ordine misto (20 € di credito, 30 in contanti): se il credito usciva prima
 * dell'avviso e l'avviso cadeva, il negozio poteva respingere il reso e la cliente teneva 20 € di
 * credito su un rimborso che non c'era.
 *
 * Girano le rotte VERE e la `refundOrder` VERA; finti il database, Stripe, l'autenticazione e la posta.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia' }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { refundOrder } from '@/lib/stripe/payout';
import { sendEmail } from '@/lib/email/client';
import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';
import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const NON_PARTITO = "Il rimborso non è partito: riprova o scrivi all'assistenza.";
const CADUTA = { code: '57014', message: 'canceling statement due to statement timeout' };
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** 40 € pagati in contanti al fattorino, consegnato e incassato ieri. */
function inContanti(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    ...extra,
  };
}

/** 50 €: 20 pagati col credito MyCity, 30 in contanti incassati. */
const misto = () => inContanti({ total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500 });

function apri(ordine: Riga, amministratori: Riga[] = [{ id: 'admin-1', role: 'admin' }]) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    returns: [],
    order_items: [],
    disputes: [{ id: 'd1', status: 'open', order_id: ORDINE, opener_id: 'giulia', against_id: 'negozio' }],
    profiles: [...amministratori, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
}

const ordine = () => finto.db.tabelle.orders[0];
const reso = () => finto.db.tabelle.returns[0];
const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
const storni = () => finto.db.rpc.filter((c) => c.nome === 'storna_rimborso');

/** Il rimborso non ha lasciato niente di registrato: ne' soldi prenotati, ne' segno, ne' avviso. */
function nienteRegistrato() {
  expect(ordine().refunded_amount_cents, 'la prenotazione e rimasta: il rimborso risulta fatto').toBe(0);
  expect(String(ordine().stripe_refund_id ?? ''), 'il segno del bonifico e rimasto sull ordine').not.toContain('bonifico:');
  expect(ordine().payment_status, 'l ordine risulta rimborsato senza un bonifico chiesto').toBe('PAID');
  expect(avvisi(), 'resta chiesto un bonifico per un rimborso che non c e').toHaveLength(0);
}

async function apriIlReso(): Promise<string> {
  finto.utente = 'giulia';
  const res = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED' })), undefined,
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

async function negozio(rotta: unknown, id: string, corpo: unknown) {
  finto.utente = 'negozio';
  const res = await (rotta as Rotta)(new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) });
  return { status: res.status, corpo: await res.json() };
}

beforeEach(() => apri(inContanti()));

describe('l avviso non si scrive: il rimborso non e registrato', () => {
  it('IL CASO — refundOrder lancia, la prenotazione torna indietro, niente segno e niente stato', async () => {
    finto.db.guasti.notificheCadono = CADUTA;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(storni()).toHaveLength(1);
    nienteRegistrato();
  });

  it('decide: il reso torna da decidere, il negozio legge «non è partito», e al secondo tentativo tutto una volta', async () => {
    const id = await apriIlReso();
    finto.db.guasti.notificheCadono = CADUTA;

    const primo = await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 });

    expect(primo.status).toBe(502);
    expect(primo.corpo.error.message).toBe(NON_PARTITO);
    expect(reso().status).toBe('REQUESTED');
    nienteRegistrato();

    finto.db.guasti.notificheCadono = null;
    const secondo = await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 });

    expect(secondo.status, JSON.stringify(secondo.corpo)).toBe(200);
    expect(avvisi()).toHaveLength(1);
    expect(ordine()).toMatchObject({
      payment_status: 'REFUNDED', refunded_amount_cents: 4000, stripe_refund_id: `bonifico:4000:return_${id}`,
    });
  });

  it('l avviso si scrive ma la risposta si perde: si toglie, e il secondo tentativo lo scrive una volta', async () => {
    finto.db.guasti.notificheScrivonoPoiCadono = true;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow();
    nienteRegistrato();

    await refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' });
    expect(avvisi()).toHaveLength(1);
    expect(ordine().payment_status).toBe('REFUNDED');
  });

  it('il segno del bonifico non si scrive sull ordine: niente avviso, niente stato, prenotazione tornata', async () => {
    finto.db.guasti.segnoDelBonificoCade = CADUTA;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(storni()).toHaveLength(1);
    nienteRegistrato();
  });

  it('nessun amministratore a cui mandarlo: il rimborso non parte (non resta un debito che nessuno legge)', async () => {
    apri(inContanti(), []);

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow(/nessun amministratore/u);

    expect(storni()).toHaveLength(1);
    nienteRegistrato();
  });
});

describe('ordine misto: il credito MyCity esce per ultimo', () => {
  beforeEach(() => apri(misto()));

  it('l avviso cade: il credito non esce, e il negozio che poi respinge il reso non lascia credito a nessuno', async () => {
    const id = await apriIlReso();
    finto.db.guasti.notificheCadono = CADUTA;

    const primo = await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 5000 });
    expect(primo.status).toBe(502);
    expect(finto.db.rpc.some((c) => c.nome === 'wallet_credit'), 'il credito e uscito prima dell avviso').toBe(false);

    finto.db.guasti.notificheCadono = null;
    const respinto = await negozio(decidi, id, { decision: 'REJECTED', notes: 'merce integra' });
    expect(respinto.status).toBe(200);
    expect(creditoDi(finto.db, 'giulia'), 'reso respinto e la cliente tiene il credito').toBe(0);
    nienteRegistrato();
  });

  it('il credito cade dopo l avviso: l avviso si toglie, il segno pure, la prenotazione torna', async () => {
    finto.db.guasti.walletCredit = CADUTA;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(creditoDi(finto.db, 'giulia')).toBe(0);
    nienteRegistrato();

    // Il ritentativo con il database sano: tutto una volta.
    finto.db.guasti.walletCredit = null;
    await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' });
    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    expect(avvisi()).toHaveLength(1);
    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', stripe_refund_id: 'bonifico:3000:return_r1' });
  });

  it('il credito uscito al primo tentativo (risposta persa, diario muto) non si ripete al secondo, e la cifra torna', async () => {
    finto.db.guasti.walletCreditaPoiCade = true;
    finto.db.guasti.diarioIlleggibile = 1;
    await expect(refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' })).rejects.toThrow();
    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    expect(avvisi()).toHaveLength(0);

    const esito = await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_r1' });

    expect(esito).toMatchObject({ creditoCents: 2000, bonificoCents: 3000 });
    expect(creditoDi(finto.db, 'giulia'), 'credito dato due volte').toBe(2000);
    expect(avvisi()).toHaveLength(1);
  });
});

/**
 * Collaudo del 17/10 — LA SCRITTURA DEL SEGNO ARRIVA, LA RISPOSTA SI PERDE.
 *
 * Il passo che torna indietro toglieva il segno solo se la risposta era arrivata. Con la
 * risposta persa restavano sull'ordine il segno, «rimborsato» e la partita del negozio chiusa,
 * con la prenotazione stornata e nessun avviso. Al «riprova» che la rotta stessa chiede, `avanza`
 * trovava il segno e registrava il reso come rimborsato senza chiedere il bonifico a nessuno.
 */
describe('il segno arriva sull ordine ma la risposta si perde: si toglie lo stesso', () => {
  it('refundOrder lancia e sull ordine non resta niente, nemmeno la partita del negozio chiusa', async () => {
    finto.db.guasti.segnoDelBonificoScrittoPoiCade = true;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    nienteRegistrato();
    expect(ordine().payout_status, 'il negozio non verrebbe piu pagato').toBe('AWAITING_REMITTANCE');
  });

  it('avanza cade e il negozio riprova come gli dice la rotta: il bonifico si chiede davvero, una volta', async () => {
    const id = await apriIlReso();
    expect((await negozio(decidi, id, { decision: 'APPROVED' })).status).toBe(200);
    expect((await negozio(avanza, id, { stato: 'RECEIVED' })).status).toBe(200);
    vi.mocked(sendEmail).mockClear();
    finto.db.guasti.segnoDelBonificoScrittoPoiCade = true;

    const primo = await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 4000 });
    expect(primo.status).toBe(502);
    expect(primo.corpo.error.message).toBe(NON_PARTITO);
    nienteRegistrato();

    const secondo = await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 4000 });

    expect(secondo.status, JSON.stringify(secondo.corpo)).toBe(200);
    expect(reso().status).toBe('REFUNDED');
    expect(avvisi(), 'reso rimborsato e nessun amministratore sa del bonifico da fare').toHaveLength(1);
    expect(ordine()).toMatchObject({
      payment_status: 'REFUNDED', refunded_amount_cents: 4000, stripe_refund_id: `bonifico:4000:return_${id}`,
    });
    const alCliente = vi.mocked(sendEmail).mock.calls.filter(([m]) => m.to === 'giulia@esempio.it');
    expect(alCliente, 'al cliente non e partita l email che chiede l IBAN').toHaveLength(1);
  });

  it('decide cade e il negozio respinge il reso: l ordine resta pagato e il negozio resta da pagare', async () => {
    const id = await apriIlReso();
    finto.db.guasti.segnoDelBonificoScrittoPoiCade = true;
    expect((await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 })).status).toBe(502);

    expect((await negozio(decidi, id, { decision: 'REJECTED', notes: 'merce integra' })).status).toBe(200);

    nienteRegistrato();
    expect(ordine().payout_status).toBe('AWAITING_REMITTANCE');
  });

  it('decide cade e il negozio chiude il reso «senza rimborso»: puo, perche nessun rimborso e partito', async () => {
    const id = await apriIlReso();
    finto.db.guasti.segnoDelBonificoScrittoPoiCade = true;
    expect((await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 })).status).toBe(502);

    const chiudi = await negozio(avanza, id, { stato: 'CANCELED', note: 'il cliente ha ritirato il reso' });

    expect(chiudi.status, JSON.stringify(chiudi.corpo)).toBe(200);
  });

  it('decide cade e il negozio riprova con 30 € invece di 40: sull ordine resta un segno solo, quello vero', async () => {
    const id = await apriIlReso();
    finto.db.guasti.segnoDelBonificoScrittoPoiCade = true;
    expect((await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 4000 })).status).toBe(502);

    expect((await negozio(decidi, id, { decision: 'APPROVED', refundAmountCents: 3000 })).status).toBe(200);

    expect(ordine().stripe_refund_id).toBe(`bonifico:3000:return_${id}`);
    expect(avvisi()).toHaveLength(1);
  });
});

describe('un tentativo che cade non toglie quello che non ha scritto lui', () => {
  it('il segno di un rimborso registrato prima, con la stessa chiave, resta col suo avviso', async () => {
    apri(misto());
    await refundOrder({ orderId: ORDINE, amountCents: 1000, idempotencyKey: 'return_r1' });
    expect(ordine().stripe_refund_id).toBe('bonifico:600:return_r1');

    // Lo stesso rimborso chiesto di nuovo cade sul credito, e il diario non risponde.
    finto.db.guasti.walletCredit = { message: 'FetchError: socket hang up' };
    finto.db.guasti.diarioIlleggibile = 1;
    await expect(refundOrder({ orderId: ORDINE, amountCents: 1000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(ordine()).toMatchObject({
      stripe_refund_id: 'bonifico:600:return_r1', refunded_amount_cents: 1000, payment_status: 'PARTIALLY_REFUNDED',
    });
    expect(avvisi(), 'il bonifico registrato prima non lo ricorda piu nessuno').toHaveLength(1);
    expect(creditoDi(finto.db, 'giulia')).toBe(400);
  });
});

/**
 * Collaudo del 17/10 — DUE RIMBORSI SULLO STESSO ORDINE, IL PRIMO CADE.
 *
 * Il passo che torna indietro rimetteva lo stato del pagamento letto all'inizio («pagato»)
 * sopra quello scritto da un altro rimborso andato a buon fine nel frattempo: un bonifico
 * registrato, col suo segno e il suo avviso, su un ordine che diceva «pagato».
 */
describe('due rimborsi sullo stesso ordine, il primo cade: lo stato del secondo resta', () => {
  it('tutto in contanti: l avviso del reso cade mentre il reclamo va a termine e crede di chiudere l ordine', async () => {
    const from0 = finto.db.client.from;
    let colpo = true;
    finto.db.client.from = ((tabella: string) => {
      const q = from0(tabella) as unknown as Record<string, (v: unknown) => unknown>;
      if (tabella !== 'notifications') return q;
      const inserisci = q.insert.bind(q);
      q.insert = (v: unknown) => {
        const righe = (Array.isArray(v) ? v : [v]) as Riga[];
        if (colpo && righe.some((r) => String(r.body ?? '').includes('reso R1'))) {
          colpo = false;
          // Nel frattempo il reclamo fa tutto il suo giro; poi l'avviso del reso cade.
          return refundOrder({ orderId: ORDINE, amountCents: 3000, idempotencyKey: 'dispute_d1' })
            .then(() => ({ data: null, error: CADUTA }));
        }
        return inserisci(v);
      };
      return q;
    }) as unknown as typeof from0;

    await expect(refundOrder({ orderId: ORDINE, amountCents: 1000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    // 30 € su 40 restano rimborsati: il reclamo, che contava anche i 10 € del reso, aveva
    // chiuso la partita del negozio come se il rimborso fosse pieno.
    expect(ordine()).toMatchObject({
      stripe_refund_id: 'bonifico:3000:dispute_d1', refunded_amount_cents: 3000,
      payment_status: 'PARTIALLY_REFUNDED', payout_status: 'AWAITING_REMITTANCE',
    });
    expect(avvisi()).toHaveLength(1);
  });

  it('ordine misto: il credito del reso cade mentre il reclamo va a termine', async () => {
    apri(misto());
    const rpc0 = finto.db.client.rpc;
    let colpo = true;
    finto.db.client.rpc = async (nome: string, args: Record<string, unknown> = {}) => {
      if (colpo && nome === 'wallet_credit' && args.p_ref === 'return_r1') {
        colpo = false;
        await refundOrder({ orderId: ORDINE, amountCents: 3000, idempotencyKey: 'dispute_d1' });
        return { data: null, error: CADUTA };
      }
      return rpc0(nome, args);
    };

    await expect(refundOrder({ orderId: ORDINE, amountCents: 1000, idempotencyKey: 'return_r1' })).rejects.toThrow();

    expect(ordine()).toMatchObject({
      stripe_refund_id: 'bonifico:1800:dispute_d1', refunded_amount_cents: 3000, payment_status: 'PARTIALLY_REFUNDED',
    });
    expect(creditoDi(finto.db, 'giulia')).toBe(1200);
    expect(avvisi()).toHaveLength(1);
  });
});

describe('avanza e resolve: chi ha premuto legge una frase, mai l errore grezzo', () => {
  it('avanza: l avviso cade → 502 «non è partito», il reso torna «ricevuto», niente registrato', async () => {
    const id = await apriIlReso();
    expect((await negozio(decidi, id, { decision: 'APPROVED' })).status).toBe(200);
    expect((await negozio(avanza, id, { stato: 'RECEIVED' })).status).toBe(200);
    finto.db.guasti.notificheCadono = CADUTA;

    const rimborsato = await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 4000 });

    expect(rimborsato.status).toBe(502);
    expect(rimborsato.corpo.error.message).toBe(NON_PARTITO);
    expect(JSON.stringify(rimborsato.corpo)).not.toContain('[stripe]');
    expect(reso().status).toBe('RECEIVED');
    nienteRegistrato();
  });

  it('avanza: un credito gia uscito con un altra cifra → 409 con la cifra, come decide', async () => {
    apri(misto());
    const id = await apriIlReso();
    expect((await negozio(decidi, id, { decision: 'APPROVED' })).status).toBe(200);
    expect((await negozio(avanza, id, { stato: 'RECEIVED' })).status).toBe(200);
    finto.db.guasti.walletCreditaPoiCade = true;
    finto.db.guasti.diarioIlleggibile = 1;
    expect((await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 5000 })).status).toBe(502);

    finto.db.guasti.walletCredit = { message: 'FetchError: socket hang up' };
    const diverso = await negozio(avanza, id, { stato: 'REFUNDED', refundAmountCents: 3000 });

    expect(diverso.status).toBe(409);
    expect(diverso.corpo.error.message).toContain('20,00');
  });

  it('resolve: l avviso cade → 502 «non è partito», il reclamo resta aperto, niente registrato', async () => {
    finto.db.guasti.notificheCadono = CADUTA;

    const res = await (risolvi as unknown as Rotta)(
      new Request('http://localhost/api/admin/disputes/d1/resolve', json({
        status: 'resolved_buyer', notes: 'Merce arrivata rotta: rimborso al cliente.', refundCents: 4000,
      })),
      { params: Promise.resolve({ id: 'd1' }) },
    );
    const corpo = await res.json();

    expect(res.status).toBe(502);
    expect(corpo.error.message).toBe(NON_PARTITO);
    expect(JSON.stringify(corpo)).not.toContain('[stripe]');
    expect(finto.db.tabelle.disputes[0].status).toBe('open');
    nienteRegistrato();
  });
});
