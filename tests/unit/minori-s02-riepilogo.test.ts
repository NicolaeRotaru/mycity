import { describe, it, expect } from 'vitest';
import { cifraDellaVoce, riepilogoOrdine, statoPagamento } from '@/lib/ordini/riepilogo-ordine';

/**
 * Sessione S02 (5/11/2026) — il riepilogo dell'ordine.
 *  · 1970: con la consegna non letta (null) niente «Spedizione GRATUITA» sopra un totale coi 3 €;
 *  · 2078: niente «GRATUITA» nemmeno sopra i 50 € (riepilogo) — la pagina vera con la carta a 35 e
 *          60 € è nella prova minori-s02-pagina-dell-ordine › 2069;
 *  · 2355: con la carta rimborsata in parte (il freno della veloce) si dice quanto è già tornato.
 */
const euro = (c: number) => `${(c / 100).toFixed(2)} €`;
const testo = (r: ReturnType<typeof riepilogoOrdine>) => r.voci.map((v) => `${v.etichetta} ${cifraDellaVoce(v, euro)}`).join(' | ');

describe('il riepilogo dell ordine', () => {
  it('1970 · consegna null e 3 € nel totale: niente «GRATUITA», e il riepilogo dice che i 3 € non li spiega', () => {
    const r = riepilogoOrdine({ total_price: 23, shipping_cost: 0, delivery_fee_cents: null, discount_amount: 0, wallet_applied_cents: 0 }, 2000);
    expect(testo(r)).not.toMatch(/GRATUITA|Gratis/);
    // 13/11/2026 (R16-015) — Prima la consegna si ricavava per differenza e il totale «tornava» sempre:
    // una consegna non letta non si inventa, e la differenza si dichiara.
    expect(r.torna).toBe(false);
    expect(Math.abs(r.differenzaCentesimi)).toBe(300);
  });

  it('1970 · consegna null e nessun costo nel totale: resta gratis, ed è vero', () => {
    const r = riepilogoOrdine({ total_price: 20, shipping_cost: 0, delivery_fee_cents: null, discount_amount: 0, wallet_applied_cents: 0 }, 2000);
    // 12/11/2026 (R09-023) — «Gratis» con il nome della cassa, non «Spedizione GRATUITA».
    expect(testo(r)).toContain('Consegna MyCity Gratis');
  });

  it('2078 · sopra i 50 € con la consegna da 3 €: niente «GRATUITA»', () => {
    for (const sub of [5000, 6000, 12000]) {
      const r = riepilogoOrdine({ total_price: (sub + 300) / 100, shipping_cost: 0, delivery_fee_cents: 300, discount_amount: 0, wallet_applied_cents: 0 }, sub);
      expect(testo(r), String(sub)).not.toMatch(/GRATUITA|Gratis/);
    }
  });

  it('2355 · carta rimborsata in parte: si dice quanto è già tornato', () => {
    const p = statoPagamento({ payment_method: 'card', payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 100 }, 1900);
    expect(p).toEqual({ tipo: 'gia-pagato-con-carta', centesimi: 1900, rimborsatoCentesimi: 100 });
    expect(statoPagamento({ payment_method: 'card', payment_status: 'PAID' }, 1900)).toEqual({ tipo: 'gia-pagato-con-carta', centesimi: 1900 });
  });
});
