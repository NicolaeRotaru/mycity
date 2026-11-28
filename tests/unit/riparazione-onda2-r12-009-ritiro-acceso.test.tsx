import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/ritiro-in-negozio';
import { PICKUP_DISCOUNT_PERCENT } from '@/lib/constants';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { compensoRiderCents } from '@/lib/shipping';
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector';
import { BUYER_TIMELINE_RITIRO, ORDER_STATUS_LABEL, etichettaPronto } from '@/lib/order-status';
import { motivoRitiroRifiutato } from '@/lib/quando-arriva';

/**
 * R12-009 (onda 2, 28/11/2026) — IL RITIRO IN NEGOZIO ERA ANCORA SPENTO.
 *
 * Nicola ha deciso (regola ritiro.in-negozio, 1/11/2026): al lancio il ritiro in negozio è acceso,
 * e per il cliente è gratis — niente consegna da pagare, niente fattorino, solo la merce. Il codice
 * teneva `RITIRO_IN_NEGOZIO_ATTIVO = false`.
 *
 * Accenderlo da solo non bastava: la cassa avrebbe scritto «Sconto 0%» (lo sconto per il ritiro
 * resta a zero, coi negozi non se n'è parlato), «Paghi al rider» su un ritiro pagato al banco, e la
 * pagina dell'ordine avrebbe mostrato al cliente i passi del fattorino che su un ritiro non arriva
 * mai. E un ritiro, che non ha fascia, passava anche verso un negozio in ferie.
 */

const carrello = (pickupInStore: boolean) =>
  prezziDelCarrello({
    gruppi: [{ sellerId: 'forno', subtotalCents: 1250 }],
    coordinateNegozio: () => ({ lat: 45.05, lng: 9.69 }),
    consegnaLat: 45.06,
    consegnaLng: 9.7,
    pickupInStore,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    consegnaVeloce: false,
  });

const cassa = (pickupInStore: boolean) =>
  renderToStaticMarkup(
    <PaymentMethodSelector
      value="cod"
      onChange={() => {}}
      stripeAvailable={false}
      multiSeller={false}
      pickupInStore={pickupInStore}
      onPickupChange={() => {}}
      pickupDiscount={0}
      pickupDiscountPercent={PICKUP_DISCOUNT_PERCENT}
    />,
  ).replace(/&#x27;|&#39;/g, "'");

describe('R12-009 · il ritiro in negozio è acceso dal lancio, gratis per il cliente', () => {
  it('IL CASO DELLA VOCE — l’interruttore è acceso e la cassa offre il ritiro', () => {
    expect(RITIRO_IN_NEGOZIO_ATTIVO).toBe(true);
    expect(cassa(false)).toContain('Ritira tu in negozio');
  });

  it('col ritiro il cliente paga solo la merce: consegna e compenso del fattorino a zero', () => {
    const ritiro = carrello(true);
    expect(ritiro.grandDeliveryFeeCents).toBe(0);
    expect(ritiro.grandShippingCents).toBe(0);
    expect(ritiro.consegna.totaleCents).toBe(0);
    expect(ritiro.grandTotalCents).toBe(1250);
    expect(compensoRiderCents({ pickupInStore: true, negozioInPiu: false })).toBe(0);
    // Controprova: la stessa spesa portata a casa paga la consegna.
    const casa = carrello(false);
    expect(casa.grandDeliveryFeeCents).toBeGreaterThan(0);
    expect(casa.grandTotalCents).toBeGreaterThan(1250);
  });

  it('la cassa dice «Senza consegna», non «Sconto 0%», e coi contanti si paga in negozio, non al rider', () => {
    expect(PICKUP_DISCOUNT_PERCENT).toBe(0);
    const html = cassa(true);
    expect(html).not.toMatch(/Sconto 0%/);
    expect(html).toContain('Senza consegna');
    expect(html).toContain('Non paghi la consegna');
    // Accanto alla consegna a domicilio, che si paga, la cassa non scrive «gratis».
    expect(cassa(false)).not.toMatch(/\bgratis\b/i);
    expect(html).toContain('Paghi in negozio quando ritiri la spesa.');
    expect(html).not.toContain('Paghi al rider');
    // A domicilio il contante resta al rider.
    expect(cassa(false)).toContain('Paghi al rider quando ricevi il pacco.');
  });

  it('la pagina dell’ordine di un ritiro non mostra i passi del fattorino', () => {
    expect(BUYER_TIMELINE_RITIRO).toEqual(['NEW', 'ACCEPTED', 'READY', 'DELIVERED']);
    expect(etichettaPronto(true)).toBe('Pronto per il ritiro');
    // La targhetta generica (dove non si sa se è un ritiro) non manda a ritirare chi aspetta a casa.
    expect(ORDER_STATUS_LABEL.READY).not.toBe('Pronto per il ritiro');
    expect(ORDER_STATUS_LABEL.READY).not.toBe('Pronto per il fattorino');
  });

  it('un negozio in ferie (settimana tutta chiusa) non si ritira; uno che apre sì', () => {
    const chiuso = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
    const aperto = { ...chiuso, mon: [['08:00', '13:00']] };
    expect(motivoRitiroRifiutato([{ nome: 'Pane Quotidiano', orari: chiuso }])).toMatch(/Pane Quotidiano/);
    expect(motivoRitiroRifiutato([{ nome: 'Pane Quotidiano', orari: aperto }])).toBeNull();
    expect(motivoRitiroRifiutato([{ nome: 'Forno', orari: null }])).toBeNull();
  });
});
