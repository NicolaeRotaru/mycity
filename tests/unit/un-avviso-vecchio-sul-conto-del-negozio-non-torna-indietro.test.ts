import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 — UN AVVISO VECCHIO SUL CONTO DEL NEGOZIO RIMETTEVA NEL DATABASE
 * UNO STATO SUPERATO.
 *
 * Stripe non garantisce l'ordine in cui consegna gli avvisi, e uno la cui
 * scrittura è fallita torna anche ore dopo. Il caso: alle 10:00 un avviso dice
 * «versamenti abilitati», ma la scrittura cade. Alle 10:05 Stripe blocca i
 * versamenti di Pane Quotidiano per un documento mancante: il secondo avviso
 * passa e il database scrive «bloccati». Alle 11:00 Stripe riconsegna il primo
 * e il database tornava ad «abilitati»: il giro dei bonifici continuava a
 * pagare un conto coi versamenti bloccati.
 *
 * La prova fa girare il gestore VERO contro un database finto e uno Stripe
 * finto che sa dire com'è il conto ADESSO.
 */

const stato: { db: FintoDatabase; contoSuStripe: Record<string, unknown>; stripeRisponde: boolean } = {
  db: fintoDatabase(), contoSuStripe: {}, stripeRisponde: true,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    accounts: {
      retrieve: async (id: string) => {
        if (!stato.stripeRisponde) throw new Error('Stripe non risponde');
        return { id, ...stato.contoSuStripe };
      },
    },
  }),
  isStripeConfigured: () => true,
}));

import { handleAccountUpdated } from '@/lib/stripe/webhook/trasferimenti';

type Conto = Parameters<typeof handleAccountUpdated>[0];
const fotografia = (payouts: boolean) =>
  ({ id: 'acct_pq', charges_enabled: true, payouts_enabled: payouts, details_submitted: true }) as unknown as Conto;
const profilo = () => stato.db.tabelle.profiles!.find((p) => p.id === 'pane-quotidiano')!;

beforeEach(() => {
  stato.stripeRisponde = true;
  stato.db = fintoDatabase({
    profiles: [{
      id: 'pane-quotidiano', role: 'seller', stripe_account_id: 'acct_pq',
      stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true,
    }],
  });
});

describe('lo stato del conto del negozio', () => {
  it('IL CASO DELLA SCHEDA — l avviso delle 10:00 riconsegnato alle 11:00 non riapre i versamenti bloccati alle 10:05', async () => {
    // Alle 10:05 Stripe blocca i versamenti: è così che il conto sta adesso.
    stato.contoSuStripe = { charges_enabled: true, payouts_enabled: false, details_submitted: true };
    await handleAccountUpdated(fotografia(false));
    expect(profilo().stripe_payouts_enabled).toBe(false);

    // Alle 11:00 torna l'avviso delle 10:00, con la fotografia di allora.
    await handleAccountUpdated(fotografia(true));

    expect(profilo().stripe_payouts_enabled, 'il giro dei bonifici pagherebbe un conto coi versamenti bloccati').toBe(false);
  });

  it('il caso opposto: un negozio sbloccato non torna «bloccato» per un avviso vecchio', async () => {
    stato.db.tabelle.profiles![0].stripe_payouts_enabled = false;
    stato.contoSuStripe = { charges_enabled: true, payouts_enabled: true, details_submitted: true };

    await handleAccountUpdated(fotografia(false));

    expect(profilo().stripe_payouts_enabled).toBe(true);
  });

  it('se Stripe non risponde non si scrive niente, e Stripe riprova', async () => {
    stato.stripeRisponde = false;
    await expect(handleAccountUpdated(fotografia(false))).rejects.toThrow();
    expect(profilo().stripe_payouts_enabled).toBe(true);
  });
});
