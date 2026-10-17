import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R71 · R25 — CHI PAGA IN CONTANTI RIAVE I SOLDI, CON UN BONIFICO FATTO A MANO.
 *
 * Il caso della scheda: Giulia paga 40 € in contanti al fattorino per un
 * maglione, lo restituisce entro 14 giorni, il negozio approva. Prima
 * `refundOrder` le accreditava 40 € di credito MyCity e basta, e l'email le
 * diceva «il rimborso arriverà sul tuo metodo di pagamento entro 5-10 giorni».
 *
 * Decisione di Nicola del 17/10/2026 («Semplifica»): i contanti tornano sempre
 * col bonifico, che fa a mano un amministratore. Il sito non chiede l'IBAN e non
 * lo salva: lo chiede l'email del rimborso, e il cliente risponde. Agli
 * amministratori arriva un avviso con tutto quello che serve per pagare, e la
 * stessa cosa per email alla casella dove arrivano le risposte. La parte pagata
 * col credito MyCity torna credito (lo stesso mezzo).
 *
 * Gira la `refundOrder` VERA e i modelli d'email VERI; finti solo il database,
 * Stripe e l'invio della posta.
 */

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  posta: [] as Array<{ to: string; subject: string; html: string; text: string; replyTo?: string }>,
}));

const refundsCreate = vi.fn(async () => ({ id: 're_1' }));
const createReversal = vi.fn(async () => ({ id: 'trr_1' }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ refunds: { create: refundsCreate }, transfers: { createReversal } }),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string; replyTo?: string }) => {
    finto.posta.push(m);
    return { ok: true };
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { refundOrder } from '@/lib/stripe/payout';
import { formatPriceFromCents } from '@/lib/format';
import { indirizzoContatto } from '@/lib/contatti-pubblici';

const ORDINE = 'a1b2c3d4-0000-4000-8000-000000000001';
const NUMERO = '#A1B2C3';
const CASELLA = indirizzoContatto('info');

/** Il maglione di Giulia: 40 € pagati al fattorino, consegnato e incassato ieri. */
function maglione(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: 'rider', rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 300, shipping_cost: 3,
    delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    ...extra,
  };
}

/** 50 € lordi: 20 pagati col credito MyCity, 30 in contanti incassati. */
const misto = () => maglione({ total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500 });

function apri(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    profiles: [{ id: 'admin-1', role: 'admin' }],
    notifications: [],
  });
  finto.db.email.giulia = 'giulia.rossi@esempio.it';
}

const ordine = () => finto.db.tabelle.orders[0];
const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
const allaCliente = () => finto.posta.filter((m) => m.to === 'giulia.rossi@esempio.it');
const allaCasella = () => finto.posta.filter((m) => m.to === CASELLA);

const rimborso = (extra: Record<string, unknown> = {}) =>
  refundOrder({ orderId: ORDINE, amountCents: 4000, idempotencyKey: 'return_f00dcafe-1', notifyBuyer: true, ...extra });

beforeEach(() => {
  finto.posta = [];
  refundsCreate.mockClear();
  createReversal.mockClear();
  apri(maglione());
});

