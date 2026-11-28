import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';

/**
 * R08-012 (onda 2) — Il buono regalo mandava a Stripe nome, email e messaggio privato del destinatario.
 *
 * Erano nei metadati della sessione di pagamento, perché il webhook li ritrovasse dopo l'incasso. Il
 * destinatario non è nostro cliente: da noi quei campi si azzerano (cancellazione, potatura), su Stripe
 * restavano per sempre, anche per i pagamenti mai conclusi.
 *
 * Qui la strada vera: la cassa (app/api/gift-cards/checkout/route.ts) con Stripe finto, il webhook del
 * buono (lib/stripe/webhook/giftcard.ts) col database finto, la potatura e l'elenco della cancellazione.
 */

const stato = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  sessioni: [] as Array<{ parametri: Record<string, unknown>; opzioni: Record<string, unknown> }>,
  email: [] as Array<{ to: string }>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'http://localhost', stripeWebhookSecret: () => 'whsec_test' } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { to: string }) => {
    stato.email.push({ to: m.to });
    return { ok: true };
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  BUONI_REGALO_IN_VENDITA: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: Record<string, unknown>) => unknown) => (req: Request) =>
    h({ user: { id: 'cliente-1', email: 'marco@example.com', email_confirmed_at: '2026-10-01T10:00:00Z' }, req }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    checkout: {
      sessions: {
        create: async (parametri: Record<string, unknown>, opzioni: Record<string, unknown>) => {
          stato.sessioni.push({ parametri, opzioni });
          return { id: `cs_${stato.sessioni.length}`, url: 'https://checkout.stripe.test/x' };
        },
      },
    },
  }),
}));

const { POST } = await import('@/app/api/gift-cards/checkout/route');
const { handleGiftCardPurchase } = await import('@/lib/stripe/webhook/giftcard');
const { potatureDiRitenzione, GIORNI_DEI_BUONI_REGALO_NON_PAGATI } = await import('@/lib/privacy/potature-ritenzione');
const { TABELLE_CON_DATI_PERSONALI } = await import('@/lib/account/cancellazione');

const REGALO = {
  amountEuro: 25,
  recipientName: 'Chiara Rossi',
  recipientEmail: 'chiara.rossi@example.com',
  message: 'Buon compleanno, ti aspetto da Pane Quotidiano!',
};

async function compra(corpo: Record<string, unknown> = REGALO, chiave = 'tentativo-1'): Promise<Response> {
  return (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/gift-cards/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
      body: JSON.stringify(corpo),
    }),
  );
}

beforeEach(() => {
  stato.db = fintoDatabase({ gift_card_in_attesa: [], gift_cards: [], profiles: [] });
  stato.db.unici = { gift_card_in_attesa: [['buyer_id', 'chiave']] };
  stato.sessioni = [];
  stato.email = [];
});

describe('R08-012 · la cassa del buono non manda a Stripe i dati del destinatario', () => {
  it('nei parametri della sessione non ci sono nome, email né messaggio del destinatario', async () => {
    const r = await compra();
    expect(r.status).toBe(200);
    expect(stato.sessioni).toHaveLength(1);
    const tutto = JSON.stringify(stato.sessioni[0]);
    expect(tutto).not.toContain('Chiara');
    expect(tutto).not.toContain('chiara.rossi@example.com');
    expect(tutto).not.toContain('Buon compleanno');
    const meta = stato.sessioni[0].parametri.metadata as Record<string, string>;
    expect(Object.keys(meta).sort()).toEqual(['amount_cents', 'attesa_id', 'buyer_id', 'kind']);
    // I dati stanno da noi, nella riga del tentativo.
    const righe = stato.db.tabelle.gift_card_in_attesa;
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({
      id: meta.attesa_id,
      buyer_id: 'cliente-1',
      amount_cents: 2500,
      recipient_name: 'Chiara Rossi',
      recipient_email: 'chiara.rossi@example.com',
      message: 'Buon compleanno, ti aspetto da Pane Quotidiano!',
    });
  });

  it('il doppio clic dello stesso tentativo riusa la stessa riga: Stripe vede la stessa richiesta', async () => {
    await compra();
    const r2 = await compra();
    expect(r2.status).toBe(200);
    expect(stato.db.tabelle.gift_card_in_attesa).toHaveLength(1);
    const [a, b] = stato.sessioni;
    expect(b.parametri).toEqual(a.parametri);
    expect(b.opzioni.idempotencyKey).toBe(a.opzioni.idempotencyKey);
  });

  it('stessa chiave con un altro destinatario: 409, e a Stripe non parte niente', async () => {
    await compra();
    const r2 = await compra({ ...REGALO, recipientEmail: 'altra@example.com' });
    expect(r2.status).toBe(409);
    expect(stato.sessioni).toHaveLength(1);
  });

  it('se il tentativo non si scrive (tabella assente) il pagamento non parte e i dati non vanno a Stripe', async () => {
    stato.db.guasto = (s) => (s.tabella === 'gift_card_in_attesa'
      ? { code: '42P01', message: 'relation "public.gift_card_in_attesa" does not exist' } : null);
    const r = await compra();
    expect(r.status).toBe(503);
    expect(stato.sessioni).toHaveLength(0);
  });
});

