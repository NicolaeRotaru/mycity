import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R05-007 — IL CARRELLO IN CONTANTI SI RITROVA ANCHE DAGLI ORDINI.
 *
 * Pane 15 € + frutta 12 €, alla porta: pane 3 € di consegna e 3 € al fattorino, frutta 1 € e 1 €.
 * Il forno rifiuta: la frutta, rimasta sola, sale a 3 € e 3 € (regola del negozio che rifiuta).
 *
 * Il carrello in contanti si ritrovava solo dalla riga di `cod_checkout_attempts` (la tabella contro
 * il doppio clic). Quella riga può mancare: la cassa la scrive dopo gli ordini e, se non passa, lo
 * dice solo nel registro; le app senza chiave del browser con un negozio solo non la scrivono. Senza
 * la riga la regola non scattava: la frutta restava a 1 € di consegna e 1 € al fattorino, e nessuno
 * lo sapeva. Ora il carrello si ritrova dagli ordini stessi (stesso cliente, contanti, nati nella
 * stessa cassa) e la mancanza della riga resta nel registro.
 */

vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { logger } from '@/lib/logger';
import { finto, carrello, tentativoDiCassa } from './carrello-finto';

type Riga = Record<string, unknown>;
let db: ReturnType<typeof finto>;
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id) as Riga;
const frutta = () => [riga('frutta').delivery_fee_cents, riga('frutta').rider_fee_cents, Math.round(Number(riga('frutta').total_price) * 100)];
const rifiutaIlForno = () => annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'Rifiutato dal negozio' });

beforeEach(() => vi.mocked(logger.warn).mockClear());

describe('R05-007 · il carrello in contanti senza la riga contro il doppio clic', () => {
  it('con la riga la regola scatta (com era già)', async () => {
    db = finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'cod'), cod_checkout_attempts: tentativoDiCassa(['pane', 'frutta']) });
    await rifiutaIlForno();
    expect(frutta()).toEqual([300, 300, 1500]);
  });

  it('senza la riga la regola del negozio che rifiuta scatta lo stesso, e la mancanza resta nel registro', async () => {
    db = finto({ orders: carrello(['pane', 'frutta'], [1500, 1200], 'cod'), cod_checkout_attempts: [] });
    await rifiutaIlForno();
    // Prima la frutta restava a 1 € di consegna e 1 € al fattorino (13 €).
    expect(frutta()).toEqual([300, 300, 1500]);
    expect(vi.mocked(logger.warn).mock.calls.some((c) => /senza la riga del tentativo/.test(String(c[0])))).toBe(true);
  });

  it('un ordine in contanti dello stesso cliente nato molto dopo non entra nel carrello', async () => {
    db = finto({
      orders: carrello(['pane', 'frutta'], [1500, 1200], 'cod', { creati: ['2026-10-29T10:00:00Z', '2026-10-29T11:30:00Z'] }),
      cod_checkout_attempts: [],
    });
    await rifiutaIlForno();
    expect(frutta()).toEqual([100, 100, 1300]);
  });
});
