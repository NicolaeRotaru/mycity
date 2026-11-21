import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R04-007 — Il carrello in contanti si ritrova solo dalla riga del tentativo di cassa: senza quella
 * riga la regola del negozio che rifiuta non scatta, e prima non lo sapeva nessuno.
 *
 * Regola: gli ordini di carrelli diversi non si uniscono mai perché sono nati vicini. Senza la riga
 * non si sposta niente; gli amministratori lo sanno, con quello che serve per sistemarlo a mano.
 * L'esempio del collaudo: il carrello B (b1 annullato, b2 a 1 € di consegna e 1 € al fattorino, con
 * la sua riga) e il carrello A (pane e frutta) senza riga, nato un minuto dopo. Annullo del pane: b2
 * resta a 14 €, la frutta a 13 €, e l'avviso parla della frutta, non di b2.
 */

vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { annullaERimborsa, ricalcolaLaConsegnaDelGiro } from '@/lib/ordini/annulla';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { finto, carrello, type Riga } from './carrello-finto';

let db: ReturnType<typeof finto>;
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
const annulla = (id: string) =>
  annullaERimborsa(db as never, { ...riga(id) } as never, { reason: 'Il negozio ha rifiutato l ordine' } as never);
const avvisi = () =>
  vi.mocked(notifyAdmins).mock.calls.filter((c) => /carrello da controllare a mano/.test(String(c[0])));

/** Il carrello A: pane (15 €) e frutta (12 €) in contanti, nati alle 10:01. */
const carrelloA = () => carrello(['pane', 'frutta'], [1500, 1200], 'cod', { creati: ['2026-10-29T10:01:00Z', '2026-10-29T10:01:01Z'] });

beforeEach(() => {
  vi.mocked(notifyAdmins).mockClear();
});

describe('R04-007 · il carrello in contanti senza la sua riga non passa in silenzio', () => {
  it('senza la riga non si sposta niente, ma gli amministratori sanno quale ordine guardare e con che cifre', async () => {
    db = finto({ orders: carrelloA(), cod_checkout_attempts: [] });
    const fruttaPrima = { ...riga('frutta') };
    expect(await annulla('pane')).toMatchObject({ ok: true });
    expect(riga('pane').delivery_status).toBe('CANCELED');
    // Niente spostato sulla frutta.
    expect(riga('frutta')).toMatchObject({
      delivery_fee_cents: fruttaPrima.delivery_fee_cents,
      rider_fee_cents: fruttaPrima.rider_fee_cents,
      total_price: fruttaPrima.total_price,
    });
    const a = avvisi();
    expect(a, 'gli amministratori lo sanno').toHaveLength(1);
    const testo = String(a[0][1]);
    expect(testo).toContain('#PANE');
    expect(testo).toContain('#FRUTTA');
    expect(testo).toContain('NON è stata rifatta');
    // Le cifre che servono per sistemarlo a mano: quelle di adesso e quelle della regola.
    expect(testo).toContain('consegna 1,00 €, fattorino 1,00 €, totale 13,00 €');
    expect(testo).toContain('la regola darebbe: #FRUTTA consegna 3,00 € e fattorino 3,00 €, totale 15,00 €');
    expect(a[0][3]).toMatchObject({ unaVoltaPer: 'carrello-senza-riga-pane' });
  });

  it('l esempio del collaudo: l ordine dell altro carrello (con la sua riga) non si tocca e non si nomina', async () => {
    const b: Riga[] = carrello(['b1', 'b2'], [1500, 1300], 'cod', { creati: ['2026-10-29T10:00:00Z', '2026-10-29T10:00:01Z'] });
    b[0].delivery_status = 'CANCELED';
    Object.assign(b[1], { delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 14, gross_total_cents: 1400 });
    db = finto({
      orders: [...b, ...carrelloA()],
      cod_checkout_attempts: [{ chiave: 'kb', user_id: 'u1', order_ids: [{ id: 'b1' }, { id: 'b2' }] }],
    });
    await annulla('pane');
    expect(riga('b2')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 14 });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
    const a = avvisi();
    expect(a).toHaveLength(1);
    expect(String(a[0][1])).toContain('#FRUTTA');
    expect(String(a[0][1])).not.toContain('#B2');
  });

  it('con la riga la regola scatta come prima, e nessun avviso', async () => {
    db = finto({ orders: carrelloA(), cod_checkout_attempts: [{ chiave: 'ka', user_id: 'u1', order_ids: [{ id: 'pane' }, { id: 'frutta' }] }] });
    await annulla('pane');
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    expect(avvisi()).toEqual([]);
  });

  it('un ordine da solo (senza riga e senza altri ordini vicini) non manda avvisi', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'cod'), cod_checkout_attempts: [] });
    await annulla('pane');
    expect(avvisi()).toEqual([]);
  });

  it('un ordine nella riga di un carrello solo suo è certo: niente avviso anche con un altro ordine vicino', async () => {
    const solo = carrello(['pane'], [1500], 'cod', { creati: ['2026-10-29T10:01:00Z'] });
    const altro = carrello(['latte'], [900], 'cod', { creati: ['2026-10-29T10:01:30Z'] });
    altro[0].seller_id = 's9';
    db = finto({ orders: [...solo, ...altro], cod_checkout_attempts: [{ chiave: 'k1', user_id: 'u1', order_ids: [{ id: 'pane' }] }] });
    await ricalcolaLaConsegnaDelGiro(db as never, 'pane');
    expect(avvisi()).toEqual([]);
  });
});
