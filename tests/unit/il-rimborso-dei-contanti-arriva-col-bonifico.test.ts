import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * R71 · R25 — CHI PAGA IN CONTANTI RIAVE I SOLDI, NON UN CREDITO CHE NON HA CHIESTO.
 *
 * Il caso della scheda: Giulia paga 40 € in contanti al fattorino per un
 * maglione, lo restituisce entro 14 giorni, il negozio approva. Prima
 * `refundOrder` le accreditava 40 € di credito MyCity e basta — spendibili solo
 * con un altro ordine in contanti — e l'email le diceva «il rimborso arriverà
 * sul tuo metodo di pagamento entro 5-10 giorni lavorativi». Nessuno le aveva
 * chiesto niente, e i soldi che aspettava non sarebbero arrivati.
 *
 * L'articolo 56 del Codice del Consumo vuole il rimborso con lo stesso mezzo,
 * salvo scelta espressa del cliente. Adesso:
 *  · senza scelta, il rimborso dei contanti e' un bonifico da fare, e chi paga
 *    riceve l'avviso;
 *  · il credito arriva solo a chi l'ha scelto;
 *  · la parte pagata col credito torna credito (un premio non diventa soldi);
 *  · l'email dice il modo vero, e il motivo in italiano.
 *
 * Gira la `refundOrder` VERA e i modelli d'email VERI; finti solo il database,
 * Stripe e l'invio della posta.
 */

const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  posta: [] as Array<{ to: string; subject: string; html: string; text: string }>,
}));

const refundsCreate = vi.fn(async () => ({ id: 're_1' }));
const createReversal = vi.fn(async () => ({ id: 'trr_1' }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ refunds: { create: refundsCreate }, transfers: { createReversal } }),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string }) => {
    finto.posta.push(m);
    return { ok: true };
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { refundOrder } from '@/lib/stripe/payout';
import { formatPriceFromCents } from '@/lib/format';

/** Il maglione di Giulia: 40 € pagati al fattorino, consegnato e incassato ieri. */
function maglione(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: 'rider', rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 300, shipping_cost: 3,
    delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    ...extra,
  };
}

function apri(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    profiles: [{ id: 'admin-1', role: 'admin' }],
    notifications: [],
  });
}

const ordine = () => finto.db.tabelle.orders[0];

beforeEach(() => {
  finto.posta = [];
  refundsCreate.mockClear();
  createReversal.mockClear();
  apri(maglione());
});

describe('R71 — senza scelta, i contanti tornano col bonifico', () => {
  it('IL CASO CHE ROMPEVA — nessuno ha scelto il credito, e il credito non arriva', async () => {
    const esito = await refundOrder({
      orderId: 'o1', amountCents: 4000, idempotencyKey: 'return_r1', notifyBuyer: true,
      reason: 'requested_by_customer',
    });

    expect(creditoDi(finto.db, 'giulia'), 'Giulia ha ricevuto credito MyCity che non ha mai chiesto').toBe(0);
    expect(esito).toMatchObject({ modo: 'bonifico', bonificoCents: 4000, creditoCents: 0, pieno: true });
    expect(esito.refundId).toBe('bonifico:return_r1');
  });

  it('il rimborso resta registrato: l ordine e rimborsato e chi paga riceve l avviso del bonifico', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 4000, idempotencyKey: 'return_r1', notifyBuyer: true });

    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', refunded_amount_cents: 4000 });
    const avvisi = notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(avvisi, 'nessuno sa che c e un bonifico da fare: Giulia aspetta per sempre').toHaveLength(1);
    // La cifra scritta come la legge chi paga: «40,00 €», non «40.00€».
    expect(String(avvisi[0].body)).toContain(formatPriceFromCents(4000));
    expect(String(avvisi[0].body)).not.toContain('40.00');
    expect(String(avvisi[0].body)).toContain('chiediglielo');
  });

  it('col bonifico scelto e l IBAN: l avviso porta alla lista dei bonifici, l email dice su quale conto', async () => {
    await refundOrder({
      orderId: 'o1', amountCents: 4000, idempotencyKey: 'return_r1', notifyBuyer: true,
      contanti: { modo: 'BONIFICO', ibanFinale: '3456', doveSiPaga: '/admin/rimborsi-da-bonificare' },
    });

    const [avviso] = notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');
    expect(avviso.link).toBe('/admin/rimborsi-da-bonificare');
    expect(finto.posta).toHaveLength(1);
    expect(finto.posta[0].text).toContain('finisce con 3456');
  });

  it('il credito arriva solo a chi l ha scelto, subito, e niente bonifico da fare', async () => {
    const esito = await refundOrder({
      orderId: 'o1', amountCents: 4000, idempotencyKey: 'return_r1', contanti: { modo: 'CREDITO' },
    });

    expect(creditoDi(finto.db, 'giulia')).toBe(4000);
    expect(esito).toMatchObject({ modo: 'credito', refundId: 'wallet:return_r1', bonificoCents: 0 });
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')).toHaveLength(0);
  });

  it('ordine pagato in parte col credito: il credito speso torna credito, i contanti col bonifico', async () => {
    // 50 € lordi: 20 di credito MyCity, 30 in contanti incassati.
    apri(maglione({ total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500 }));

    const esito = await refundOrder({ orderId: 'o1', amountCents: 5000, idempotencyKey: 'return_r1', notifyBuyer: true });

    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    expect(esito).toMatchObject({ modo: 'misto', creditoCents: 2000, bonificoCents: 3000 });
    expect(String(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')[0].body)).toContain(formatPriceFromCents(3000));
  });

  it('un credito regalato non diventa soldi sul conto, nemmeno se il cliente chiede il bonifico', async () => {
    apri(maglione({ total_price: 0, wallet_applied_cents: 4000 }));

    const esito = await refundOrder({
      orderId: 'o1', amountCents: 4000, idempotencyKey: 'return_r1', contanti: { modo: 'BONIFICO', ibanFinale: '3456' },
    });

    expect(esito).toMatchObject({ modo: 'credito', bonificoCents: 0 });
    expect(creditoDi(finto.db, 'giulia')).toBe(4000);
    expect(notificheConTitolo(finto.db, 'Bonifico di rimborso da fare')).toHaveLength(0);
  });
});

