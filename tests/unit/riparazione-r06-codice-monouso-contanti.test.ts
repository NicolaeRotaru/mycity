import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/11/2026 (R06-010) — IL CODICE SCONTO MONOUSO GUARDA ANCHE IL CARRELLO IN CONTANTI.
 *
 * Il codice si rivendica una volta per carrello, ma ogni negozio diventa un ordine suo che porta
 * scritto `coupon_code`. Annullare l'ordine del forno lo restituiva mentre la frutta dello stesso
 * carrello lo teneva ancora: il controllo guardava solo il carrello della carta, e coi contanti un
 * codice monouso tornava libero. Il carrello in contanti si ritrova dalla riga del tentativo di cassa.
 *
 * Se diventa rosso: coi contanti il codice torna in circolo mentre un altro ordine del carrello lo
 * usa, oppure non torna più quando se ne va l'ultimo, o quando la riga del carrello non c'è.
 *
 * Il database finto applica davvero filtri e scritture (tests/unit/carrello-finto.ts).
 */

vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { finto, carrello, tentativoDiCassa } from './carrello-finto';

const CODICE = 'PRIMI50';
const restituzioni: Array<{ p_code: unknown; p_order_id: unknown }> = [];
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const letto = (id: string) => ({ ...riga(id) }) as never;

function database(conLaRiga: boolean) {
  const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod').map((o) => ({ ...o, coupon_code: CODICE }));
  db = finto({ orders: ordini, cod_checkout_attempts: conLaRiga ? tentativoDiCassa(['pane', 'frutta']) : [] });
  db.rpc = (async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'release_coupon') restituzioni.push({ p_code: args.p_code, p_order_id: args.p_order_id });
    return { data: null, error: null };
  }) as typeof db.rpc;
}

beforeEach(() => {
  restituzioni.length = 0;
});

describe('codice monouso su un carrello in contanti di due negozi', () => {
  it('il forno se ne va mentre la frutta tiene il codice: il codice non torna in circolo', async () => {
    database(true);
    const esito = await annullaERimborsa(db as never, letto('pane'), { reason: 'Rifiutato dal negozio' });
    expect(esito).toMatchObject({ ok: true });
    expect(restituzioni, 'il codice monouso è tornato libero mentre la frutta lo usa').toEqual([]);
  });

  it('se ne va anche la frutta, l ultima: il codice torna, una volta sola', async () => {
    database(true);
    await annullaERimborsa(db as never, letto('pane'), { reason: 'Rifiutato dal negozio' });
    await annullaERimborsa(db as never, letto('frutta'), { reason: 'Annullato dal cliente' });
    expect(restituzioni).toEqual([{ p_code: CODICE, p_order_id: 'frutta' }]);
  });

  it('senza la riga del carrello non si sa chi lo tiene: torna come prima', async () => {
    database(false);
    await annullaERimborsa(db as never, letto('pane'), { reason: 'Rifiutato dal negozio' });
    expect(restituzioni).toEqual([{ p_code: CODICE, p_order_id: 'pane' }]);
  });
});
