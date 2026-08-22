import { describe, it, expect } from 'vitest';
import { riepilogoFattorino, type ConsegnaPagata } from '@/lib/guadagni/fattorino';
import { riepilogoContanti, riepilogoNegozio, type OrdineNegozio } from '@/lib/guadagni/negozio';
import { COMPENSO_RIDER_CENTS } from '@/lib/constants';

/**
 * #163 e #60 — LE DUE PAGINE «GUADAGNI» MOSTRAVANO NUMERI CHE NON ERANO QUELLI
 * ARRIVATI SUL CONTO.
 *
 * Al fattorino: sommavano quanto ha pagato il CLIENTE per la spedizione, non
 * il suo compenso. Sopra i 30 euro di spesa la spedizione è gratis, quindi la
 * consegna compariva a zero.
 *
 * Al negoziante: sommavano il netto senza togliere quello che era già tornato
 * indietro per rimborsi e contestazioni, e gli ordini col bonifico in corso
 * sparivano da tutte e due le colonne.
 */

const consegna = (o: Partial<ConsegnaPagata>): ConsegnaPagata => ({
  rider_fee_cents: COMPENSO_RIDER_CENTS,
  shipping_cost: 0,
  rider_payout_status: null,
  payment_method: 'card',
  ...o,
});

describe('i guadagni del fattorino', () => {
  it('conta il compenso anche quando la spedizione per il cliente è gratis', () => {
    // Consegna sopra soglia: shipping_cost = 0, compenso 3 euro.
    const r = riepilogoFattorino([consegna({ shipping_cost: 0 })]);
    expect(r.totale).toBe(COMPENSO_RIDER_CENTS / 100);
    expect(r.media).toBe(COMPENSO_RIDER_CENTS / 100);
  });

  it('tiene separati versati, in arrivo e tenuti in contanti', () => {
    const r = riepilogoFattorino([
      consegna({ payment_method: 'card', rider_payout_status: 'TRANSFERRED' }),
      consegna({ payment_method: 'card', rider_payout_status: 'HELD' }),
      consegna({ payment_method: 'cod', rider_payout_status: 'CASH_WITHHELD' }),
    ]);
    expect(r.versati).toBe(3);
    expect(r.inArrivo).toBe(3);
    // Il contante non è né versato né in arrivo: se lo è tenuto alla consegna.
    expect(r.inContanti).toBe(3);
    expect(r.totale).toBe(9);
  });

  it('sulle consegne vecchie, senza la colonna, ripiega sul prezzo di spedizione', () => {
    const r = riepilogoFattorino([consegna({ rider_fee_cents: null, shipping_cost: 4.9 })]);
    expect(r.totale).toBe(4.9);
  });

  it('senza consegne la media è zero, non una divisione per zero', () => {
    expect(riepilogoFattorino([]).media).toBe(0);
  });
});

const ordine = (o: Partial<OrdineNegozio>): OrdineNegozio => ({
  total_price: 50,
  payment_method: 'card',
  payout_status: 'TRANSFERRED',
  seller_payout_cents: 4500,
  seller_payout_reversed_cents: 0,
  refunded_amount_cents: 0,
  application_fee_cents: 500,
  ...o,
});

describe('i guadagni del negoziante', () => {
  it('toglie dall incassato quello che è tornato indietro con uno storno parziale', () => {
    // Ordine pagato e poi stornato per 10 euro: sull'IBAN sono rimasti 35.
    const r = riepilogoNegozio([ordine({ seller_payout_reversed_cents: 1000 })]);
    expect(r.versatiCents).toBe(3500);
    expect(r.stornatiCents).toBe(1000);
  });

  it('conta il bonifico in corso fra quelli in arrivo, invece di farlo sparire', () => {
    const r = riepilogoNegozio([
      ordine({ payout_status: 'HELD' }),
      ordine({ payout_status: 'PROCESSING' }),
    ]);
    expect(r.inArrivoCents).toBe(9000);
    expect(r.versatiCents).toBe(0);
  });

  it('il lordo toglie i rimborsi parziali', () => {
    const r = riepilogoNegozio([ordine({ refunded_amount_cents: 2000 })]);
    expect(r.lordoCents).toBe(3000);
  });

  it('gli ordini in contanti non entrano nei conti dei bonifici', () => {
    const r = riepilogoNegozio([ordine({ payment_method: 'cod', payout_status: 'CASH_IN_STORE' })]);
    expect(r.lordoCents).toBe(0);
    expect(r.versatiCents).toBe(0);
    expect(r.inArrivoCents).toBe(0);
  });

  it('uno storno più grande del netto non produce un incassato negativo', () => {
    const r = riepilogoNegozio([ordine({ seller_payout_reversed_cents: 99999 })]);
    expect(r.versatiCents).toBe(0);
  });
});

/**
 * 22/8/2026 — IL CONTRASSEGNO NELLA PAGINA «GUADAGNI».
 *
 * Due bugie diverse, sullo stesso riquadro.
 *
 * ① I bonifici del contrassegno non comparivano da nessuna parte. Gli ordini
 * in contanti venivano scartati alla prima riga, tutti — ma quando il fattorino
 * porta la cassa e viene confermata, parte un bonifico vero, con lo stesso
 * stato degli altri. Il negoziante lo riceveva sull'IBAN senza trovarlo scritto.
 *
 * ② Il numero grande era il totale del cliente, chiamato col nome del netto.
 * Dentro il contante che il cliente mette in mano al fattorino ci sono la
 * consegna, la spedizione e la commissione: soldi che al negozio non arrivano.
 */
describe('i contanti del negoziante', () => {
  it('conta fra i versati un ordine in contanti il cui bonifico e gia partito', () => {
    const r = riepilogoNegozio([
      ordine({ payment_method: 'cod', payout_status: 'TRANSFERRED', seller_payout_cents: 4500 }),
    ]);
    // Col codice vecchio qui c'era 0: il bonifico era partito e non si vedeva.
    expect(r.versatiCents).toBe(4500);
  });

  it('conta fra quelli in arrivo un contrassegno in liquidazione', () => {
    const r = riepilogoNegozio([ordine({ payment_method: 'cod', payout_status: 'HELD' })]);
    expect(r.inArrivoCents).toBe(4500);
  });

  it('tiene separato il contante raccolto dal netto che arriva al negozio', () => {
    // Ordine da 50 euro: il cliente ne da 50 al fattorino, al negozio ne restano 45.
    const c = riepilogoContanti(
      [ordine({ payment_method: 'cod', total_price: 50, seller_payout_cents: 4500 })],
      () => true,
    );
    expect(c.incassatoDalFattorinoCents).toBe(5000);
    expect(c.nettoAlNegozioCents).toBe(4500);
  });

  it('un ordine non ancora consegnato non entra nei contanti', () => {
    const c = riepilogoContanti([ordine({ payment_method: 'cod' })], () => false);
    expect(c.incassatoDalFattorinoCents).toBe(0);
  });
});
