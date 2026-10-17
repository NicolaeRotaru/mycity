import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * 17/10/2026 — LA CANCELLAZIONE DELL'ACCOUNT NON ASPETTA PIU' NESSUN BONIFICO, E IL BONIFICO SI PAGA LO STESSO.
 *
 * Decisione di Nicola («Semplifica»): via la lista dei bonifici, via l'IBAN salvato, via la
 * cancellazione che aspettava finche' un bonifico risultava «fatto». La cancellazione torna com'era:
 * aspetta solo la cassa del fattorino.
 *
 * Il bonifico non si perde lo stesso, perche' l'avviso a chi paga porta con se' tutto quello che
 * serve. Giulia ha pagato 40 € in contanti, restituisce il prodotto e il negozio approva: l'avviso
 * «💶 Bonifico di rimborso da fare» arriva a chi amministra con la cifra, l'ordine #A1B2C3 e la sua
 * email. Poi Giulia cancella l'account, con un altro reso ancora aperto su un ordine in contanti:
 * la cancellazione riesce subito, e l'avviso sta ancora sulla riga dell'amministratore, con l'email
 * dentro. L'amministratore le scrive e la paga.
 *
 * Girano le rotte VERE, la `refundOrder` VERA e la `cancellaAccount` VERA; finti il database (che
 * alla chiusura dell'account fa le cascate di quello vero), Stripe, l'autenticazione e la posta.
 * Diventa rossa se la cancellazione torna ad aspettare un bonifico, se legge di nuovo l'IBAN o la
 * tabella dei bonifici dei reclami, o se l'avviso perde l'email del cliente.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia' }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { cancellaAccount } from '@/lib/account/cancellazione';
import { verdettoDelGiro } from '@/lib/cron-cancellazioni';
import { formatPriceFromCents } from '@/lib/format';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const ALTRO_ORDINE = 'e5f6a7b8-2222-4222-8222-222222222222';
const EMAIL = 'giulia.bianchi@example.it';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** 40 € pagati in contanti al fattorino, consegnato e incassato ieri. */
function inContanti(id: string): Riga {
  return {
    id, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null,
  };
}

/** Le tabelle lette o scritte dalla cancellazione, e le colonne chieste: quello che la cancellazione guarda. */
let guardate: Array<{ tabella: string; colonne: string }> = [];
let accountChiuso = false;

/**
 * Il client che vede la cancellazione: il finto database dei rimborsi, piu' quello che serve per
 * chiudere un account. Alla chiusura fa le cascate del database vero: le notifiche DELLA persona se
 * ne vanno (008: ON DELETE CASCADE), i suoi ordini e i suoi resi restano senza nome (SET NULL).
 */
function clienteDellaCancellazione() {
  return {
    from(tabella: string) {
      const q = finto.db.client.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const select = q.select.bind(q);
      q.select = (colonne = '*') => {
        guardate.push({ tabella, colonne: String(colonne) });
        return select(colonne);
      };
      q.ilike = (colonna: unknown, valore: unknown) => q.eq(colonna, valore);
      return q;
    },
    rpc: finto.db.client.rpc,
    auth: {
      admin: {
        getUserById: finto.db.client.auth.admin.getUserById,
        deleteUser: async (id: string) => {
          accountChiuso = true;
          const t = finto.db.tabelle;
          t.notifications = (t.notifications ?? []).filter((n) => n.user_id !== id);
          t.profiles = (t.profiles ?? []).filter((p) => p.id !== id);
          for (const o of t.orders ?? []) if (o.user_id === id) o.user_id = null;
          for (const r of t.returns ?? []) if (r.buyer_id === id) r.buyer_id = null;
          finto.db.email[id] = null;
          return { error: null };
        },
      },
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

beforeEach(() => {
  guardate = [];
  accountChiuso = false;
  finto.utente = 'giulia';
  finto.db = creaFintoDatabase({
    orders: [inContanti(ORDINE), inContanti(ALTRO_ORDINE)],
    // Un reso ancora aperto sull'altro ordine in contanti: prima del 17/10 fermava la cancellazione.
    returns: [{ id: 'reso-aperto', order_id: ALTRO_ORDINE, buyer_id: 'giulia', seller_id: 'negozio', status: 'REQUESTED' }],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [{ id: 'sua', user_id: 'giulia', title: 'Il tuo ordine è stato consegnato', body: '' }],
    cod_reconciliations: [],
  });
  finto.db.email.giulia = EMAIL;
});

/** Giulia apre il reso sul primo ordine, il negozio lo approva col rimborso di 40 €. */
async function ilNegozioRimborsaIlReso(): Promise<void> {
  const aperto = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })),
    undefined,
  );
  expect(aperto.status, 'il reso non si e aperto').toBe(201);
  const id = (await aperto.json()).id as string;

  finto.utente = 'negozio';
  const deciso = await (decidi as unknown as Rotta)(
    new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 4000 })),
    { params: Promise.resolve({ id }) },
  );
  expect(deciso.status, JSON.stringify(await deciso.clone().json())).toBe(200);
}

