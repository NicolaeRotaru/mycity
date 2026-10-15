import { describe, it, expect } from 'vitest';
import {
  serveLaSceltaDelRimborso,
  pagamentoPerChiDecide,
  quantoSiPuoRestituire,
  ripartoDelRimborso,
  statoDelReclamoSullOrdine,
  type OrdineDaRimborsare,
} from '@/lib/rimborsi/regole-del-rimborso';
import { ibanValido, leggiSceltaDelRimborso, normalizzaIban } from '@/lib/rimborsi/scelta-del-cliente';
import { comeTornanoIContanti } from '@/lib/rimborsi/scelta-del-reso';
import { vociDeiBonificiDaFare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * LE REGOLE DEL RIMBORSO, ESEGUITE (R71 · R76 · R84).
 *
 * Le tre domande che prima avevano risposte diverse a seconda di chi le faceva
 * stanno in lib/rimborsi/: qui si eseguono sui casi veri delle schede.
 */

/** Un maglione da 40 € pagato al fattorino, consegnato e incassato. */
const maglione: OrdineDaRimborsare = {
  stripe_payment_intent: null,
  payment_method: 'cod',
  gross_total_cents: 4000,
  total_price: 40,
  wallet_applied_cents: 0,
  refunded_amount_cents: 0,
  cash_confirmed_at: '2026-10-10T18:00:00Z',
  payment_status: 'PAID',
  delivery_status: 'DELIVERED',
};

/** 50 € lordi: 20 pagati col credito MyCity, 30 in contanti incassati. */
const misto: OrdineDaRimborsare = {
  ...maglione,
  gross_total_cents: 5000,
  total_price: 30,
  wallet_applied_cents: 2000,
};

describe('R84 — si restituisce solo quello che il cliente ha dato davvero', () => {
  it('ordine in contanti mai incassato e senza credito: niente da restituire', () => {
    // Scenario della scheda: 24 € in contanti, il fattorino non arriva, nessuno incassa.
    const maiArrivato: OrdineDaRimborsare = {
      ...maglione, gross_total_cents: 2400, total_price: 24,
      cash_confirmed_at: null, payment_status: 'PENDING', delivery_status: 'OUT_FOR_DELIVERY',
    };
    expect(quantoSiPuoRestituire(maiArrivato)).toEqual({ massimoCents: 0, perche: 'nessun-incasso' });
  });

  it('mai incassato ma pagato in parte col credito: si restituisce solo il credito speso', () => {
    const conCredito = { ...misto, cash_confirmed_at: null, payment_status: 'PENDING', delivery_status: 'ASSIGNED' };
    expect(quantoSiPuoRestituire(conCredito)).toEqual({ massimoCents: 2000, perche: 'ok' });
  });

  it('annullato e mai incassato: il credito l ha gia restituito l annullo, qui niente', () => {
    const annullato = { ...misto, cash_confirmed_at: null, payment_status: 'FAILED', delivery_status: 'CANCELED' };
    expect(quantoSiPuoRestituire(annullato).perche).toBe('nessun-incasso');
  });

  it('consegnato col codice ma incasso non confermato nell app: il cliente ha pagato alla consegna', () => {
    const dimenticato = { ...maglione, cash_confirmed_at: null, payment_status: 'PENDING', delivery_status: 'DELIVERED' };
    expect(quantoSiPuoRestituire(dimenticato)).toEqual({ massimoCents: 4000, perche: 'ok' });
  });

  it('il ritiro in negozio pagato al banco conta come incassato (PAID senza conferma del fattorino)', () => {
    // Lo stato di consegna qui non aiuta: conta solo il PAID scritto da chi ha incassato.
    const alBanco = { ...maglione, cash_confirmed_at: null, payment_status: 'PAID', delivery_status: 'READY' };
    expect(quantoSiPuoRestituire(alBanco)).toEqual({ massimoCents: 4000, perche: 'ok' });
  });

  it('incassato: il lordo meno quello che e gia tornato', () => {
    expect(quantoSiPuoRestituire({ ...misto, refunded_amount_cents: 3000 })).toEqual({ massimoCents: 2000, perche: 'ok' });
    expect(quantoSiPuoRestituire({ ...misto, refunded_amount_cents: 5000 }).perche).toBe('gia-rimborsato');
  });

  it('sulla carta non cambia niente: il lordo meno il gia rimborsato', () => {
    const carta = { ...maglione, stripe_payment_intent: 'pi_1', payment_method: 'card', cash_confirmed_at: null, payment_status: 'PAID' };
    expect(quantoSiPuoRestituire({ ...carta, refunded_amount_cents: 1000 })).toEqual({ massimoCents: 3000, perche: 'ok' });
  });
});

describe('R84 — il pannello dei reclami mostra come ha pagato il cliente e quanto si puo restituire', () => {
  it('contanti non incassati: lo dice, massimo zero, e il perche', () => {
    const r = pagamentoPerChiDecide({ ...maglione, cash_confirmed_at: null, payment_status: 'PENDING', delivery_status: 'OUT_FOR_DELIVERY' });
    expect(r.comeHaPagato).toContain('NON incassati');
    expect(r.massimoCents).toBe(0);
    expect(r.avviso).toContain('non è stato incassato niente');
  });
  it('contanti incassati con credito: tutto quello che il cliente ha dato', () => {
    const r = pagamentoPerChiDecide(misto);
    expect(r.comeHaPagato).toContain('incassati');
    expect(r.comeHaPagato).toContain('20.00 € di credito MyCity');
    expect(r).toMatchObject({ massimoCents: 5000, avviso: null });
  });
});

describe('R71 — i contanti tornano col bonifico, il credito solo se scelto', () => {
  it('nessuna scelta: tutto col bonifico', () => {
    expect(ripartoDelRimborso(maglione, 4000, null)).toMatchObject({ modo: 'bonifico', creditoCents: 0, bonificoCents: 4000 });
  });

  it('scelto il credito: tutto credito, e lo dice', () => {
    expect(ripartoDelRimborso(maglione, 4000, 'CREDITO')).toMatchObject({
      modo: 'credito', creditoCents: 4000, bonificoCents: 0, creditoScelto: true,
    });
  });

  it('la parte pagata col credito torna credito anche se il cliente vuole il bonifico', () => {
    // 50 €: 20 di credito e 30 in contanti. Rimborso pieno → 20 credito, 30 bonifico.
    expect(ripartoDelRimborso(misto, 5000, 'BONIFICO')).toMatchObject({ modo: 'misto', creditoCents: 2000, bonificoCents: 3000 });
    // Rimborso di 10 € → in proporzione: 4 di credito, 6 col bonifico.
    expect(ripartoDelRimborso(misto, 1000, null)).toMatchObject({ creditoCents: 400, bonificoCents: 600 });
  });

  it('un credito regalato non diventa soldi sul conto', () => {
    // Ordine pagato tutto col credito (premio fedelta'): niente bonifico, mai.
    const tuttoCredito = { ...maglione, total_price: 0, wallet_applied_cents: 4000 };
    expect(ripartoDelRimborso(tuttoCredito, 4000, 'BONIFICO')).toMatchObject({
      modo: 'credito', creditoCents: 4000, bonificoCents: 0, creditoScelto: false,
    });
  });

  it('la carta torna sulla carta, qualunque cosa arrivi', () => {
    const carta = { ...maglione, stripe_payment_intent: 'pi_1', payment_method: 'card' };
    expect(ripartoDelRimborso(carta, 4000, 'CREDITO')).toMatchObject({ modo: 'carta', cartaCents: 4000, creditoCents: 0 });
  });

  it('una scelta che non si e potuta leggere vale bonifico, mai credito', () => {
    expect(comeTornanoIContanti({ modo: null, iban: null, letta: false })).toMatchObject({ modo: 'BONIFICO' });
    expect(comeTornanoIContanti({ modo: 'CREDITO', iban: null, letta: true })).toEqual({ modo: 'CREDITO' });
    expect(comeTornanoIContanti({ modo: 'BONIFICO', iban: 'IT60X0542811101000000123456', letta: true })).toMatchObject({
      modo: 'BONIFICO', ibanFinale: '3456',
    });
  });
});

describe('R71 — il modulo di reso: IBAN scritto giusto, scelta espressa', () => {
  it('riconosce un IBAN vero e scarta quello con una cifra sbagliata', () => {
    expect(ibanValido('IT60 X054 2811 1010 0000 0123 456')).toBe(true);
    expect(ibanValido('IT60X0542811101000000123457')).toBe(false); // una cifra cambiata
    expect(ibanValido('IT60X05428111010000001234')).toBe(false); // troppo corto per l'Italia
    expect(ibanValido('DE89370400440532013000')).toBe(true);
    expect(ibanValido('US12345678901234567890')).toBe(false); // fuori dall'area SEPA
    expect(normalizzaIban(' it60-x054.2811 ')).toBe('IT60X0542811');
  });

  it('contanti + bonifico senza IBAN o con IBAN storto: si corregge prima di inviare', () => {
    expect(leggiSceltaDelRimborso({ modo: 'BONIFICO', iban: '' }, { pagatoInContanti: true }).ok).toBe(false);
    expect(leggiSceltaDelRimborso({ modo: 'BONIFICO', iban: 'IT00X123' }, { pagatoInContanti: true }).ok).toBe(false);
    expect(leggiSceltaDelRimborso({ modo: 'BONIFICO', iban: 'it60 x054 2811 1010 0000 0123 456' }, { pagatoInContanti: true })).toEqual({
      ok: true, scelta: { modo: 'BONIFICO', iban: 'IT60X0542811101000000123456' },
    });
  });

  it('la domanda si fa solo se c e una parte pagata in contanti', () => {
    expect(serveLaSceltaDelRimborso(maglione)).toBe(true);
    expect(serveLaSceltaDelRimborso({ ...maglione, total_price: 0, wallet_applied_cents: 4000 })).toBe(false);
    expect(serveLaSceltaDelRimborso({ ...maglione, stripe_payment_intent: 'pi_1', payment_method: 'card' })).toBe(false);
  });

  it('il credito e una scelta espressa; senza scelta il reso si apre lo stesso', () => {
    expect(leggiSceltaDelRimborso({ modo: 'CREDITO' }, { pagatoInContanti: true })).toEqual({ ok: true, scelta: { modo: 'CREDITO' } });
    expect(leggiSceltaDelRimborso(undefined, { pagatoInContanti: true })).toEqual({ ok: true, scelta: null });
    // Sulla carta non si sceglie niente.
    expect(leggiSceltaDelRimborso({ modo: 'CREDITO' }, { pagatoInContanti: false })).toEqual({ ok: true, scelta: null });
  });
});

describe('R76 — LOST solo se chi ha mosso i soldi dice «tutto»', () => {
  it('rimborso parziale per i soldi → RESOLVED, il negozio viene pagato del resto', () => {
    expect(statoDelReclamoSullOrdine({ rimborsoEmesso: true, rimborsoPieno: false })).toBe('RESOLVED');
  });
  it('rimborso pieno → LOST; nessun rimborso → RESOLVED', () => {
    expect(statoDelReclamoSullOrdine({ rimborsoEmesso: true, rimborsoPieno: true })).toBe('LOST');
    expect(statoDelReclamoSullOrdine({ rimborsoEmesso: false, rimborsoPieno: false })).toBe('RESOLVED');
  });
});

describe('R71 — la lista dei bonifici da fare', () => {
  it('mostra solo i bonifici, prima quelli da fare, con la cifra del bonifico e l IBAN leggibile', () => {
    const voci = vociDeiBonificiDaFare([
      { id: 'r1', order_id: 'o1', refund_amount_cents: 5000, refunded_at: '2026-10-10', refund_id: 'bonifico:return_r1',
        refund_iban: 'IT60X0542811101000000123456', refund_bonifico_cents: 3000, refund_bonifico_fatto_at: null },
      { id: 'r2', order_id: 'o2', refund_amount_cents: 1000, refunded_at: '2026-10-12', refund_id: 'wallet:return_r2' },
      { id: 'r3', order_id: 'o3', refund_amount_cents: 800, refunded_at: '2026-10-13', refund_id: 'bonifico:return_r3',
        refund_bonifico_fatto_at: '2026-10-14' },
    ]);
    expect(voci.map((v) => v.resoId)).toEqual(['r1', 'r3']);
    expect(voci[0]).toMatchObject({ importoCents: 3000, iban: 'IT60 X054 2811 1010 0000 0123 456', daFare: true });
    expect(voci[1]).toMatchObject({ importoCents: 800, iban: null, daFare: false });
  });
});
