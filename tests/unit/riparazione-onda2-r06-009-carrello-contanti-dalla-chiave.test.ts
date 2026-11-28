import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R06-009 (onda 2) — IL CARRELLO IN CONTANTI SI RITROVA ANCHE SENZA LA RIGA CONTRO IL DOPPIO CLIC.
 *
 * Il carrello in contanti si ritrovava solo dalla riga del tentativo di cassa
 * (`cod_checkout_attempts.order_ids`), che la rotta della cassa scrive dopo gli ordini, a parte. Senza
 * quella riga la regola del negozio che rifiuta non scattava: il pane rifiutato si portava via la
 * consegna e la frutta restava a 1 € di consegna e 1 € al fattorino (R04-007 lo diceva solo agli
 * amministratori). Ora ogni ordine porta la chiave del suo carrello (`orders.cod_cart_key`, migrazione
 * 999p, scritta con l'ordine): senza la riga, la regola scatta dalla chiave.
 *
 * Mai unire carrelli diversi: conta la chiave e il cliente, non i minuti.
 */

vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { finto, carrello, type Riga } from './carrello-finto';

let db: ReturnType<typeof finto>;
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const annulla = (id: string) =>
  annullaERimborsa(db as never, { ...riga(id) } as never, { reason: 'Il negozio ha rifiutato l ordine' } as never);
const avvisiACarrelloDaControllare = () =>
  vi.mocked(notifyAdmins).mock.calls.filter((c) => /carrello da controllare a mano/.test(String(c[0])));

/** Il carrello A: pane (15 €) e frutta (12 €) in contanti, con la chiave del carrello scritta con l'ordine. */
function carrelloA(chiave: string | null = 'ka'): Riga[] {
  const righe = carrello(['pane', 'frutta'], [1500, 1200], 'cod', { creati: ['2026-10-29T10:01:00Z', '2026-10-29T10:01:01Z'] });
  return righe.map((r) => (chiave ? { ...r, cod_cart_key: chiave } : r));
}

beforeEach(() => {
  vi.mocked(notifyAdmins).mockClear();
});

describe('R06-009 · senza la riga del tentativo, il carrello in contanti si ritrova dalla chiave sull ordine', () => {
  it('il pane rifiutato: la frutta prende consegna e fattorino pieni, come con la riga, e nessun avviso', async () => {
    db = finto({ orders: carrelloA(), cod_checkout_attempts: [] });
    // Prima: la frutta a 1 € di consegna e 1 € al fattorino (il secondo negozio del carrello).
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });

    expect(await annulla('pane')).toMatchObject({ ok: true });

    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta'), 'senza la riga la regola del negozio che rifiuta non è scattata').toMatchObject({
      delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15,
    });
    expect(avvisiACarrelloDaControllare(), 'con la chiave il carrello è certo: niente da sistemare a mano').toEqual([]);
  });

  it('con la riga del tentativo vince la riga, come prima', async () => {
    db = finto({
      orders: carrelloA('ka'),
      cod_checkout_attempts: [{ chiave: 'ka', user_id: 'u1', order_ids: [{ id: 'pane' }, { id: 'frutta' }] }],
    });
    await annulla('pane');
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
  });

  it('un altro carrello dello stesso cliente, nato un minuto dopo con la sua chiave, non si tocca', async () => {
    const latte = carrello(['latte'], [900], 'cod', { creati: ['2026-10-29T10:02:00Z'] }).map((r) => ({ ...r, seller_id: 's9', cod_cart_key: 'kb' }));
    db = finto({ orders: [...carrelloA('ka'), ...latte], cod_checkout_attempts: [] });
    const lattePrima = { ...riga('latte') };
    await annulla('pane');
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    expect(riga('latte')).toMatchObject({
      delivery_fee_cents: lattePrima.delivery_fee_cents, rider_fee_cents: lattePrima.rider_fee_cents, total_price: lattePrima.total_price,
    });
  });

  it('la stessa chiave su un ordine di un altro cliente non entra nel carrello', async () => {
    const estraneo = carrello(['estraneo'], [2000], 'cod', { creati: ['2026-10-29T10:01:00Z'] })
      .map((r) => ({ ...r, user_id: 'u2', seller_id: 's7', cod_cart_key: 'ka' }));
    db = finto({ orders: [...carrelloA('ka'), ...estraneo], cod_checkout_attempts: [] });
    const prima = { ...riga('estraneo') };
    await annulla('pane');
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    expect(riga('estraneo')).toMatchObject({ delivery_fee_cents: prima.delivery_fee_cents, total_price: prima.total_price });
  });

  it('un ordine senza chiave (nato prima della migrazione) e senza riga: come prima, niente spostato e l avviso', async () => {
    db = finto({ orders: carrelloA(null), cod_checkout_attempts: [] });
    await annulla('pane');
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
    expect(avvisiACarrelloDaControllare()).toHaveLength(1);
  });

  it('il codice sconto del carrello non torna se la frutta (stesso carrello, dalla chiave) lo tiene ancora', async () => {
    db = finto({
      orders: carrelloA('ka').map((r) => ({ ...r, coupon_code: 'PANE10' })),
      cod_checkout_attempts: [],
    });
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    (db as unknown as { rpc: typeof rpc }).rpc = rpc;
    await annulla('pane');
    const rilasci = rpc.mock.calls.filter((c) => (c as unknown[])[0] === 'release_coupon');
    expect(rilasci, 'il codice è tornato disponibile mentre un altro ordine dello stesso carrello lo usa').toEqual([]);
  });
});
