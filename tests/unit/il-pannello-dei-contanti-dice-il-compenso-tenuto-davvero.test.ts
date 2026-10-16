import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiIncassiDaDichiarare } from '@/lib/rider/leggi-incassi-da-dichiarare';
import { cifreDellIncasso, fraseDelCompenso } from '@/lib/rider/incasso-alla-consegna';
import { campiDellIncasso, type OrdineDaIncassare } from '@/lib/cassa/registra-incasso';

/**
 * 16/10/2026 — «HAI GIA' TRATTENUTO 3 EURO» A CHI NE AVEVA TENUTI 2.
 *
 * Il credito MyCity vale sui contanti e in cassa la spunta e' accesa di
 * default: un ordine da 2 euro in contanti con 3 euro di compenso esiste. Il
 * fattorino incassa 2 euro, se li tiene tutti, e l'euro che manca gli arriva
 * con i compensi sull'IBAN (`campiDellIncasso` lo segna HELD).
 *
 * La bacheca e la pagina dell'ordine passavano al pannello il compenso PIENO:
 * «Previsto: 0,00 € — hai già trattenuto 3,00 € di compenso». Il conto a video
 * non tornava (0 + 3 non fa 2), e quando arrivava il bonifico dell'euro il
 * fattorino non sapeva cos'era.
 */

const NBSP = / /g;

/** Un client di servizio finto: la lettura della bacheca risponde con queste righe. */
function clientCon(righe: Array<Record<string, unknown>>): SupabaseClient {
  const b: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'is', 'order', 'limit']) b[op] = () => b;
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: righe, error: null }).then(r);
  return { from: () => b } as unknown as SupabaseClient;
}

/** 2 euro in contanti (il resto l'ha coperto il credito), compenso 3 euro, consegnato. */
const QUASI_TUTTO_A_CREDITO = {
  id: 'o-credito',
  delivered_at: '2026-10-14T19:00:00Z',
  total_price: 2,
  rider_fee_cents: 300,
  shipping_cost: 0,
  pickup_in_store: false,
  payment_method: 'cod',
  delivery_status: 'DELIVERED',
  cash_confirmed_at: null,
  seller: { store_name: 'Pane Quotidiano' },
};

describe('la bacheca degli incassi da dichiarare', () => {
  it('passa al pannello il compenso tenuto davvero e il resto che arriva sull IBAN', async () => {
    const esito = await leggiIncassiDaDichiarare(clientCon([QUASI_TUTTO_A_CREDITO]), 'fattorino-1');
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    const [riga] = esito.incassi;
    expect(riga.expectedCents).toBe(0);
    expect(riga.compensoTenutoCents, 'la bacheca dice al fattorino un compenso tenuto che non ha mai avuto in mano').toBe(200);
    expect(riga.residuoDovutoCents).toBe(100);
    // Il conto a video deve tornare: contante da rimettere + compenso tenuto = contante incassato.
    expect(riga.expectedCents + riga.compensoTenutoCents).toBe(200);
  });

  it('dice le stesse cifre che l incasso poi scrive sull ordine', () => {
    const cifre = cifreDellIncasso(QUASI_TUTTO_A_CREDITO);
    const campi = campiDellIncasso(QUASI_TUTTO_A_CREDITO as unknown as OrdineDaIncassare, {
      incassatoCents: 0,
      registratoDa: 'fattorino-1',
      adesso: new Date('2026-10-14T19:05:00Z'),
    });
    // Il resto del compenso resta dovuto: lo paga il giro dei compensi.
    expect(campi.rider_payout_status).toBe('HELD');
    expect(cifre.residuoDovutoCents).toBeGreaterThan(0);
  });

  it('su un ordine normale non cambia niente: 25 euro, 3 di compenso tenuti, niente resto', () => {
    expect(cifreDellIncasso({ ...QUASI_TUTTO_A_CREDITO, total_price: 25 })).toEqual({
      expectedCents: 2200, compensoTenutoCents: 300, residuoDovutoCents: 0,
    });
  });
});

describe('la frase sotto l importo', () => {
  it('col credito che copre quasi tutto il conto torna e il resto e spiegato', () => {
    const frase = fraseDelCompenso(cifreDellIncasso(QUASI_TUTTO_A_CREDITO)).replace(NBSP, ' ');
    expect(frase).toContain('hai già trattenuto 2,00 € di compenso');
    expect(frase).not.toContain('3,00 €');
    expect(frase).toContain('Il resto del compenso, 1,00 €, ti arriva sul tuo IBAN.');
  });

  it('col credito che copre tutto non dice «trattenuto»: dice che il compenso arriva sull IBAN', () => {
    const frase = fraseDelCompenso(cifreDellIncasso({ ...QUASI_TUTTO_A_CREDITO, total_price: 0 })).replace(NBSP, ' ');
    expect(frase).not.toContain('trattenuto');
    expect(frase).toContain('Il tuo compenso, 3,00 €, ti arriva sul tuo IBAN.');
  });

  it('su un ordine normale resta la frase di sempre', () => {
    const frase = fraseDelCompenso(cifreDellIncasso({ ...QUASI_TUTTO_A_CREDITO, total_price: 25 })).replace(NBSP, ' ');
    expect(frase).toBe('Previsto: 22,00 € — hai già trattenuto 3,00 € di compenso.');
  });
});
