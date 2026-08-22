import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * 22/8/2026 — IL TASSO DI AUTORIZZAZIONE ERA TRUCCATO AL RIALZO.
 *
 * La chiave di deduplicazione era `(payment_intent_id, status)`, che non
 * identifica un evento: identifica un pagamento. Una carta rifiutata tre volte
 * di fila — fondi insufficienti, poi verifica non completata, poi rifiuto
 * dell'emittente — è LO STESSO PaymentIntent con tre rifiuti diversi: il
 * database ne teneva uno e buttava via gli altri due in silenzio.
 *
 * Il numero che serve a capire se stiamo perdendo vendite alla cassa era
 * quindi sempre migliore di quello vero.
 *
 * E la charge non arrivava mai espansa, quindi `three_d_secure` e
 * `network_status` — le due colonne che dicono DI CHI è la colpa — erano
 * vuote su ogni riga da sempre.
 */

const insert = vi.fn((_riga: Record<string, unknown>) => Promise.resolve({ error: null }));
const from = vi.fn(() => ({ insert }));
const retrieve = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({ from }) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from }) }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve } }),
  isStripeConfigured: () => true,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn() }));

const intent = (id: string, decline: string): Stripe.PaymentIntent =>
  ({
    id,
    amount: 4200,
    metadata: { buyer_user_id: 'u1', pending_checkout_id: '11111111-1111-1111-1111-111111111111' },
    last_payment_error: { decline_code: decline, code: 'card_declined' },
    latest_charge: 'ch_1',
  }) as unknown as Stripe.PaymentIntent;

describe('il tasso di autorizzazione conta tutti i rifiuti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieve.mockResolvedValue({
      id: 'pi_1',
      amount: 4200,
      metadata: {},
      last_payment_error: { decline_code: 'insufficient_funds', code: 'card_declined' },
      latest_charge: {
        outcome: { reason: 'insufficient_funds', network_status: 'declined_by_network' },
        payment_method_details: { card: { three_d_secure: { result: 'authenticated' } } },
      },
    });
  });

  it('due rifiuti diversi sullo stesso pagamento scrivono due righe distinte', async () => {
    const { registraTentativoPagamento } = await import('@/lib/stripe/webhook/pagamenti');

    await registraTentativoPagamento(intent('pi_1', 'insufficient_funds'), 'failed', 'evt_A');
    await registraTentativoPagamento(intent('pi_1', 'do_not_honor'), 'failed', 'evt_B');

    expect(insert).toHaveBeenCalledTimes(2);
    const primo = insert.mock.calls[0][0] as unknown as Record<string, unknown>;
    const secondo = insert.mock.calls[1][0] as unknown as Record<string, unknown>;

    // Stesso pagamento…
    expect(primo.payment_intent_id).toBe('pi_1');
    expect(secondo.payment_intent_id).toBe('pi_1');
    // …ma due eventi diversi: è questa la chiave che il database deduplica.
    expect(primo.stripe_event_id).toBe('evt_A');
    expect(secondo.stripe_event_id).toBe('evt_B');
    expect(primo.stripe_event_id).not.toBe(secondo.stripe_event_id);
  });

  it('la charge viene chiesta espansa, così 3D Secure ed esito di rete si scrivono', async () => {
    const { registraTentativoPagamento } = await import('@/lib/stripe/webhook/pagamenti');

    await registraTentativoPagamento(intent('pi_1', 'insufficient_funds'), 'failed', 'evt_C');

    // Prima nessuno la chiedeva: `pi.latest_charge` in un webhook è una
    // stringa, e le due colonne restavano NULL su ogni riga.
    expect(retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] });

    const riga = insert.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(riga.three_d_secure).toBe('authenticated');
    expect(riga.network_status).toBe('declined_by_network');
  });

  it('se Stripe non risponde si scrive lo stesso: un webhook in errore viene ritentato all’infinito', async () => {
    retrieve.mockRejectedValue(new Error('rete giù'));
    const { registraTentativoPagamento } = await import('@/lib/stripe/webhook/pagamenti');

    await registraTentativoPagamento(intent('pi_1', 'insufficient_funds'), 'failed', 'evt_D');

    expect(insert).toHaveBeenCalledTimes(1);
    const riga = insert.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(riga.stripe_event_id).toBe('evt_D');
    // Quello che non si è potuto sapere resta vuoto, non inventato.
    expect(riga.three_d_secure).toBeNull();
  });

  it('senza charge non si chiama Stripe per niente', async () => {
    const senza = { ...intent('pi_2', 'x'), latest_charge: null } as unknown as Stripe.PaymentIntent;
    const { registraTentativoPagamento } = await import('@/lib/stripe/webhook/pagamenti');

    await registraTentativoPagamento(senza, 'failed', 'evt_E');

    expect(retrieve).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
