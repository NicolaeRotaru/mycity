import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderConfirmedBuyerTemplate } from '@/lib/email/templates';

/**
 * R08-004 — La conferma al cliente scriveva «Domani · 9:00–12:00» senza la data: chi la rileggeva
 * il giorno dopo capiva il giorno sbagliato. Ora accanto a «domani» c'è il giorno vero, contato
 * sull'orologio di Piacenza al momento dell'ordine. Orologio finto: giovedì 19/11/2026 alle 22:30
 * a Piacenza (21:30 UTC), quando «domani» è venerdì 20/11.
 */
const testo = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const base = { orderId: 'abcdef12', total: 24, storeName: 'Pane', paymentMethod: 'cod' as const };

afterEach(() => vi.useRealTimers());

describe('la conferma al cliente porta il giorno vero', () => {
  it('«Domani · 9:00–12:00» dice venerdì 20/11 DOPO la fascia, in HTML e in testo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T21:30:00Z'));
    const t = orderConfirmedBuyerTemplate({ ...base, deliverySlot: 'Domani · 9:00–12:00' });
    expect(testo(t.html)).toContain('Domani · 9:00–12:00 (venerdì 20/11)');
    expect(t.text).toContain('Domani · 9:00–12:00 (venerdì 20/11)');
  });

  it('il giorno si conta da quando è nato l\'ordine, non da quando si apre la funzione', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-30T10:00:00Z'));
    const t = orderConfirmedBuyerTemplate({ ...base, deliverySlot: 'Domani · 9:00–12:00', createdAt: '2026-11-19T21:30:00Z' });
    expect(t.text).toContain('Domani · 9:00–12:00 (venerdì 20/11)');
  });

  it('col ritiro in negozio la fascia di domani porta la data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T21:30:00Z'));
    const t = orderConfirmedBuyerTemplate({ ...base, pickupInStore: true, deliverySlot: 'Domani · 9:00–12:00' });
    expect(t.text).toContain('Ritiro in negozio, Domani · 9:00–12:00 (venerdì 20/11)');
  });

  it('«Oggi» porta la data di oggi dopo la fascia', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T21:30:00Z'));
    const t = orderConfirmedBuyerTemplate({ ...base, deliverySlot: 'Oggi · 18:00–20:00' });
    expect(t.text).toContain('Consegna: Oggi · 18:00–20:00 (giovedì 19/11).');
  });

  it('la data non viene prima della fascia', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T21:30:00Z'));
    const t = orderConfirmedBuyerTemplate({ ...base, deliverySlot: 'Domani · 9:00–12:00' });
    expect(t.text).not.toMatch(/Domani \(/);
  });

  it('una fascia senza «oggi»/«domani» resta com\'è', () => {
    const t = orderConfirmedBuyerTemplate({ ...base, deliverySlot: 'Adesso · arrivo in 30-60 minuti' });
    expect(t.text).toContain('Consegna: Adesso · arrivo in 30-60 minuti.');
  });
});
