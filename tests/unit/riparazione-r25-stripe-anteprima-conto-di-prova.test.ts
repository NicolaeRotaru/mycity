import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R25-012 (26/11/2026) — Collegando Stripe dall'anteprima con la chiave di prova, un conto
 * salvato sul profilo che quella chiave non conosce fa lanciare ContoSconosciutoAllaChiaveDiProva
 * (lib/stripe/client.ts). Le due rotte di collegamento (negozio e fattorino) lo trattavano come un
 * guasto qualsiasi: 500 «Errore Stripe», e il consiglio di togliere il conto dal profilo restava
 * solo nei registri. Qui l'errore è quello VERO (la classe di lib/stripe/client), Stripe e database
 * sono finti: nessuna chiamata vera.
 */

const stato = vi.hoisted(() => ({
  ruolo: 'seller',
  creaLink: vi.fn(),
}));

vi.mock('@/lib/api/middleware', () => {
  const conUtente = (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) => (req: Request) =>
    gestore({ user: { id: 'u-1', email: 'forno@esempio.it' }, profile: { role: stato.ruolo }, req, params: {} });
  return { withAuthRateLimit: conUtente, withSellerAuthRateLimit: conUtente };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));
vi.mock('@/lib/stripe/salva-conto', () => ({ ContoNonSalvato: class extends Error {}, salvaIlConto: vi.fn() }));
vi.mock('@/lib/stripe/client', async (orig) => {
  const reale = await orig<typeof import('@/lib/stripe/client')>();
  return {
    ...reale,
    isStripeConfigured: () => true,
    createConnectOnboardingLink: (a: unknown) => stato.creaLink(a),
  };
});
vi.mock('@/lib/supabase/server', () => {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) c[m] = () => c;
  c.single = async () => ({ data: { approval_status: 'approved', stripe_account_id: 'acct_1VecchioDiProva' }, error: null });
  return { getServerSupabase: async () => ({ from: () => c }), getAdminSupabase: () => ({ from: () => c }) };
});

import { ContoSconosciutoAllaChiaveDiProva } from '@/lib/stripe/client';
import { friendlyError } from '@/lib/errors';
import { POST as onboarding } from '@/app/api/stripe/connect/onboarding/route';
import { POST as riderOnboarding } from '@/app/api/stripe/connect/rider-onboarding/route';

const ROTTE = [
  ['negozio', onboarding, 'seller'],
  ['fattorino', riderOnboarding, 'rider'],
] as const;

const chiama = (rotta: unknown) =>
  (rotta as (r: Request) => Promise<Response>)(new Request('http://localhost/x', { method: 'POST' }));

beforeEach(() => {
  stato.creaLink = vi.fn();
});

describe('R25-012 · il conto di prova che la chiave dell anteprima non conosce', () => {
  it.each(ROTTE)('%s: la persona legge cosa fare, non solo «Errore Stripe»', async (_chi, rotta, ruolo) => {
    stato.ruolo = ruolo;
    stato.creaLink.mockRejectedValue(new ContoSconosciutoAllaChiaveDiProva('acct_1VecchioDiProva'));
    const res = await chiama(rotta);
    const corpo = (await res.json()) as { error: { message: string } };

    expect(res.status).toBe(409);
    const messaggio = corpo.error.message;
    expect(messaggio).not.toBe('Errore Stripe');
    expect(messaggio).toMatch(/togli il conto dal profilo e riprova/);
    // Niente dettagli interni: né l'id del conto né la chiave.
    expect(messaggio).not.toMatch(/acct_|sk_test|rk_test/);
    // E il bottone lo mostra così com'è (passa da friendlyError, che scarta i testi tecnici).
    expect(friendlyError(new Error(messaggio))).toBe(messaggio);
  });

  it.each(ROTTE)('%s: un guasto vero di Stripe resta 500 «Errore Stripe»', async (_chi, rotta, ruolo) => {
    stato.ruolo = ruolo;
    stato.creaLink.mockRejectedValue(Object.assign(new Error('boom'), { name: 'StripeAPIError' }));
    const res = await chiama(rotta);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Errore Stripe');
  });
});