describe('R71 — i contanti tornano col bonifico, mai come credito', () => {
  it('IL CASO CHE ROMPEVA — senza nessuna opzione il credito non arriva, arriva il bonifico', async () => {
    const esito = await rimborso({ reason: 'requested_by_customer' });

    expect(creditoDi(finto.db, 'giulia'), 'Giulia ha ricevuto credito MyCity al posto dei soldi').toBe(0);
    expect(finto.db.rpc.some((c) => c.nome === 'wallet_credit')).toBe(false);
    expect(esito).toMatchObject({ modo: 'bonifico', bonificoCents: 4000, creditoCents: 0, pieno: true });
    expect(esito.refundId).toBe('bonifico:4000:return_f00dcafe-1');
  });

  it('il segno del bonifico sta sull ordine insieme allo stato: «rimborsato» senza segno non esiste', async () => {
    await rimborso();

    expect(ordine()).toMatchObject({
      payment_status: 'REFUNDED', refunded_amount_cents: 4000, stripe_refund_id: 'bonifico:4000:return_f00dcafe-1',
    });
    const conLoStato = finto.db.scritture.filter((w) => w.tabella === 'orders' && 'payment_status' in w.valori);
    expect(conLoStato, 'lo stato del pagamento scritto da solo, senza il segno').toHaveLength(1);
    expect(conLoStato[0].valori.stripe_refund_id).toBe('bonifico:4000:return_f00dcafe-1');
  });

  it('l avviso agli amministratori dice cifra, ordine, email, causale, e porta a una pagina sola', async () => {
    await rimborso({ resoChiestoIl: '2026-10-03T10:00:00Z' });

    const [avviso] = avvisi();
    expect(avvisi()).toHaveLength(1);
    expect(avviso.title).toBe('💶 Bonifico di rimborso da fare');
    expect(avviso.link).toBe('/admin/orders');
    const testo = String(avviso.body);
    // La cifra come la legge chi paga: «40,00 €», non «40.00€».
    expect(testo).toContain(`Bonifico di ${formatPriceFromCents(4000)} da fare al cliente dell'ordine ${NUMERO}`);
    expect(testo).not.toContain('40.00');
    expect(testo).toContain('Prendi l\'IBAN solo da una risposta che arriva da giulia.rossi@esempio.it');
    expect(testo).toContain(`la risposta arriva a ${CASELLA}`);
    expect(testo).toContain('Se entro 3 giorni non risponde, scrivigli tu.');
    expect(testo).toContain(`«Rimborso MyCity ordine ${NUMERO} reso F00DCA»`);
    expect(testo).toContain("cerca questa causale nei movimenti del conto. Se c'è, è già pagato.");
    expect(testo).toContain('Il reso è stato chiesto il 3 ottobre 2026');
    expect(testo).toContain('il termine è il 17 ottobre 2026');
    expect(testo).toContain('Non dargli credito MyCity al posto dei soldi.');
    expect(testo, 'nell avviso non deve esserci un IBAN').not.toMatch(/IT\d{2}[A-Z0-9]{10,}/u);
  });

  it('lo stesso avviso arriva per email alla casella dove arrivano gli IBAN', async () => {
    await rimborso();

    expect(allaCasella()).toHaveLength(1);
    expect(allaCasella()[0].subject).toBe(`Bonifico di rimborso da fare — ordine ${NUMERO} — ${formatPriceFromCents(4000)}`);
    expect(allaCasella()[0].text).toBe(String(avvisi()[0].body));
  });

  it('se l email alla casella non parte, il rimborso resta registrato', async () => {
    const { sendEmail } = await import('@/lib/email/client');
    vi.mocked(sendEmail).mockImplementationOnce(async () => {
      throw new Error('Resend non risponde');
    });

    const esito = await rimborso();

    expect(esito.refundId).toBe('bonifico:4000:return_f00dcafe-1');
    expect(ordine().payment_status).toBe('REFUNDED');
    expect(avvisi()).toHaveLength(1);
  });

  it('ordine misto: il credito speso torna credito, l avviso dice solo i 30 € dei contanti', async () => {
    apri(misto());

    const esito = await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_f00dcafe-1', notifyBuyer: true });

    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    expect(finto.db.rpc.find((c) => c.nome === 'wallet_credit')?.args).toMatchObject({ p_cents: 2000, p_reason: 'cod_refund' });
    expect(esito).toMatchObject({ modo: 'misto', creditoCents: 2000, bonificoCents: 3000 });
    const testo = String(avvisi()[0].body);
    expect(testo).toContain(`Bonifico di ${formatPriceFromCents(3000)}`);
    expect(testo, 'l avviso fa bonificare anche la parte gia tornata come credito').not.toContain(formatPriceFromCents(5000));
    expect(testo).toContain(`altri ${formatPriceFromCents(2000)} gli sono già tornati come credito MyCity`);
  });

  it('un ordine pagato tutto col credito torna credito, e nessun avviso di bonifico', async () => {
    apri(maglione({ total_price: 0, wallet_applied_cents: 4000 }));

    const esito = await rimborso();

    expect(esito).toMatchObject({ modo: 'credito', bonificoCents: 0, refundId: 'wallet:return_f00dcafe-1' });
    expect(creditoDi(finto.db, 'giulia')).toBe(4000);
    expect(avvisi()).toHaveLength(0);
    expect(allaCasella()).toHaveLength(0);
  });
});

describe('chi e il cliente: l email si legge prima dei soldi', () => {
  it('la lettura cade: il rimborso non parte, niente prenotato e niente avviso', async () => {
    finto.db.guasti.utenteIlleggibile = { status: 500, message: 'connessione persa' };

    await expect(rimborso()).rejects.toThrow(/riprovare/u);

    expect(finto.db.rpc.some((c) => c.nome === 'accumula_rimborso'), 'si e prenotato un rimborso senza sapere a chi scrivere').toBe(false);
    expect(ordine()).toMatchObject({ refunded_amount_cents: 0, payment_status: 'PAID' });
    expect(avvisi()).toHaveLength(0);
  });

  it('l account non c e piu: il bonifico va avanti, e l avviso dice come riconoscere il cliente', async () => {
    finto.db.email.giulia = null;

    const esito = await rimborso();

    expect(esito.refundId).toBe('bonifico:4000:return_f00dcafe-1');
    const testo = String(avvisi()[0].body);
    expect(testo).toContain("Nessun recapito: l'account è stato cancellato.");
    expect(testo).toContain('Il numero d\'ordine da solo non basta, perché lo vedono anche il negozio e il fattorino');
    expect(testo).toContain('paga solo se ti dice cosa ha comprato, in che giorno e quanto ha pagato');
    expect(testo).not.toContain('Prendi l\'IBAN solo');
    expect(allaCliente()).toHaveLength(0);
  });

  it('ordine senza cliente (user_id vuoto), tutto in contanti: il rimborso va a termine', async () => {
    apri(maglione({ user_id: null }));

    const esito = await rimborso();

    expect(esito).toMatchObject({ modo: 'bonifico', bonificoCents: 4000 });
    expect(ordine().payment_status).toBe('REFUNDED');
    expect(String(avvisi()[0].body)).toContain('Nessun recapito');
  });

  it('ordine misto senza cliente: il credito non si accredita a nessuno, il bonifico va avanti e l avviso lo dice', async () => {
    apri({ ...misto(), user_id: null });

    const esito = await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_f00dcafe-1', notifyBuyer: true });

    expect(finto.db.rpc.some((c) => c.nome === 'wallet_credit'), 'un accredito senza cliente fa fallire il rimborso per sempre').toBe(false);
    expect(esito).toMatchObject({ modo: 'bonifico', creditoCents: 0, bonificoCents: 3000 });
    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', stripe_refund_id: 'bonifico:3000:return_f00dcafe-1' });
    const testo = String(avvisi()[0].body);
    expect(testo).toContain(`Bonifico di ${formatPriceFromCents(3000)}`);
    expect(testo).toContain(`Altri ${formatPriceFromCents(2000)} erano credito MyCity: non si possono restituire, perché l'account è cancellato.`);
    expect(testo).not.toContain('gli sono già tornati');
  });
});

