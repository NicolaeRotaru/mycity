import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R83 — lo script di recupero del pagamento sui buoni.
 *
 * Di base fa un giro a vuoto: zero scritture. Con applica scrive su ogni buono
 * il pagamento giusto, ritrovato dalla sessione o (se la sessione manca) dal
 * codice. Una scrittura che torna {error} non ferma le altre e finisce negli
 * errori; un secondo giro non sovrascrive niente.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { stripeWebhookSecret: () => 'segreto' } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ giftCardRecipientTemplate: vi.fn(), giftCardBuyerTemplate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: vi.fn() }));

import { recuperaPagamentiDeiBuoni, type DbBuoni, type StripeSessioni } from '@/lib/stripe/recupero-pagamento-buoni';
import { giftCardCodeForSession } from '@/lib/stripe/webhook/giftcard';

type Buono = { code: string; stripe_session_id: string | null; stripe_payment_intent: string | null };

const stato: { buoni: Buono[]; tornati: string[]; scritture: Array<{ code: string; pi: unknown }>; erroreSu: string | null } = {
  buoni: [],
  tornati: [],
  scritture: [],
  erroreSu: null,
};

const db: DbBuoni = {
  from: (tabella: string) => ({
    select: () => ({
      is: () =>
        Promise.resolve({
          data:
            tabella === 'gift_cards'
              ? stato.buoni.filter((b) => b.stripe_payment_intent === null).map((b) => ({ code: b.code, stripe_session_id: b.stripe_session_id }))
              : [],
          error: null,
        }),
      in: (_c: string, valori: string[]) =>
        Promise.resolve({
          data: stato.tornati.filter((t) => valori.includes(t)).map((t) => ({ stripe_payment_intent: t })),
          error: null,
        }),
    }),
    update: (valori: Record<string, unknown>) => ({
      eq: (_c: string, code: string) => ({
        is: () => {
          if (stato.erroreSu === code) return Promise.resolve({ data: null, error: { message: 'risposta persa' } });
          const b = stato.buoni.find((x) => x.code === code && x.stripe_payment_intent === null);
          if (b) {
            b.stripe_payment_intent = valori.stripe_payment_intent as string;
            stato.scritture.push({ code, pi: valori.stripe_payment_intent });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  }),
};

const SESSIONI = [
  { id: 'cs_a', payment_intent: 'pi_a', metadata: { kind: 'gift_card' } },
  { id: 'cs_b', payment_intent: { id: 'pi_b' }, metadata: { kind: 'gift_card' } },
  { id: 'cs_ordine', payment_intent: 'pi_ordine', metadata: { kind: 'order' } },
  { id: 'cs_c', payment_intent: 'pi_c', metadata: { kind: 'gift_card' } },
];

const stripe: StripeSessioni = {
  checkout: {
    sessions: {
      retrieve: async (id: string) => {
        const s = SESSIONI.find((x) => x.id === id);
        if (!s) throw new Error('No such checkout.session');
        return s;
      },
      // Due pagine, per provare che lo scorrimento non si ferma alla prima.
      list: async ({ starting_after }) =>
        starting_after ? { data: SESSIONI.slice(2), has_more: false } : { data: SESSIONI.slice(0, 2), has_more: true },
    },
  },
};

beforeEach(() => {
  stato.buoni = [
    // Con la sessione scritta sul buono.
    { code: giftCardCodeForSession('cs_a'), stripe_session_id: 'cs_a', stripe_payment_intent: null },
    // Senza sessione: si ritrova dal codice, nella seconda pagina.
    { code: giftCardCodeForSession('cs_c'), stripe_session_id: null, stripe_payment_intent: null },
    // Senza sessione: si ritrova dal codice, nella prima pagina.
    { code: giftCardCodeForSession('cs_b'), stripe_session_id: null, stripe_payment_intent: null },
    // Gia' a posto: non si tocca.
    { code: 'MC-GIAAPOSTO00', stripe_session_id: 'cs_x', stripe_payment_intent: 'pi_x' },
    // Nessuna sessione ritrovabile.
    { code: 'MC-SCONOSCIUTO', stripe_session_id: null, stripe_payment_intent: null },
  ];
  stato.tornati = ['pi_c'];
  stato.scritture = [];
  stato.erroreSu = null;
});

describe('R83 recupero', () => {
  it('senza applica: zero scritture, ma il piano dice cosa scriverebbe', async () => {
    const r = await recuperaPagamentiDeiBuoni({ db, stripe, applica: false });
    expect(stato.scritture).toEqual([]);
    expect(r.scritti).toEqual([]);
    const perCodice = Object.fromEntries(r.piano.map((v) => [v.code, v.pagamento]));
    expect(perCodice[giftCardCodeForSession('cs_a')]).toBe('pi_a');
    expect(perCodice[giftCardCodeForSession('cs_b')]).toBe('pi_b');
    expect(perCodice[giftCardCodeForSession('cs_c')]).toBe('pi_c');
    expect(perCodice['MC-SCONOSCIUTO']).toBeNull();
    expect(r.piano.find((v) => v.code === giftCardCodeForSession('cs_c'))?.pagamentoGiaTornato).toBe(true);
  });

  it('con applica: scrive su ogni buono il pagamento giusto, e solo quello', async () => {
    const r = await recuperaPagamentiDeiBuoni({ db, stripe, applica: true });
    expect(r.errori).toEqual([]);
    const pi = Object.fromEntries(stato.buoni.map((b) => [b.code, b.stripe_payment_intent]));
    expect(pi[giftCardCodeForSession('cs_a')]).toBe('pi_a');
    expect(pi[giftCardCodeForSession('cs_b')]).toBe('pi_b');
    expect(pi[giftCardCodeForSession('cs_c')]).toBe('pi_c');
    expect(pi['MC-GIAAPOSTO00']).toBe('pi_x');
    expect(pi['MC-SCONOSCIUTO']).toBeNull();
    expect(stato.scritture).toHaveLength(3);
  });

  it('doppio giro con applica: il secondo non scrive niente', async () => {
    await recuperaPagamentiDeiBuoni({ db, stripe, applica: true });
    stato.scritture = [];
    const r = await recuperaPagamentiDeiBuoni({ db, stripe, applica: true });
    expect(stato.scritture).toEqual([]);
    expect(r.scritti).toEqual([]);
  });

  it('una scrittura che torna {error} finisce negli errori e non ferma le altre', async () => {
    stato.erroreSu = giftCardCodeForSession('cs_a');
    const r = await recuperaPagamentiDeiBuoni({ db, stripe, applica: true });
    expect(r.errori.map((e) => e.code)).toEqual([giftCardCodeForSession('cs_a')]);
    expect(r.scritti).toHaveLength(2);
    expect(stato.buoni.find((b) => b.code === giftCardCodeForSession('cs_a'))?.stripe_payment_intent).toBeNull();
  });
});