describe('R08-012 · il webhook ritrova il destinatario da noi e poi toglie il tentativo', () => {
  async function sessionePagata() {
    await compra();
    const { parametri } = stato.sessioni[0];
    return {
      id: 'cs_pagata',
      payment_intent: 'pi_1',
      metadata: { ...(parametri.metadata as Record<string, string>) },
      customer_details: { email: 'marco@example.com' },
    } as unknown as Parameters<typeof handleGiftCardPurchase>[0];
  }

  it('il buono nasce col destinatario della riga in attesa, il codice va a lui, la riga sparisce', async () => {
    const sessione = await sessionePagata();
    await handleGiftCardPurchase(sessione);
    expect(stato.db.tabelle.gift_cards).toHaveLength(1);
    expect(stato.db.tabelle.gift_cards[0]).toMatchObject({
      amount_cents: 2500,
      buyer_id: 'cliente-1',
      recipient_name: 'Chiara Rossi',
      recipient_email: 'chiara.rossi@example.com',
      message: 'Buon compleanno, ti aspetto da Pane Quotidiano!',
    });
    expect(stato.email.map((e) => e.to)).toContain('chiara.rossi@example.com');
    expect(stato.db.tabelle.gift_card_in_attesa).toHaveLength(0);
  });

  it('se la riga in attesa non si legge, il webhook lancia: Stripe riprova, nessun buono senza destinatario', async () => {
    const sessione = await sessionePagata();
    stato.db.guastoLettura = (t) => (t === 'gift_card_in_attesa' ? { message: 'timeout' } : null);
    await expect(handleGiftCardPurchase(sessione)).rejects.toThrow(/destinatario non letto/);
    expect(stato.db.tabelle.gift_cards).toHaveLength(0);
  });
});

describe('R08-012 · i tentativi mai pagati non restano per sempre', () => {
  it('la potatura toglie i tentativi più vecchi della finestra e lascia quelli recenti', async () => {
    const adesso = Date.parse('2026-11-28T03:00:00Z');
    const vecchio = new Date(adesso - (GIORNI_DEI_BUONI_REGALO_NON_PAGATI + 1) * 86_400_000).toISOString();
    const recente = new Date(adesso - 86_400_000).toISOString();
    stato.db.tabelle.gift_card_in_attesa = [
      { id: 'a1', buyer_id: 'u', chiave: 'k1', recipient_email: 'x@example.com', created_at: vecchio },
      { id: 'a2', buyer_id: 'u', chiave: 'k2', recipient_email: 'y@example.com', created_at: recente },
    ];
    const passo = potatureDiRitenzione(adesso).find((p) => p.cosa === 'gift_card_in_attesa');
    expect(passo, 'manca la potatura dei buoni non pagati').toBeTruthy();
    await passo!.fai(stato.db.client as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    expect(stato.db.tabelle.gift_card_in_attesa.map((r) => r.id)).toEqual(['a2']);
  });

  it('senza la tabella (migrazione non applicata) la potatura non fa rossa la notte; un guasto vero sì', async () => {
    const passo = potatureDiRitenzione(Date.now()).find((p) => p.cosa === 'gift_card_in_attesa')!;
    const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    stato.db.guasto = () => ({ code: '42P01', message: 'relation "public.gift_card_in_attesa" does not exist' });
    await expect(passo.fai(stato.db.client as never, registro)).resolves.toBeUndefined();
    stato.db.guasto = () => ({ code: '57014', message: 'canceling statement due to statement timeout' });
    await expect(passo.fai(stato.db.client as never, registro)).rejects.toThrow(/timeout/);
  });

  it('la cancellazione dell\'account ripulisce anche i tentativi in attesa', () => {
    const voce = TABELLE_CON_DATI_PERSONALI.find((t) => t.tabella === 'gift_card_in_attesa');
    expect(voce).toMatchObject({
      colonna: 'buyer_id',
      azzera: { recipient_name: null, recipient_email: null, message: null },
      sopravvive: false,
    });
  });
});
