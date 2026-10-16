import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { type VoceDaBonificare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * Riesame del 16/10, terzo giro — UN CLIENTE SI METTEVA DA SOLO NELLA LISTA DEI BONIFICI DA FARE.
 *
 * In produzione la migrazione 153 non c'e': vale la regola della 024, e un cliente con il suo
 * accesso puo' inserire una riga di reso intera — stato «rimborsato», segno `bonifico:95000:…`,
 * il suo IBAN. La lista dei bonifici prendeva ogni reso rimborsato col segno e lo mostrava a chi
 * paga come «950,00 € da bonificare», senza guardare l'ordine. Nessun segnale diceva che l'ordine
 * non era mai stato rimborsato.
 *
 * Sesto giro: la riga finta non va piu' in un riquadro «da controllare» — non entra proprio. La lista
 * nasce dai segni nell'elenco dei rimborsi dell'ordine, che il cliente non scrive.
 *
 * Qui il mondo e' quello di oggi: la riga finta entra nella tabella dei resi come la scriverebbe
 * il cliente (lo prova, sul database vero ricostruito, tests/sql/rls/43-…). Girano le rotte vere —
 * apertura del reso, decisione del negozio, lista dei bonifici — e la `refundOrder` vera.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'mario' }));

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
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: finto.utente }, req, params: (await ctx?.params) ?? {} }),
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request) => handler({ user: { id: 'admin-1' }, req, params: {} }),
}));

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { GET as listaDeiBonifici } from '@/app/api/admin/rimborsi-da-bonificare/route';

const ORDINE_DI_MARIO = '11111111-1111-4111-8111-111111111111';
const IBAN_DI_MARIO = 'IT60X0542811101000000123456';
const FINTA = '99999999-9999-4999-8999-999999999999';

function ordineInContanti(id: string): Riga {
  return {
    id, user_id: 'mario', seller_id: 'negozio', total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID',
    cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
  };
}

/** La riga che il cliente si scrive da solo, con il suo accesso, senza la 153. */
function rigaScrittaDalCliente(id: string, segno: string): Riga {
  return {
    id, order_id: ORDINE_DI_MARIO, buyer_id: 'mario', seller_id: 'mario', reason: 'DAMAGED',
    status: 'REFUNDED', refund_amount_cents: 95000, refunded_at: new Date().toISOString(),
    refund_id: segno, refund_method: 'BONIFICO', refund_iban: IBAN_DI_MARIO,
    refund_bonifico_cents: 95000, refund_bonifico_fatto_at: null,
  };
}

const json = (corpo: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
});

/** La lista come la riceve la pagina. */
async function laLista(): Promise<{ voci: VoceDaBonificare[]; corpo: Record<string, unknown> }> {
  const res = await (listaDeiBonifici as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/admin/rimborsi-da-bonificare'), undefined,
  );
  expect(res.status).toBe(200);
  const corpo = await res.json();
  return { voci: corpo.voci as VoceDaBonificare[], corpo };
}

/** Un reso vero: Mario lo apre col bonifico, il negozio lo approva con 40 € di rimborso. */
async function resoVeroRimborsato(): Promise<string> {
  finto.utente = 'mario';
  const res = await (apriReso as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/api/returns/create', json({
      orderId: ORDINE_DI_MARIO, reason: 'CHANGED_MIND', rimborso: { modo: 'BONIFICO', iban: IBAN_DI_MARIO },
    })),
    undefined,
  );
  expect(res.status).toBe(201);
  const id = (await res.json()).id as string;
  finto.utente = 'negozio';
  const deciso = await (decidi as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 4000 })),
    { params: Promise.resolve({ id }) },
  );
  expect(deciso.status).toBe(200);
  return id;
}

beforeEach(() => {
  finto.db = creaFintoDatabase({
    orders: [ordineInContanti(ORDINE_DI_MARIO)],
    returns: [],
    order_items: [],
    bonifici_dei_reclami: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
});

describe('la lista dei bonifici non prende per buona una riga di reso scritta dal cliente', () => {
  it('Mario si scrive «950 € da bonificare» sul suo ordine mai rimborsato: non finisce fra i bonifici da pagare', async () => {
    finto.db.tabelle.returns.push(rigaScrittaDalCliente(FINTA, `bonifico:95000:return_${FINTA}`));
    expect(finto.db.tabelle.returns, 'la riga finta non c e: la prova non misura niente').toHaveLength(1);

    const { voci, corpo } = await laLista();
    expect(voci.find((v) => v.id === FINTA), 'la lista mostra a chi paga un bonifico che il sito non ha mai registrato').toBeUndefined();
    expect(JSON.stringify(corpo), 'la riga finta arriva alla pagina da qualche altra parte').not.toContain(FINTA);
  });

  it('copiare il segno di un rimborso vero su una riga nuova non basta: il segno porta l id del reso vero', async () => {
    const vero = await resoVeroRimborsato();
    const segnoVero = finto.db.tabelle.returns.find((r) => r.id === vero)!.refund_id as string;
    expect(segnoVero).toBe(`bonifico:4000:return_${vero}`);
    finto.db.tabelle.returns.push(rigaScrittaDalCliente(FINTA, segnoVero));

    const { voci, corpo } = await laLista();
    expect(voci.find((v) => v.id === FINTA), 'la copia del segno vero passa per un bonifico vero').toBeUndefined();
    expect(JSON.stringify(corpo)).not.toContain(FINTA);
    expect(voci.filter((v) => v.id === vero), 'il bonifico vero non c e, o c e due volte').toHaveLength(1);
  });

  it('il rimborso vero resta confermato: il segno sta anche nell elenco dei rimborsi dell ordine, scritto dal server', async () => {
    const vero = await resoVeroRimborsato();

    const ordine = finto.db.tabelle.orders[0];
    expect(String(ordine.stripe_refund_id ?? ''), 'refundOrder non ha lasciato la conferma sull ordine').toContain(`bonifico:4000:return_${vero}`);
    const { voci } = await laLista();
    const voce = voci.find((v) => v.id === vero);
    expect(voce).toMatchObject({ importoCents: 4000, daFare: true });
    expect(String(voce?.iban).replace(/\s/g, '')).toBe(IBAN_DI_MARIO);
  });
});
