import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R83 — il codice del buono parte solo se il buono e' attivo.
 *
 * Il database puo' far nascere il buono gia' spento (voided_at scritto).
 * In quel caso il codice non va mandato a nessuno: ne' al destinatario ne'
 * a chi l'ha comprato. Se il buono e' attivo, le due email partono come prima;
 * se la lettura dello stato non risponde, il buono pagato non resta senza codice.
 */

const stato: {
  voidedAt: string | null;
  erroreLettura: boolean;
  email: string[];
  inseriti: number;
  letture: number;
} = { voidedAt: null, erroreLettura: false, email: [], inseriti: 0, letture: 0 };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { stripeWebhookSecret: () => 'segreto' } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { to: string }) => {
    stato.email.push(m.to);
    return { ok: true };
  }),
}));
vi.mock('@/lib/email/templates', () => ({
  giftCardRecipientTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  giftCardBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'gift_cards') {
        return {
          insert: () => {
            stato.inseriti += 1;
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () => {
                stato.letture += 1;
                return Promise.resolve(
                  stato.erroreLettura
                    ? { data: null, error: { code: '08006', message: 'connessione persa' } }
                    : { data: { voided_at: stato.voidedAt }, error: null },
                );
              },
            }),
          }),
        };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { full_name: 'Nicola' } }) }) }) };
      }
      return {};
    },
  }),
}));

import { handleGiftCardPurchase } from '@/lib/stripe/webhook/giftcard';

function sessione(importoCent: number, pagamento: string | null = 'pi_1') {
  return {
    id: `cs_${importoCent}`,
    payment_intent: pagamento,
    metadata: { amount_cents: String(importoCent), buyer_id: 'u1', recipient_email: 'dest@x.it', recipient_name: 'Anna' },
    customer_details: { email: 'compra@x.it' },
  } as unknown as Parameters<typeof handleGiftCardPurchase>[0];
}

beforeEach(() => {
  stato.voidedAt = null;
  stato.erroreLettura = false;
  stato.email = [];
  stato.inseriti = 0;
  stato.letture = 0;
});

describe('R83 email del buono', () => {
  for (const cent of [500, 1000, 1500, 3000, 5000]) {
    it(`buono da ${cent / 100} euro nato spento: nessun codice esce`, async () => {
      stato.voidedAt = '2026-11-01T10:00:00Z';
      await handleGiftCardPurchase(sessione(cent));
      expect(stato.inseriti).toBe(1);
      expect(stato.email).toEqual([]);
    });

    it(`buono da ${cent / 100} euro attivo: destinatario e compratore ricevono il codice`, async () => {
      await handleGiftCardPurchase(sessione(cent));
      expect(stato.email.sort()).toEqual(['compra@x.it', 'dest@x.it']);
    });
  }

  it('la lettura dello stato non risponde: il buono pagato riceve comunque il codice', async () => {
    stato.erroreLettura = true;
    await handleGiftCardPurchase(sessione(2000));
    expect(stato.email.sort()).toEqual(['compra@x.it', 'dest@x.it']);
  });

  it('webhook ripetuto sul buono spento: mai un codice, nemmeno al secondo giro', async () => {
    stato.voidedAt = '2026-11-01T10:00:00Z';
    await handleGiftCardPurchase(sessione(2000));
    await handleGiftCardPurchase(sessione(2000));
    expect(stato.email).toEqual([]);
  });
});
