import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 16/10/2026 (quinto riesame del lotto) — L'AMMINISTRATORE CHE ANNULLA LEGGEVA
 * «QUALCOSA NON HA FUNZIONATO» INVECE DEL MOTIVO.
 *
 * Il caso: un carrello di due negozi pagato con la carta, un rimborso dal
 * cruscotto Stripe non ancora diviso fra i negozi. Nel pannello Ordini
 * l'amministratore preme «Annulla» su uno dei due ordini. La rotta risponde
 * 409 con il motivo, ma la frase era di 265 caratteri: la pagina la passa a
 * `friendlyError`, che sopra i 200 la sostituisce con «Qualcosa non ha
 * funzionato. Riprova fra un momento.». Lui riprovava, e otteneva lo stesso.
 *
 * Gira la rotta VERA con `annullaERimborsa` VERA, e poi lo stesso giro della
 * pagina (app/admin/orders/page.tsx): il messaggio della risposta dentro un
 * Error, e il `friendlyError` VERO. Finti il database, l'accesso
 * dell'amministratore, la chiave di Stripe, il registro e la posta.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: unknown) => unknown) =>
    async (req: unknown, ctx?: { params: Promise<Record<string, string>> }) =>
      h({ req, user: { id: 'admin1' }, profile: { role: 'admin' }, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => {
    throw new Error('finché il rimborso non è diviso, Stripe non va chiamato');
  },
}));

import { POST as annulla } from '@/app/api/admin/orders/[id]/cancel/route';
import { friendlyError } from '@/lib/errors';

const GENERICO = 'Qualcosa non ha funzionato. Riprova fra un momento.';

function ordine(extra: Riga): Riga {
  return {
    user_id: 'cliente1', payment_method: 'card', payment_status: 'PAID', delivery_status: 'DELIVERED',
    stripe_payment_intent: 'pi_1', stripe_session_id: 'cs_1', wallet_applied_cents: 0, cash_confirmed_at: null,
    refunded_amount_cents: 0, coupon_code: null, internal_dispute_status: null,
    ...extra,
  };
}

/** Quello che fa la pagina Ordini quando la rotta risponde con un errore (app/admin/orders/page.tsx). */
async function premeAnnulla(id: string): Promise<{ status: number; aVideo: string; messaggio: string }> {
  const res = await (annulla as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request(`http://x/api/admin/orders/${id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Ordine annullato dall’amministrazione' }),
    }),
    { params: Promise.resolve({ id }) },
  );
  const data = (await res.json()) as { error?: { message?: string } | string };
  const messaggio = typeof data.error === 'object' ? (data.error?.message ?? '') : String(data.error ?? '');
  return { status: res.status, aVideo: friendlyError(new Error(messaggio)), messaggio };
}

beforeEach(() => {
  stato.db = fintoDatabase({
    orders: [
      // Pane Quotidiano e un fioraio, un solo pagamento: i fiori aspettano la divisione di 3 € resi dal cruscotto.
      ordine({ id: 'pane01', seller_id: 'pane-quotidiano', total_price: 15 }),
      ordine({ id: 'fiori1', seller_id: 'fioraio', total_price: 12.9, internal_dispute_status: 'RIMBORSO_DA_RIPARTIRE' }),
    ],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
});

describe('l amministratore annulla un ordine il cui rimborso dal cruscotto aspetta la divisione', () => {
  it('IL CASO DEL RIESAME — legge il motivo e dove dividere, non «riprova»', async () => {
    const { status, aVideo, messaggio } = await premeAnnulla('pane01');

    expect(status).toBe(409);
    expect(aVideo, 'il motivo è sparito: a video resta il messaggio generico').not.toBe(GENERICO);
    expect(aVideo, 'la pagina deve mostrare la frase della rotta intera').toBe(messaggio);
    expect(aVideo).toContain('«Rimborsi dal cruscotto da dividere»');
    expect(stato.db.tabelle.orders!.find((o) => o.id === 'pane01')!.delivery_status, 'l ordine non si annulla').toBe('DELIVERED');
  });

  it('vale anche per l ordine fermo stesso', async () => {
    const { status, aVideo, messaggio } = await premeAnnulla('fiori1');
    expect(status).toBe(409);
    expect(aVideo).toBe(messaggio);
    expect(aVideo).not.toBe(GENERICO);
  });
});
