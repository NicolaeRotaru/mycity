import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

/**
 * R29-013 — IL SITO VERO LAVORAVA ANCHE GLI AVVISI STRIPE «DI PROVA».
 *
 * L'indirizzo dei conti collegati riceve da Stripe anche gli avvisi in modalità di prova
 * (`livemode: false`) dei conti dei negozi. Il sito vero li lavorava come veri: un
 * «versamenti bloccati» di prova riletto con la chiave vera non si trova, la rotta risponde
 * errore e Stripe ritenta per giorni; un «pagamento completato» di prova poteva far nascere
 * un ordine. Adesso, con la chiave vera, un avviso di prova si scarta senza toccare niente e
 * si risponde 200 (Stripe non ritenta); con la chiave di prova (anteprima, sviluppo) gli
 * avvisi di prova si lavorano come prima.
 *
 * La firma è quella VERA di Stripe (stessa libreria). Chiavi e segreti sono finti.
 */

const SEGRETO_PRINCIPALE = 'whsec_principale_di_prova';
const SEGRETO_CONTI = 'whsec_conti_collegati_di_prova';
const CHIAVE_VERA_FINTA = 'sk_live_finta_della_prova_r29';
const CHIAVE_DI_PROVA_FINTA = 'sk_test_finta_della_prova_r29';

const gestori = vi.hoisted(() => ({
  contoAggiornato: vi.fn(async (..._a: unknown[]) => {}),
  ordineCompletato: vi.fn(async (..._a: unknown[]) => {}),
  database: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/trasferimenti', () => ({
  handlePayoutFailed: vi.fn(async () => {}),
  handleAccountUpdated: gestori.contoAggiornato,
  handleTransferReversed: vi.fn(async () => {}),
}));
vi.mock('@/lib/stripe/webhook/ordini', () => ({
  handleCheckoutCompleted: gestori.ordineCompletato,
  handleCheckoutExpired: vi.fn(async () => {}),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      gestori.database(tabella);
      return {
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  }),
}));

import { POST } from '@/app/api/stripe/webhook/route';
import { verificaFirma } from '@/lib/stripe/webhook/firma';

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

/** «Versamenti del negozio bloccati», arrivato dall'indirizzo dei conti collegati. */
const contoAggiornato = (livemode: boolean) => ({
  id: `evt_acct_${livemode ? 'vero' : 'prova'}`,
  object: 'event',
  type: 'account.updated',
  livemode,
  account: 'acct_negozio_di_prova',
  data: { object: { id: 'acct_negozio_di_prova', object: 'account', payouts_enabled: false } },
});

const pagamentoCompletato = (livemode: boolean) => ({
  id: `evt_checkout_${livemode ? 'vero' : 'prova'}`,
  object: 'event',
  type: 'checkout.session.completed',
  livemode,
  data: { object: { id: 'cs_1', object: 'checkout.session', payment_status: 'paid', metadata: {} } },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SEGRETO_PRINCIPALE;
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SEGRETO_CONTI;
  delete process.env.VERCEL_ENV;
});

describe('R29-013 — sul sito vero gli avvisi Stripe di prova non si lavorano', () => {
  it('chiave vera: l avviso di prova dei conti collegati risponde 200 e non tocca niente', async () => {
    process.env.STRIPE_SECRET_KEY = CHIAVE_VERA_FINTA;
    const risposta = await consegnaFirmata(contoAggiornato(false), SEGRETO_CONTI);
    expect(risposta.status, 'un errore farebbe ritentare Stripe per giorni').toBe(200);
    expect(await risposta.json()).toMatchObject({ received: true, ignorato: true });
    expect(gestori.contoAggiornato, 'un avviso di prova ha lavorato sul sito vero').not.toHaveBeenCalled();
    expect(gestori.database, 'un avviso di prova ha scritto nel database del sito vero').not.toHaveBeenCalled();
  });

  it('chiave vera: un pagamento completato di prova non fa nascere nessun ordine', async () => {
    process.env.STRIPE_SECRET_KEY = CHIAVE_VERA_FINTA;
    const risposta = await consegnaFirmata(pagamentoCompletato(false), SEGRETO_PRINCIPALE);
    expect(risposta.status).toBe(200);
    expect(gestori.ordineCompletato).not.toHaveBeenCalled();
    expect(gestori.database).not.toHaveBeenCalled();
  });

  it('chiave vera: gli avvisi veri si lavorano come prima', async () => {
    process.env.STRIPE_SECRET_KEY = CHIAVE_VERA_FINTA;
    expect((await consegnaFirmata(contoAggiornato(true), SEGRETO_CONTI)).status).toBe(200);
    expect(gestori.contoAggiornato).toHaveBeenCalledTimes(1);
    expect((await consegnaFirmata(pagamentoCompletato(true), SEGRETO_PRINCIPALE)).status).toBe(200);
    expect(gestori.ordineCompletato).toHaveBeenCalledTimes(1);
  });

  it('chiave di prova (anteprima, sviluppo): gli avvisi di prova si lavorano ancora', async () => {
    process.env.STRIPE_SECRET_KEY = CHIAVE_DI_PROVA_FINTA;
    expect((await consegnaFirmata(contoAggiornato(false), SEGRETO_CONTI)).status).toBe(200);
    expect(gestori.contoAggiornato).toHaveBeenCalledTimes(1);
    expect((await consegnaFirmata(pagamentoCompletato(false), SEGRETO_PRINCIPALE)).status).toBe(200);
    expect(gestori.ordineCompletato).toHaveBeenCalledTimes(1);
  });

  it('la verifica della firma lo dice da sola, qualunque sia la chiave passata', () => {
    const evento = (livemode: boolean) => ({ id: 'evt_x', type: 'account.updated', livemode }) as unknown as Stripe.Event;
    const segreti = [{ indirizzo: 'principale' as const, valore: 'whsec_x' }];
    expect(verificaFirma('{}', 'f', segreti, () => evento(false), 'sk_live_x').esito).toBe('di-prova');
    expect(verificaFirma('{}', 'f', segreti, () => evento(false), 'rk_live_x').esito).toBe('di-prova');
    expect(verificaFirma('{}', 'f', segreti, () => evento(true), 'sk_live_x').esito).toBe('valida');
    expect(verificaFirma('{}', 'f', segreti, () => evento(false), 'sk_test_x').esito).toBe('valida');
    expect(verificaFirma('{}', 'f', segreti, () => evento(false), undefined).esito).toBe('valida');
  });
});
