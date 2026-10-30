import { describe, it, expect } from 'vitest';
import { rigaScadenzaPerIlNegozio, fineDellaFascia, scadenzaAccettazione, ancoraNeiTempi } from '@/lib/ordini/scadenza-accettazione';
import { newOrderSellerTemplate } from '@/lib/email/templates';

/**
 * LA SCADENZA DI UN ORDINE SU UNA FASCIA SI CONTA SULL ORA DA PARETE DI PIACENZA.
 *
 * Nata dal collaudo dell ondata 17 (prima si chiamava zz-collaudo-ora-legale). Protegge tre cose:
 * ① l email al negozio e le sue pagine dicono «entro le 12:00 di domani» anche nelle due notti del
 *   cambio d ora (prima: «entro le 13:00» in primavera, «entro le 11:00» in autunno);
 * ② il giro notturno (expire-stale-orders, che chiede ancoraNeiTempi) non annulla un ordine della
 *   fascia 9:00–12:00 alle 11:00 la domenica del cambio d ora;
 * ③ un ordine nato dopo la mezzanotte di Piacenza (ma prima di quella di Londra) conta «domani»
 *   dal giorno di Piacenza, non dal giorno UTC.
 */
const casi = [
  // sabato 27/3/2027 21:15 a Piacenza (CET, UTC+1); nella notte l ora legale comincia
  { nome: 'primavera', nato: '2027-03-27T20:15:00.000Z', fineVera: '2027-03-28T10:00:00.000Z' },
  // sabato 24/10/2026 21:15 a Piacenza (CEST, UTC+2); nella notte l ora legale finisce
  { nome: 'autunno', nato: '2026-10-24T19:15:00.000Z', fineVera: '2026-10-25T11:00:00.000Z' },
  // giorno normale
  { nome: 'normale', nato: '2026-10-29T20:15:00.000Z', fineVera: '2026-10-30T11:00:00.000Z' },
];
describe('la scadenza scritta al negozio nella notte del cambio d ora', () => {
  for (const c of casi) it(c.nome, () => {
    const o = { created_at: c.nato, delivery_slot: 'Domani · 9:00–12:00' };
    const t = newOrderSellerTemplate({ orderId: 'o1', total: 15, itemsCount: 1, createdAt: c.nato, deliverySlot: o.delivery_slot });
    expect(t.text).toContain('entro le 12:00 di domani');
    expect(rigaScadenzaPerIlNegozio(o, new Date(c.nato))).toContain('entro le 12:00 di domani');
    expect(fineDellaFascia(o)?.toISOString()).toBe(c.fineVera);
  });
});

describe('il giro notturno annulla all ora vera anche la notte del cambio d ora', () => {
  it('autunno: la fascia 9:00–12:00 di domenica 25/10 scade alle 12:00 di Piacenza, non alle 11:00', () => {
    const o = { created_at: '2026-10-24T19:15:00.000Z', delivery_slot: 'Domani · 9:00–12:00' };
    expect(scadenzaAccettazione(o)?.toISOString()).toBe('2026-10-25T11:00:00.000Z');
    // 11:30 a Piacenza (CET): il negozio è ancora nei tempi.
    expect(ancoraNeiTempi(o, new Date('2026-10-25T10:30:00.000Z'))).toBe(true);
    expect(ancoraNeiTempi(o, new Date('2026-10-25T11:00:00.000Z'))).toBe(false);
  });
  it('primavera: la fascia 9:00–12:00 di domenica 28/3 scade alle 12:00 di Piacenza, non alle 13:00', () => {
    const o = { created_at: '2027-03-27T20:15:00.000Z', delivery_slot: 'Domani · 9:00–12:00' };
    expect(scadenzaAccettazione(o)?.toISOString()).toBe('2027-03-28T10:00:00.000Z');
    expect(ancoraNeiTempi(o, new Date('2027-03-28T10:30:00.000Z'))).toBe(false);
  });
});

describe('un ordine nato dopo la mezzanotte di Piacenza', () => {
  it('alle 00:30 di sabato 31/10 «Domani · 9:00–12:00» è domenica 1/11, non sabato', () => {
    // 23:30 UTC di venerdì 30/10 = 00:30 di sabato 31/10 a Piacenza (CET, UTC+1).
    const o = { created_at: '2026-10-30T23:30:00.000Z', delivery_slot: 'Domani · 9:00–12:00' };
    expect(fineDellaFascia(o)?.toISOString()).toBe('2026-11-01T11:00:00.000Z');
    expect(scadenzaAccettazione(o)?.toISOString()).toBe('2026-11-01T11:00:00.000Z');
    expect(rigaScadenzaPerIlNegozio(o, new Date(o.created_at))).toContain('entro le 12:00 di domani');
  });
});
