import { describe, it, expect } from 'vitest';
import {
  haUnaParteInContanti,
  comeSiDivideIlReclamo,
  pagamentoPerChiDecide,
  quantoSiPuoRestituire,
  ripartoDelRimborso,
  statoDelReclamoSullOrdine,
  type OrdineDaRimborsare,
} from '@/lib/rimborsi/regole-del-rimborso';
import {
  centesimiDelBonificoDalSegno,
  eUnBonificoDiRimborso,
  segnoDelBonifico,
} from '@/lib/rimborsi/bonifici-da-fare';
import { formatPriceFromCents } from '@/lib/format';

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

  it('mai incassato ma pagato in parte col credito: qui niente, il credito lo restituisce l annullo (una volta sola)', () => {
    // Collaudo del 15/10: contare qui il credito di un ordine fermo voleva dire restituirlo due
    // volte — col reclamo, e poi con l'annullo dell'ordine, che lo restituisce da solo.
    const conCredito = { ...misto, cash_confirmed_at: null, payment_status: 'PENDING', delivery_status: 'ASSIGNED' };
    expect(quantoSiPuoRestituire(conCredito)).toEqual({ massimoCents: 0, perche: 'nessun-incasso' });
  });

  it('un rimborso fatto prima di questo lotto non rende «incassato» un ordine mai pagato', () => {
    // Prima di R84 un reclamo poteva rimborsare un ordine fermo, che restava PARTIALLY_REFUNDED.
    // Lo stato del pagamento dopo un rimborso dice cosa e' TORNATO, non cosa era ARRIVATO.
    const giaRimborsatoInParte = {
      ...misto, cash_confirmed_at: null, delivery_status: 'ACCEPTED',
      payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000,
    };
    expect(quantoSiPuoRestituire(giaRimborsatoInParte)).toEqual({ massimoCents: 0, perche: 'nessun-incasso' });
    expect(quantoSiPuoRestituire({ ...giaRimborsatoInParte, payment_status: 'REFUNDED' }).perche).toBe('nessun-incasso');
    // Lo stesso ordine incassato davvero (consegnato) e rimborsato in parte resta rimborsabile del resto.
    expect(quantoSiPuoRestituire({ ...giaRimborsatoInParte, delivery_status: 'DELIVERED' })).toEqual({
      massimoCents: 4000, perche: 'ok',
    });
  });

  it('annullato e mai incassato: il credito l ha gia restituito l annullo, qui niente', () => {
    const annullato = { ...misto, cash_confirmed_at: null, payment_status: 'FAILED', delivery_status: 'CANCELED' };
    expect(quantoSiPuoRestituire(annullato).perche).toBe('nessun-incasso');
  });

  /**
   * Collaudo del 15/10, secondo giro — la guardia «e non annullato» non aveva
   * una prova: toglierla lasciava tutto verde. Un ordine incassato (contanti
   * confermati) e poi annullato: l'annullo ha gia' restituito il credito, quindi
   * qui si restituiscono solo i contanti.
   */
  it('incassato e poi annullato: i contanti si restituiscono, il credito no (l ha gia ridato l annullo)', () => {
    const incassatoEAnnullato = { ...misto, delivery_status: 'CANCELED' };
    expect(quantoSiPuoRestituire(incassatoEAnnullato), 'il credito tornerebbe due volte').toEqual({
      massimoCents: 3000, perche: 'ok',
    });
    expect(ripartoDelRimborso(incassatoEAnnullato, 3000)).toMatchObject({ creditoCents: 0, bonificoCents: 3000 });
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
  it('ordine fermo pagato in parte col credito: massimo zero, e manda ad annullare (il credito torna una volta)', () => {
    const r = pagamentoPerChiDecide({ ...misto, cash_confirmed_at: null, payment_status: 'PENDING', delivery_status: 'ACCEPTED' });
    expect(r.comeHaPagato).toContain('NON incassati');
    expect(r.comeHaPagato).toContain(`${formatPriceFromCents(2000)} di credito MyCity`);
    expect(r.massimoCents, 'il pannello indica una cifra che, sommata all annullo, restituisce il credito due volte').toBe(0);
    expect(r.avviso).toContain('annullalo');
  });
  it('dopo un rimborso vecchio su un ordine mai pagato, il pannello non lo dice «incassato»', () => {
    const r = pagamentoPerChiDecide({
      ...misto, cash_confirmed_at: null, delivery_status: 'ACCEPTED', payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000,
    });
    expect(r.comeHaPagato).toContain('NON incassati');
    expect(r.massimoCents).toBe(0);
  });
  it('contanti incassati con credito: tutto quello che il cliente ha dato', () => {
    const r = pagamentoPerChiDecide(misto);
    expect(r.comeHaPagato).toContain('incassati');
    expect(r.comeHaPagato).toContain(`${formatPriceFromCents(2000)} di credito MyCity`);
    expect(r).toMatchObject({ massimoCents: 5000, avviso: null });
  });
});

