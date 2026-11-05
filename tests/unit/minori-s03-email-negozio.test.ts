import { describe, it, expect } from 'vitest';
import { newOrderSellerTemplate, conLaData } from '@/lib/email/templates';

/** S03 — l'email «Nuovo ordine» al negozio (schede 2350, 2345). */
describe('email «Nuovo ordine» al negozio', () => {
  // Venerdì 30/10/2026 alle 21:15 di Piacenza, per «Domani 9:00-12:00».
  const nato = '2026-10-30T20:15:00Z';

  it('2350 — dice la fascia da servire', () => {
    const t = newOrderSellerTemplate({ orderId: 'abcdef12-0000', total: 15, itemsCount: 1, createdAt: nato, deliverySlot: 'Domani 9:00-12:00' });
    expect(t.text).toMatch(/Consegna: Domani \(sabato 31\/10\) 9:00-12:00\./);
    expect(t.html).toMatch(/Consegna: <strong>Domani \(sabato 31\/10\) 9:00-12:00<\/strong>/);
  });

  it('2345 — «di domani» porta anche il giorno', () => {
    const t = newOrderSellerTemplate({ orderId: 'abcdef12-0000', total: 15, itemsCount: 1, createdAt: nato, deliverySlot: 'Domani 9:00-12:00' });
    expect(t.text).toMatch(/31\/10/);
    expect(t.text).not.toMatch(/di domani(?! \()/);
  });

  it('conLaData conta il giorno sull orologio di Piacenza, anche col cambio d ora', () => {
    // 24/10/2026 23:30 a Piacenza = 21:30Z; domani è domenica 25/10 (giorno da 25 ore).
    expect(conLaData('le 12:00 di domani', new Date('2026-10-24T21:30:00Z'))).toBe('le 12:00 di domani (domenica 25/10)');
    expect(conLaData('le 20:00 di oggi', new Date('2026-10-24T21:30:00Z'))).toBe('le 20:00 di oggi (sabato 24/10)');
  });

  it('senza fascia nessuna riga «Consegna»', () => {
    const t = newOrderSellerTemplate({ orderId: 'abcdef12-0000', total: 15, itemsCount: 1 });
    expect(t.text).not.toMatch(/Consegna:/);
  });
});

import { veloceNonConfermataTemplate } from '@/lib/email/templates';
import { fraseNonSpostato } from '@/lib/ordini/veloce-non-confermata';

describe('email veloce senza fascia (scheda 2348)', () => {
  it('il titolo non si ripete identico come prima frase del paragrafo', () => {
    const frase = fraseNonSpostato(new Date('2026-10-31T21:00:00Z'), new Date('2026-10-31T19:00:00Z'));
    const t = veloceNonConfermataTemplate({ orderId: 'o1', frase, senzaFascia: true });
    const p = t.html.match(/<p style="margin:0 0 12px;line-height:1.6">([^<]*)<\/p>/)![1];
    expect(p.startsWith('Il negozio non ha ancora confermato')).toBe(false);
    expect(p).toMatch(/^Se non conferma entro/);
  });
});

import { orderConfirmedBuyerTemplate, ordineAnnullatoTemplate } from '@/lib/email/templates';

describe('numero d ordine e negozio nelle email al cliente (schede 1882, 2237)', () => {
  const id = '3f9a12bc-0000-0000-0000-000000000000';
  it('la conferma e l annullo scrivono lo stesso numero, #3F9A12', () => {
    const c = orderConfirmedBuyerTemplate({ orderId: id, total: 18, storeName: 'Pane Quotidiano' });
    const a = ordineAnnullatoTemplate({ orderId: id });
    expect(c.subject).toContain('#3F9A12');
    expect(c.html).toContain('#3F9A12');
    expect(c.html).not.toContain('#3f9a12bc');
    expect(a.subject).toContain('#3F9A12');
  });
  it('l annullo dice quale negozio, nell oggetto e nel testo', () => {
    const a = ordineAnnullatoTemplate({ orderId: id, storeName: 'Pane Quotidiano' });
    expect(a.subject).toBe('Ordine #3F9A12 da Pane Quotidiano annullato — non devi pagare niente');
    expect(a.text).toMatch(/L'ordine #3F9A12 da Pane Quotidiano è stato annullato/);
    expect(a.html).toMatch(/da <strong>Pane Quotidiano<\/strong>/);
  });
});
