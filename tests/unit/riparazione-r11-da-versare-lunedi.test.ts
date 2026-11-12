import { describe, it, expect } from 'vitest';
import { daVersareLunedi, gruppoDelPannello, settimanaPrima, type OrdineDelPannello } from '@/lib/guadagni/negozio';

/**
 * R11-001 — Il pannello dei bonifici dice a Nicola quanto versare a ogni negozio
 * il lunedì. Prima i contanti ancora in mano al fattorino, gli storni non
 * riusciti e i ritiri pagati al banco finivano fra i «Da pagare», i contanti con
 * la rimessa confermata fra gli «In sospeso», e gli importi non toglievano gli
 * storni. Orologio finto: lunedì 16 novembre 2026, ore 9 a Piacenza.
 */

const LUNEDI = new Date('2026-11-16T08:00:00Z');
const o = (extra: Partial<OrdineDelPannello>): OrdineDelPannello => ({
  payment_method: 'cod',
  payout_status: 'HELD',
  seller_payout_cents: 1800,
  seller_payout_reversed_cents: 0,
  delivered_at: '2026-11-12T10:00:00Z',
  ...extra,
});

describe('R11-001 — gli stati nel pannello', () => {
  it('i contanti con la rimessa confermata sono «da versare», non «in sospeso»', () => {
    expect(gruppoDelPannello(o({})).gruppo).toBe('da_versare');
  });
  it('contanti ancora dal fattorino, storno non riuscito, ritiro al banco: mai fra i da versare', () => {
    expect(gruppoDelPannello(o({ payout_status: 'AWAITING_REMITTANCE' })).gruppo).toBe('in_sospeso');
    expect(gruppoDelPannello(o({ payout_status: 'AWAITING_REMITTANCE' })).etichetta).toBe('Contanti dal fattorino');
    expect(gruppoDelPannello(o({ payout_status: 'REVERSAL_FAILED' })).gruppo).toBe('fuori');
    expect(gruppoDelPannello(o({ payout_status: 'CASH_IN_STORE' })).gruppo).toBe('fuori');
  });
  it('la carta HELD la paga il giro: in sospeso, non da versare a mano', () => {
    expect(gruppoDelPannello(o({ payment_method: 'card' })).gruppo).toBe('in_sospeso');
  });
  it('il bonifico fatto a mano è pagato', () => {
    expect(gruppoDelPannello(o({ payout_status: 'PAID_MANUALLY' })).gruppo).toBe('pagato');
  });
});

describe('R11-001 — quanto versare il lunedì', () => {
  it('la settimana prima va da lunedì a domenica, ora di Piacenza', () => {
    expect(settimanaPrima(LUNEDI)).toEqual({ dal: '2026-11-09', al: '2026-11-15' });
    // Domenica 15 alle 23:30 a Piacenza è ancora la settimana in corso.
    expect(settimanaPrima(new Date('2026-11-15T22:30:00Z'))).toEqual({ dal: '2026-11-02', al: '2026-11-08' });
  });

  it('somma i contanti rimessi della settimana prima e gli arretrati, al netto degli storni', () => {
    const r = daVersareLunedi(
      [
        o({}),
        o({ seller_payout_reversed_cents: 500 }), // rimborso parziale: si versano 13 €
        o({ delivered_at: '2026-11-01T10:00:00Z' }), // arretrato
        o({ delivered_at: '2026-11-16T07:00:00Z' }), // di questa settimana: il prossimo lunedì
        o({ delivered_at: '2026-11-15T23:30:00Z' }), // lunedì 16 alle 00:30 a Piacenza: questa settimana
        o({ payout_status: 'AWAITING_REMITTANCE' }),
        o({ payout_status: 'CASH_IN_STORE' }),
        o({ payment_method: 'card' }),
      ],
      LUNEDI,
    );
    expect(r).toEqual({ cents: 1800 + 1300 + 1800, ordini: 3 });
  });
});
