import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as modelli from '@/lib/email/templates';

/** S03 — testi delle email (schede 407, 411, 395, 168, 2088, 2089, 2375). */
const APOSTROFO_AL_POSTO_DELL_ACCENTO = /\b(e|gia|piu|puo|citta|novita|identita|responsabilita|li|cosi|perche)'(?=[\s.,;:!?<)]|$)/i;
const testo = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('email al cliente', () => {
  it('407 — «Il tuo ordine è pronto» con l accento vero, in oggetto, HTML e testo', () => {
    for (const pickupInStore of [true, false]) {
      const t = modelli.orderReadyTemplate({ orderId: 'o1', pickupInStore, storeName: 'Pane', storeAddress: 'Via Roma 1', pickupCode: '1234' });
      for (const x of [t.subject, testo(t.html), t.text]) expect(x).not.toMatch(APOSTROFO_AL_POSTO_DELL_ACCENTO);
    }
    const cic = ['reengagement_14d', 'abandoned_cart', 'tutorial_day2'];
    for (const nome of cic) {
      const m = modelli.preparaEmailCicloDiVita(nome, { items: [], name: 'Maria' } as never);
      if (!m) continue;
      for (const x of [m.subject, testo(m.html), m.text]) expect(x, nome).not.toMatch(APOSTROFO_AL_POSTO_DELL_ACCENTO);
    }
  });

  it('407 — i testi per clienti e fattorini fuori dalle email non usano l apostrofo al posto dell accento', () => {
    const righe: Array<[string, RegExp]> = [
      ['app/stores/page.tsx', /della citta'/],
      ['components/Turnstile.tsx', /non si e\\' /],
      ['app/rider/onboarding/page.tsx', /identita\\'|responsabilita\\'/],
      ['app/api/rider/cash-confirm/route.ts', /gia' confermato/],
      ['lib/errors.ts', /si e\\' fermato|non e\\' nel formato/],
      ['app/api/ai/catalog-apply/route.ts', /non si puo' pubblicare/],
    ];
    for (const [f, re] of righe) expect(readFileSync(f, 'utf8'), f).not.toMatch(re);
  });

  it('411 — il pulsante dice «Vedi l’ordine», non «Vedi l&#39;ordine»', () => {
    const t = modelli.orderReadyTemplate({ orderId: 'o1', pickupInStore: false });
    expect(t.html).not.toContain('&amp;#');
    expect(t.html).toMatch(/>Vedi l(’|&#39;)ordine<\/a>/);
  });

  it('395 — il nome con l apostrofo esce pulito nell oggetto e nel testo, filtrato nell HTML', () => {
    const r = modelli.giftCardRecipientTemplate({ code: 'ABC', amountEuro: 25, senderName: "Maria D'Angelo" });
    expect(r.subject).toContain("Maria D'Angelo ti ha regalato");
    expect(r.text).toContain("Maria D'Angelo ti ha regalato");
    expect(r.subject + r.text).not.toContain('&#39;');
    expect(r.html).toContain('Maria D&#39;Angelo');
    const b = modelli.giftCardBuyerTemplate({ code: 'ABC', amountEuro: 25, recipientName: "Gianni Dell'Acqua" });
    expect(b.text).toContain("Gianni Dell'Acqua");
    expect(b.text).not.toContain('&#39;');
  });

  it('168 — l ordine pronto non promette «a breve» né un avviso alla partenza', () => {
    const t = modelli.orderReadyTemplate({ orderId: 'o1', pickupInStore: false });
    for (const x of [testo(t.html), t.text]) {
      expect(x).not.toMatch(/a breve/);
      expect(x).not.toMatch(/Ti avvisiamo appena parte/);
      expect(x).toMatch(/nella fascia che hai scelto/);
    }
  });

  it('2088 — la guida del secondo giorno non nomina la carta alla consegna', () => {
    const m = modelli.preparaEmailCicloDiVita('tutorial_day2', {})!;
    expect(m.html).not.toMatch(/carta non/);
    expect(testo(m.html)).toMatch(/Paghi in contanti alla consegna/);
  });

  it('2089 — l email dei 14 giorni non promette gli sconti', () => {
    const m = modelli.preparaEmailCicloDiVita('reengagement_14d', {})!;
    expect(testo(m.html)).not.toMatch(/scont/i);
    expect(testo(m.html)).toMatch(/Eventi e novità dai negozi di Piacenza\./);
  });

  it('2375 — il commento del colore non parla più dei 15 minuti', () => {
    expect(readFileSync('lib/email/templates.ts', 'utf8')).not.toMatch(/attenzione: '#B82A28',.*15 minuti/);
  });
});

describe('conferma d ordine (scheda 394)', () => {
  it('dice la fascia e quanto pagare in contanti', () => {
    const t = modelli.orderConfirmedBuyerTemplate({
      orderId: 'abcdef12', total: 24, storeName: 'Pane', deliverySlot: 'Domani 9:00-12:00', pickupInStore: false, paymentMethod: 'cod',
    });
    expect(t.text.replace(/ /g, ' ')).toMatch(/Consegna: Domani 9:00-12:00\. In contanti alla consegna: tieni pronti 24,00 €\./);
    expect(testo(t.html)).toMatch(/Domani 9:00-12:00/);
    expect(testo(t.html)).not.toMatch(/rider/);
  });
  it('col ritiro in negozio non parla di consegna né di rider', () => {
    const t = modelli.orderConfirmedBuyerTemplate({ orderId: 'abcdef12', total: 24, storeName: 'Pane', pickupInStore: true, paymentMethod: 'cod' });
    expect(t.text).toMatch(/Ritiro in negozio\. In contanti al ritiro/);
    expect(t.text).not.toMatch(/consegna|rider/i);
  });
});