describe('R25 — l email di rimborso dice come tornano davvero i soldi', () => {
  it('credito scelto: dice credito MyCity gia disponibile, non «metodo di pagamento entro 5-10 giorni»', async () => {
    await refundOrder({
      orderId: 'o1', amountCents: 1250, idempotencyKey: 'return_r1', notifyBuyer: true,
      reason: 'requested_by_customer', contanti: { modo: 'CREDITO' },
    });

    const { subject, text, html } = finto.posta[0];
    expect(subject).toContain('credito MyCity');
    expect(text).toContain('credito MyCity');
    expect(text).toContain('già disponibile');
    expect(text, 'promette soldi sulla carta a chi ha avuto credito').not.toMatch(/5-10 giorni|metodo di pagamento/);
    expect(html).not.toMatch(/5-10 giorni|metodo di pagamento/);
  });

  it('dice dove trovare il credito col nome che il cliente vede nel menu: «Gift card», non «Buoni regalo»', async () => {
    // Collaudo del 15/10: nel menu del profilo la voce si chiama «Gift card»
    // (components/account/AccountSidebar.tsx), e porta a /profile/gift-cards.
    await refundOrder({
      orderId: 'o1', amountCents: 1250, idempotencyKey: 'return_r1', notifyBuyer: true, contanti: { modo: 'CREDITO' },
    });

    const { text, html } = finto.posta[0];
    expect(text).toContain('«Gift card»');
    expect(text).not.toContain('Buoni regalo');
    expect(html).not.toContain('Buoni regalo');
    expect(html).toMatch(/href="[^"]*\/profile\/gift-cards"[^>]*>«Gift card»</);
  });

  it('il motivo arriva in italiano, non come codice tecnico', async () => {
    await refundOrder({
      orderId: 'o1', amountCents: 1250, idempotencyKey: 'return_r1', notifyBuyer: true,
      reason: 'requested_by_customer', contanti: { modo: 'CREDITO' },
    });

    expect(finto.posta[0].text).not.toContain('requested_by_customer');
    expect(finto.posta[0].html).not.toContain('requested_by_customer');
    expect(finto.posta[0].text).toContain('reso richiesto da te');
  });

  it('bonifico: dice bonifico, e se manca l IBAN dice come darcelo', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 4000, idempotencyKey: 'return_r1', notifyBuyer: true });

    const { subject, text } = finto.posta[0];
    expect(subject).toContain('bonifico');
    expect(text).toContain('ci serve il tuo IBAN');
    expect(text).not.toMatch(/5-10 giorni|metodo di pagamento/);
  });

  it('carta: torna sulla carta, nei tempi della banca (com era)', async () => {
    apri(maglione({ stripe_payment_intent: 'pi_1', payment_method: 'card', cash_confirmed_at: null }));

    const esito = await refundOrder({ orderId: 'o1', amountCents: 4000, idempotencyKey: 'return_r1', notifyBuyer: true });

    expect(esito.modo).toBe('carta');
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(finto.posta[0].text).toContain('carta che hai usato per pagare');
  });
});