const avvisi = () => notificheConTitolo(finto.db, 'Bonifico di rimborso da fare');

describe('dopo il rimborso dei contanti, la cliente cancella l account', () => {
  it('IL CASO CHE ROMPEVA — la cancellazione riesce subito, senza rinvio e senza motivo', async () => {
    await ilNegozioRimborsaIlReso();
    expect(String(finto.db.tabelle.orders[0].stripe_refund_id)).toMatch(/^bonifico:4000:return_/);

    const esito = await cancellaAccount(clienteDellaCancellazione() as never, 'giulia');

    expect(esito, 'un bonifico da fare o un reso aperto hanno fermato la cancellazione').toMatchObject({ ok: true });
    expect(esito.motivo).toBeUndefined();
    expect(accountChiuso, 'l account non e stato chiuso').toBe(true);
  });

  it('l avviso resta sulla riga dell amministratore, con la cifra, l ordine e l email per scriverle', async () => {
    await ilNegozioRimborsaIlReso();
    await cancellaAccount(clienteDellaCancellazione() as never, 'giulia');

    expect(finto.db.tabelle.notifications.some((n) => n.id === 'sua'), 'le notifiche della cliente sono rimaste').toBe(false);
    expect(avvisi(), 'l avviso del bonifico e sparito con l account').toHaveLength(1);
    const avviso = avvisi()[0];
    expect(avviso.user_id).toBe('admin-1');
    const testo = String(avviso.body);
    expect(testo).toContain(`Bonifico di ${formatPriceFromCents(4000)}`);
    expect(testo).toContain("dell'ordine #A1B2C3");
    expect(testo, 'senza l email nessuno sa a chi scrivere per pagarla').toContain(EMAIL);
  });

  it('la cancellazione non guarda piu l IBAN dei resi ne la tabella dei bonifici dei reclami', async () => {
    await ilNegozioRimborsaIlReso();
    await cancellaAccount(clienteDellaCancellazione() as never, 'giulia');

    expect(guardate.length, 'la cancellazione non ha letto niente: la prova non sta guardando').toBeGreaterThan(0);
    expect(guardate.map((g) => g.tabella)).not.toContain('bonifici_dei_reclami');
    expect(guardate.filter((g) => /iban|intestatario|bonifico/u.test(g.colonne))).toEqual([]);
  });
});

describe('il giro notturno', () => {
  it('un «bonifico da fare» non e piu un rinvio deciso da noi: se tornasse, sarebbe un guasto', () => {
    const verdetto = verdettoDelGiro(
      [{ userId: 'giulia', ok: false, motivo: 'bonifico_da_fare' as never, chiestaIl: new Date().toISOString() }],
      Date.now(),
    );

    expect(verdetto).toMatchObject({ rinviate: 0, fallite: 1, daSvegliare: true });
  });
});