describe('R25 — l email al cliente dice come tornano davvero i soldi', () => {
  it('bonifico: chiede di rispondere con IBAN e intestatario, senza costi, e la risposta va alla casella dei contatti', async () => {
    await rimborso();

    const [email] = allaCliente();
    expect(email.subject).toBe(`💶 Rimborso di ${formatPriceFromCents(4000)} per l'ordine ${NUMERO}: rispondi con il tuo IBAN`);
    expect(email.text).toContain(`Per l'ordine ${NUMERO} ti restituiamo ${formatPriceFromCents(4000)} con un bonifico, senza costi per te.`);
    expect(email.text).toContain('rispondi a questa email');
    expect(email.text).toContain('IBAN');
    expect(email.text).toContain('intestatario');
    expect(email.replyTo, 'la risposta con l IBAN va a una casella che non e la nostra').toBe(CASELLA);
    for (const vietata of ['5-10 giorni', 'metodo di pagamento', 'Contatti', 'come hai scelto tu', 'finisce con']) {
      expect(email.text, `l email dice «${vietata}»`).not.toContain(vietata);
      expect(email.html).not.toContain(vietata);
    }
    expect(email.html).toContain('Vedi dettaglio');
    expect(email.html).toContain(`/orders/${ORDINE}`);
  });

  it('misto: quanto torna come credito e perche, quanto col bonifico, e dove trovare il credito', async () => {
    apri(misto());

    await refundOrder({ orderId: ORDINE, amountCents: 5000, idempotencyKey: 'return_f00dcafe-1', notifyBuyer: true });

    const [email] = allaCliente();
    expect(email.subject).toBe(`💶 Rimborso di ${formatPriceFromCents(5000)} per l'ordine ${NUMERO}: credito MyCity e bonifico`);
    expect(email.text).toContain(`${formatPriceFromCents(2000)} come credito MyCity, perché li avevi pagati con il credito`);
    expect(email.text).toContain(`${formatPriceFromCents(3000)} con un bonifico, senza costi per te`);
    expect(email.text, 'il cliente ha 20 € di credito e l email non gli dice dove sono').toContain('«Gift card»');
    expect(email.html).toMatch(/href="[^"]*\/profile\/gift-cards"[^>]*>«Gift card»</u);
    expect(email.text).toContain('rispondi a questa email');
    expect(email.text).not.toMatch(/5-10 giorni|metodo di pagamento|come hai scelto tu/u);
  });

  it('credito (ordine pagato col credito): dice perche, e mai «come hai scelto tu»', async () => {
    apri(maglione({ total_price: 0, wallet_applied_cents: 4000 }));

    await rimborso();

    const [email] = allaCliente();
    expect(email.text).toContain('perché avevi pagato con il credito MyCity');
    expect(email.text).not.toContain('come hai scelto tu');
    expect(email.text).not.toContain('Buoni regalo');
    expect(email.text).not.toMatch(/5-10 giorni|metodo di pagamento/u);
  });

  it('il motivo arriva in italiano, non come codice tecnico', async () => {
    await rimborso({ reason: 'requested_by_customer' });

    expect(allaCliente()[0].text).not.toContain('requested_by_customer');
    expect(allaCliente()[0].html).not.toContain('requested_by_customer');
    expect(allaCliente()[0].text).toContain('reso richiesto da te');
  });

  it('carta: torna sulla carta, nei tempi della banca (com era)', async () => {
    apri(maglione({ stripe_payment_intent: 'pi_1', payment_method: 'card', cash_confirmed_at: null }));

    const esito = await rimborso();

    expect(esito.modo).toBe('carta');
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(allaCliente()[0].text).toContain('carta che hai usato per pagare');
    expect(avvisi()).toHaveLength(0);
  });
});
