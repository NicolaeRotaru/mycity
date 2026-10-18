import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

/**
 * 15/10/2026 (R77) — GLI AVVISI DI STRIPE SUI CONTI DEI NEGOZI VENIVANO
 * RESPINTI: SE LA BANCA RIFIUTAVA UN BONIFICO AL NEGOZIO NON LO SAPEVA NESSUNO.
 *
 * Il sito controllava la firma di ogni avviso con un solo segreto. Ma «bonifico
 * rifiutato dalla banca del negozio» (`payout.failed`) e «versamenti del
 * negozio bloccati» (`account.updated`) Stripe li manda da un secondo indirizzo,
 * quello degli «eventi sui conti collegati», firmati con un segreto suo. Con un
 * segreto solo il sito rispondeva 400 e il gestore scritto apposta per avvisare
 * il negoziante non girava mai.
 *
 * Questa prova usa la firma VERA di Stripe (stessa libreria, stesso calcolo
 * HMAC del server): firma l'avviso con il segreto del secondo indirizzo e lo
 * consegna alla rotta vera. Nessuna verifica finta.
 */

const SEGRETO_PRINCIPALE = 'whsec_principale_di_prova';
const SEGRETO_CONTI = 'whsec_conti_collegati_di_prova';
const SEGRETO_SCONOSCIUTO = 'whsec_di_qualcun_altro';

// La chiave serve solo a costruire il client: la verifica della firma non va in rete.
process.env.STRIPE_SECRET_KEY = 'sk_test_solo_per_costruire_il_client';

const gestori = vi.hoisted(() => ({
  bonificoRifiutato: vi.fn(async (..._a: unknown[]) => {}),
  contoAggiornato: vi.fn(async (..._a: unknown[]) => {}),
  ordineCompletato: vi.fn(async (..._a: unknown[]) => {}),
  buonoRegalo: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/trasferimenti', () => ({
  handlePayoutFailed: gestori.bonificoRifiutato,
  handleAccountUpdated: gestori.contoAggiornato,
  handleTransferReversed: vi.fn(async () => {}),
}));
vi.mock('@/lib/stripe/webhook/ordini', () => ({
  handleCheckoutCompleted: gestori.ordineCompletato,
  handleCheckoutExpired: vi.fn(async () => {}),
}));
vi.mock('@/lib/stripe/webhook/giftcard', () => ({ handleGiftCardPurchase: gestori.buonoRegalo }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

import { POST } from '@/app/api/stripe/webhook/route';

const firmatore = new Stripe('sk_test_solo_per_firmare');

function consegnaFirmata(evento: Record<string, unknown>, segreto: string): Promise<Response> {
  const corpo = JSON.stringify(evento);
  const firma = firmatore.webhooks.generateTestHeaderString({ payload: corpo, secret: segreto });
  return POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': firma },
      body: corpo,
    }) as never,
  );
}

/** Il bonifico di 120 € al conto di Pane Quotidiano, rifiutato dalla sua banca. */
const bonificoRifiutato = {
  id: 'evt_payout_failed',
  object: 'event',
  type: 'payout.failed',
  account: 'acct_pane_quotidiano',
  data: { object: { id: 'po_1', object: 'payout', amount: 12000, failure_message: 'IBAN non valido' } },
};

const pagamentoCompletato = {
  id: 'evt_checkout',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', object: 'checkout.session', payment_status: 'paid', metadata: {} } },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SEGRETO_PRINCIPALE;
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SEGRETO_CONTI;
});

describe('il secondo indirizzo di Stripe, quello dei conti dei negozi', () => {
  it('IL CASO DELLA SCHEDA — il bonifico rifiutato firmato col secondo segreto arriva al gestore', async () => {
    const risposta = await consegnaFirmata(bonificoRifiutato, SEGRETO_CONTI);

    expect(risposta.status, 'avviso respinto: il negoziante non saprà mai che il bonifico è rimbalzato').toBe(200);
    expect(gestori.bonificoRifiutato).toHaveBeenCalledTimes(1);
    // Il conto del negozio è l'unico filo che porta a chi avvisare.
    expect(gestori.bonificoRifiutato.mock.calls[0][1]).toBe('acct_pane_quotidiano');
  });

  it('anche i versamenti bloccati da Stripe arrivano', async () => {
    const risposta = await consegnaFirmata(
      {
        id: 'evt_acct', object: 'event', type: 'account.updated', account: 'acct_pane_quotidiano',
        data: { object: { id: 'acct_pane_quotidiano', object: 'account', payouts_enabled: false } },
      },
      SEGRETO_CONTI,
    );
    expect(risposta.status).toBe(200);
    expect(gestori.contoAggiornato).toHaveBeenCalledTimes(1);
  });

  it('gli avvisi del conto di MyCity continuano a passare col primo segreto', async () => {
    const risposta = await consegnaFirmata(pagamentoCompletato, SEGRETO_PRINCIPALE);
    expect(risposta.status).toBe(200);
    expect(gestori.ordineCompletato).toHaveBeenCalledTimes(1);
  });

  it('una firma che nessuno dei due segreti riconosce resta respinta', async () => {
    const risposta = await consegnaFirmata(bonificoRifiutato, SEGRETO_SCONOSCIUTO);
    expect(risposta.status).toBe(400);
    expect(gestori.bonificoRifiutato).not.toHaveBeenCalled();
  });

  it('con solo il secondo segreto configurato, gli avvisi dei negozi passano lo stesso', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const risposta = await consegnaFirmata(bonificoRifiutato, SEGRETO_CONTI);
    expect(risposta.status).toBe(200);
    expect(gestori.bonificoRifiutato).toHaveBeenCalledTimes(1);
  });

  it('senza nessuno dei due segreti il webhook dice «non configurato»', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const risposta = await consegnaFirmata(bonificoRifiutato, SEGRETO_CONTI);
    expect(risposta.status).toBe(503);
  });
});

describe('la seconda porta fa passare solo gli avvisi dei conti dei negozi', () => {
  it('un «pagamento completato» che arriva dal conto di un negozio non crea niente', async () => {
    // La variante scomoda: aprire una seconda porta non deve permettere a un
    // conto che non è il nostro di far nascere un ordine o un buono regalo.
    const daUnConto = {
      ...pagamentoCompletato,
      id: 'evt_da_un_conto',
      account: 'acct_qualcuno',
      data: { object: { id: 'cs_2', object: 'checkout.session', payment_status: 'paid', metadata: { kind: 'gift_card', amount_cents: '100000' } } },
    };
    const risposta = await consegnaFirmata(daUnConto, SEGRETO_CONTI);

    expect(risposta.status, 'con un errore Stripe riproverebbe per tre giorni un avviso che non ci riguarda').toBe(200);
    expect(gestori.buonoRegalo, 'buono regalo nato da un conto che non è quello di MyCity').not.toHaveBeenCalled();
    expect(gestori.ordineCompletato).not.toHaveBeenCalled();
  });
});
