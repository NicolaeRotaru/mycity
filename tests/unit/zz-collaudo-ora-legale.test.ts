import { describe, it, expect } from 'vitest';
import { rigaScadenzaPerIlNegozio, fineDellaFascia } from '@/lib/ordini/scadenza-accettazione';
import { newOrderSellerTemplate } from '@/lib/email/templates';
const casi = [
  // sabato 27/3/2027 21:15 a Piacenza (CET, UTC+1); nella notte l'ora legale comincia
  { nome: 'primavera', nato: '2027-03-27T20:15:00.000Z', fineVera: '2027-03-28T10:00:00.000Z' },
  // sabato 24/10/2026 21:15 a Piacenza (CEST, UTC+2); nella notte l'ora legale finisce
  { nome: 'autunno', nato: '2026-10-24T19:15:00.000Z', fineVera: '2026-10-25T11:00:00.000Z' },
  // giorno normale
  { nome: 'normale', nato: '2026-10-29T20:15:00.000Z', fineVera: '2026-10-30T11:00:00.000Z' },
];
describe('collaudo: la scadenza scritta al negozio nella notte del cambio d ora', () => {
  for (const c of casi) it(c.nome, () => {
    const o = { created_at: c.nato, delivery_slot: 'Domani · 9:00–12:00' };
    const riga = rigaScadenzaPerIlNegozio(o, new Date(c.nato));
    const t = newOrderSellerTemplate({ orderId: 'o1', total: 15, itemsCount: 1, createdAt: c.nato, deliverySlot: o.delivery_slot });
    console.log(c.nome, '|', fineDellaFascia(o)?.toISOString(), '|', riga);
    expect(t.text).toContain('entro le 12:00 di domani');
    expect(fineDellaFascia(o)?.toISOString()).toBe(c.fineVera);
  });
});
