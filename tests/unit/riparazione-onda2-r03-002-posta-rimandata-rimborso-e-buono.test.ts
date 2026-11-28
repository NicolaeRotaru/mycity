import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-002 (onda 2) — LE ULTIME EMAIL DI SERVIZIO DEL WEBHOOK CHE, SE NON PARTIVANO, NON LE RIMANDAVA NESSUNO.
 *
 * L'onda 1 ha messo in coda (`rimandaA`, lib/email/client.ts) «Nuovo ordine» al negozio, le conferme
 * al cliente e i rimborsi. Restavano fuori due email del webhook di Stripe: l'avviso del rimborso
 * automatico senza ordine (fascia persa, riserva scaduta, conto che non torna, carta già tornata) e
 * l'email del buono regalo a chi l'ha comprato. Chi le riceve ha un account (`buyer_id`): se Resend le
 * rifiuta, adesso la coda le rimanda, solo quando l'indirizzo è quello dell'account (customer_email =
 * user.email al checkout), come la conferma d'ordine. Il destinatario del buono può non avere un
 * account (email_queue vuole user_id): per lui resta l'avviso agli amministratori.
 */

const inviate = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (x: Record<string, unknown>) => {
    inviate.push(x);
    return { ok: true, id: 'em_1' };
  }),
}));
vi.mock('@/lib/supabase/server', () => {
  const tabella = (nome: string) => {
    const b: Record<string, unknown> = {};
    const esito = async () =>
      nome === 'gift_cards'
        ? { data: { voided_at: null }, error: null }
        : nome === 'profiles'
          ? { data: { full_name: 'Maria Rossi' }, error: null }
          : { data: null, error: null };
    for (const m of ['select', 'eq', 'insert', 'update']) b[m] = () => b;
    b.single = esito;
    b.maybeSingle = esito;
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok, ko);
    return b;
  };
  const admin = { from: tabella };
  return { getAdminSupabase: () => admin };
});

import { avvisaIlClienteDelRimborsoAutomatico } from '@/lib/stripe/webhook/fascia-al-pagamento';
import { handleGiftCardPurchase } from '@/lib/stripe/webhook/giftcard';
import { getAdminSupabase } from '@/lib/supabase/server';

const aCliente = (indirizzo: string) => inviate.filter((x) => x.to === indirizzo);
const rimborso = (buyerId: string | null) => ({
  chiave: 'riserva-scaduta-cliente:pc_1',
  buyerId,
  frase: 'Hai pagato 12,00 €, ma il pagamento è arrivato tardi.',
  invito: "Puoi rifare l'ordine dal carrello.",
  oggetto: '💶 Rimborso di 12,00 €',
  motivo: 'il tempo per pagare era scaduto.',
  traccia: { pendingCheckoutId: 'pc_1' },
});

beforeEach(() => {
  inviate.length = 0;
});

describe('R03-002 · l avviso del rimborso automatico, se non parte, lo rimanda la coda', () => {
  it('IL CASO CHE ROMPEVA — indirizzo dell account: la coda sa a chi rimandarlo', async () => {
    const sessione = { id: 'cs_1', customer_email: 'cliente@test.it', customer_details: { email: 'Cliente@Test.it' } } as never;
    await avvisaIlClienteDelRimborsoAutomatico(getAdminSupabase(), sessione, rimborso('buyer-1'));
    expect(aCliente('Cliente@Test.it'), 'l email non è partita').toHaveLength(1);
    expect(aCliente('Cliente@Test.it')[0].rimandaA, 'se Resend la rifiuta, nessuno la rimanda').toBe('buyer-1');
  });

  it('indirizzo diverso da quello dell account (scritto su Stripe): non va in coda, che spedirebbe all account', async () => {
    const sessione = { id: 'cs_1', customer_email: 'cliente@test.it', customer_details: { email: 'altro@test.it' } } as never;
    await avvisaIlClienteDelRimborsoAutomatico(getAdminSupabase(), sessione, rimborso('buyer-1'));
    expect(aCliente('altro@test.it')[0].rimandaA ?? null).toBeNull();
  });
});

describe('R03-002 · il buono regalo: a chi l ha comprato la rimanda la coda, al destinatario no', () => {
  it('IL CASO CHE ROMPEVA — l email a chi ha comprato il buono porta il suo account', async () => {
    await handleGiftCardPurchase({
      id: 'cs_g',
      payment_intent: 'pi_g',
      customer_email: 'cliente@test.it',
      customer_details: { email: 'cliente@test.it' },
      metadata: { amount_cents: '2500', buyer_id: 'buyer-1', recipient_email: 'amica@test.it', recipient_name: 'Anna' },
    } as never);

    expect(aCliente('cliente@test.it'), 'l email a chi ha comprato non è partita').toHaveLength(1);
    expect(aCliente('cliente@test.it')[0].rimandaA, 'se Resend la rifiuta, il codice del buono non arriva più').toBe('buyer-1');
    // Il destinatario può non avere un account: la coda (user_id obbligatorio) non lo può raggiungere.
    expect(aCliente('amica@test.it')).toHaveLength(1);
    expect(aCliente('amica@test.it')[0].rimandaA ?? null).toBeNull();
  });
});