describe('R71 — i contanti tornano sempre col bonifico, il credito speso torna credito', () => {
  it('tutto in contanti: tutto col bonifico, e il riparto non prende una scelta', () => {
    expect(ripartoDelRimborso(maglione, 4000)).toEqual({ modo: 'bonifico', cartaCents: 0, creditoCents: 0, bonificoCents: 4000 });
    // La firma ha due argomenti: una scelta del cliente non ha piu' un posto dove entrare.
    expect(ripartoDelRimborso.length).toBe(2);
  });

  it('la parte pagata col credito torna credito, i contanti col bonifico, in proporzione', () => {
    // 50 €: 20 di credito e 30 in contanti. Rimborso pieno → 20 credito, 30 bonifico.
    expect(ripartoDelRimborso(misto, 5000)).toMatchObject({ modo: 'misto', creditoCents: 2000, bonificoCents: 3000 });
    // Rimborso di 10 € → 4 di credito, 6 col bonifico; di 30 € → 12 e 18.
    expect(ripartoDelRimborso(misto, 1000)).toMatchObject({ creditoCents: 400, bonificoCents: 600 });
    expect(ripartoDelRimborso(misto, 3000)).toMatchObject({ creditoCents: 1200, bonificoCents: 1800 });
  });

  it('senza la colonna del lordo (124) il riparto e lo stesso: i contanti non diventano credito', () => {
    // 30 € in contanti e 20 di credito, ordine nato senza gross_total_cents. Con la 124 un rimborso
    // di 30 € fa 12 di credito e 18 col bonifico; senza, faceva 20 di credito e 10 col bonifico.
    const senzaLordo = { ...misto, gross_total_cents: null };
    expect(ripartoDelRimborso(senzaLordo, 3000)).toMatchObject({ creditoCents: 1200, bonificoCents: 1800 });
    // E il tetto resta quello del database (accumula_rimborso, sullo stesso ripiego): la cassa.
    expect(quantoSiPuoRestituire(senzaLordo)).toEqual({ massimoCents: 3000, perche: 'ok' });
  });

  it('un credito regalato non diventa soldi sul conto', () => {
    // Ordine pagato tutto col credito (premio fedelta'): niente bonifico, mai.
    const tuttoCredito = { ...maglione, total_price: 0, wallet_applied_cents: 4000 };
    expect(ripartoDelRimborso(tuttoCredito, 4000)).toMatchObject({ modo: 'credito', creditoCents: 4000, bonificoCents: 0 });
  });

  it('la carta torna sulla carta', () => {
    const carta = { ...maglione, stripe_payment_intent: 'pi_1', payment_method: 'card' };
    expect(ripartoDelRimborso(carta, 4000)).toMatchObject({ modo: 'carta', cartaCents: 4000, creditoCents: 0, bonificoCents: 0 });
  });

  it('il modulo di reso dice «bonifico» solo se c e una parte pagata in contanti', () => {
    expect(haUnaParteInContanti(maglione)).toBe(true);
    expect(haUnaParteInContanti(misto)).toBe(true);
    expect(haUnaParteInContanti({ ...maglione, total_price: 0, wallet_applied_cents: 4000 })).toBe(false);
    expect(haUnaParteInContanti({ ...maglione, stripe_payment_intent: 'pi_1', payment_method: 'card' })).toBe(false);
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

describe('R71 — il segno del bonifico sull ordine', () => {
  it('porta la cifra e la restituisce uguale', () => {
    const segno = segnoDelBonifico('return_r1', 3000);
    expect(segno).toBe('bonifico:3000:return_r1');
    expect(eUnBonificoDiRimborso(segno)).toBe(true);
    expect(centesimiDelBonificoDalSegno(segno)).toBe(3000);
    expect(eUnBonificoDiRimborso('wallet:return_r1')).toBe(false);
    expect(centesimiDelBonificoDalSegno('wallet:return_r1')).toBeNull();
    expect(centesimiDelBonificoDalSegno('bonifico:return_r1')).toBeNull();
  });
});

/**
 * Collaudo del 15/10, terzo giro — sul reclamo di un ordine misto chi decide legge la divisione
 * PRIMA di premere. Scrive 30 € pensando ai contanti: la regola ne fa 12 di credito e 18 di bonifico.
 */
describe('il pannello dei reclami dice come si divide la cifra', () => {
  it('ordine misto, 30 €: 12 tornano come credito e 18 col bonifico', () => {
    const frase = comeSiDivideIlReclamo(misto, 3000);
    expect(frase, 'chi decide non sa che 30 € non sono «i contanti»').not.toBeNull();
    expect(frase).toContain(`Di ${formatPriceFromCents(3000)}, ${formatPriceFromCents(1200)} tornano come credito MyCity`);
    expect(frase).toContain(`e ${formatPriceFromCents(1800)} col bonifico`);
  });
  it('dice le stesse cifre che il rimborso usera davvero', () => {
    const r = ripartoDelRimborso(misto, 3000)!;
    expect(comeSiDivideIlReclamo(misto, 3000)).toContain(formatPriceFromCents(r.creditoCents));
    expect(comeSiDivideIlReclamo(misto, 3000)).toContain(formatPriceFromCents(r.bonificoCents));
  });
  /**
   * Riesame del 16/10, quarto giro — la frase descriveva la divisione della cifra TAGLIATA al
   * massimo, mentre la rotta dei reclami rifiuta qualunque cifra sopra il massimo. Il caso della
   * scheda: ordine da 50 € (20 di credito, 30 in contanti), 40 € gia rimborsati, chi decide scrive 30.
   */
  it('oltre il massimo non descrive una divisione: dice che la cifra supera il rimborsabile', () => {
    const giaRimborsatoQuasiTutto: OrdineDaRimborsare = { ...misto, refunded_amount_cents: 4000 };
    expect(quantoSiPuoRestituire(giaRimborsatoQuasiTutto).massimoCents).toBe(1000);
    const frase = comeSiDivideIlReclamo(giaRimborsatoQuasiTutto, 3000);
    expect(frase, 'la frase descrive un rimborso che la rotta rifiuta').not.toMatch(/^Di /u);
    expect(frase).toContain('Supera il rimborsabile');
    expect(frase).toContain(`al massimo ${formatPriceFromCents(1000)}`);
    expect(frase).not.toContain('tornano come credito');
  });
  it('oltre il massimo vale per ogni ordine, anche quello tutto in contanti che non si divide', () => {
    expect(comeSiDivideIlReclamo(misto, 8000)).toContain(`Supera il rimborsabile: al massimo ${formatPriceFromCents(5000)}`);
    expect(comeSiDivideIlReclamo(maglione, 4001)).toContain(`al massimo ${formatPriceFromCents(4000)}`);
  });
  it('proprio il massimo si divide ancora: 50 € su 50 sono 20 di credito e 30 di bonifico', () => {
    expect(comeSiDivideIlReclamo(misto, 5000)).toContain(
      `Di ${formatPriceFromCents(5000)}, ${formatPriceFromCents(2000)} tornano come credito MyCity`,
    );
    expect(comeSiDivideIlReclamo(maglione, 4000)).toBeNull();
  });
  it('niente da dividere: tutto in contanti, carta, cifra vuota, ordine mai incassato', () => {
    expect(comeSiDivideIlReclamo(maglione, 3000)).toBeNull();
    expect(comeSiDivideIlReclamo({ ...maglione, stripe_payment_intent: 'pi_1', payment_method: 'card' }, 3000)).toBeNull();
    expect(comeSiDivideIlReclamo(misto, 0)).toBeNull();
    expect(comeSiDivideIlReclamo({ ...misto, cash_confirmed_at: null, payment_status: 'PENDING', delivery_status: 'ACCEPTED' }, 3000)).toBeNull();
  });
});
