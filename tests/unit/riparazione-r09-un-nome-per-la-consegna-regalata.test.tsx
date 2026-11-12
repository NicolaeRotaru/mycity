import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderSummary } from '@/components/checkout/OrderSummary';
import { formatPrice } from '@/lib/format';
import { cifraDellaVoce, riepilogoOrdine } from '@/lib/ordini/riepilogo-ordine';
import { VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';

// R09-023 — Con la consegna regalata la cassa scriveva «Consegna MyCity · Gratis» e la pagina
// dell'ordine «Spedizione GRATUITA»: due nomi per la stessa riga. Adesso il nome è uno solo.
const euro = (c: number) => formatPrice(c / 100);
const testoDi = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('R09-023 · la consegna regalata ha lo stesso nome in cassa e nell’ordine', () => {
  it('pagina dell’ordine e cassa scrivono la stessa riga, con lo stesso «Gratis»', () => {
    const r = riepilogoOrdine({ total_price: 20, shipping_cost: 0, delivery_fee_cents: 0, discount_amount: 0, wallet_applied_cents: 0 }, 2000);
    const righeOrdine = r.voci.map((v) => `${v.etichetta} ${cifraDellaVoce(v, euro)}`);
    expect(righeOrdine).toContain(`${VOCE_CONSEGNA} Gratis`);
    expect(righeOrdine.join(' · ')).not.toMatch(/Spedizione|GRATUITA/);
    expect(r.torna).toBe(true);

    const cassa = testoDi(renderToStaticMarkup(
      <OrderSummary subtotal={20} shipping={0} platformDeliveryFee={0} pickupDiscount={0} couponDiscount={0} total={20} isCheckingOut={false} paymentMethod="cod" />,
    ));
    expect(cassa).toContain(`${VOCE_CONSEGNA} Gratis`);
  });

  it('un ordine con la spedizione pagata (prima del 27/10) la tiene col suo nome', () => {
    const r = riepilogoOrdine({ total_price: 24.9, shipping_cost: 4.9, delivery_fee_cents: 0, discount_amount: 0, wallet_applied_cents: 0 }, 2000);
    expect(r.voci.map((v) => v.etichetta)).toContain('Spedizione');
    expect(r.voci.some((v) => v.gratis)).toBe(false);
  });
});
