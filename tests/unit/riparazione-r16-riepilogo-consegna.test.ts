import { describe, it, expect } from 'vitest';
import { cifraDellaVoce, riepilogoOrdine } from '@/lib/ordini/riepilogo-ordine';

/**
 * R16-015 — Nel riepilogo dell'ordine la consegna ricavata faceva sempre «tornare» il totale.
 *
 * Quando la consegna non è letta (`delivery_fee_cents` null: la lettura di riserva senza quella
 * colonna) il riepilogo la ricavava per differenza: qualunque cifra che le altre voci non
 * spiegavano diventava «Consegna MyCity», e `torna` non poteva più essere falso. Qui un ordine il
 * cui totale NON torna: il riepilogo lo deve dire, con la differenza giusta, senza inventare righe.
 */
const euro = (c: number) => `${(c / 100).toFixed(2)} €`;
const testo = (r: ReturnType<typeof riepilogoOrdine>) => r.voci.map((v) => `${v.etichetta} ${cifraDellaVoce(v, euro)}`).join(' | ');

describe('R16-015 · con la consegna non letta il riepilogo non fa tornare il totale per forza', () => {
  it('un totale con 17,40 € che nessuna voce spiega: il riepilogo dice che non torna, e di quanto', () => {
    const r = riepilogoOrdine({ total_price: 37.4, shipping_cost: 0, delivery_fee_cents: null, discount_amount: null, wallet_applied_cents: null }, 2000);
    expect(r.torna).toBe(false);
    expect(Math.abs(r.differenzaCentesimi)).toBe(1740);
    expect(r.totaleCentesimi).toBe(3740);
    // Nessuna riga inventata per far quadrare i conti, e niente «Gratis» su una consegna che non si sa.
    expect(r.voci.some((v) => v.centesimi === 1740)).toBe(false);
    expect(testo(r)).not.toMatch(/Gratis|GRATUITA/);
  });

  it('con la spedizione dei vecchi ordini e un totale più alto, la differenza resta dichiarata', () => {
    const r = riepilogoOrdine({ total_price: 30, shipping_cost: 4.9, delivery_fee_cents: null }, 2000);
    expect(r.torna).toBe(false);
    expect(Math.abs(r.differenzaCentesimi)).toBe(510);
    expect(testo(r)).toContain('Spedizione');
  });

  it('se il totale non ha niente di non spiegato, torna e la consegna è davvero gratis', () => {
    const r = riepilogoOrdine({ total_price: 20, shipping_cost: 0, delivery_fee_cents: null }, 2000);
    expect(r.torna).toBe(true);
    expect(testo(r)).toContain('Consegna MyCity Gratis');
  });

  it('con la consegna letta niente cambia: le voci fanno il totale', () => {
    const r = riepilogoOrdine({ total_price: 23, shipping_cost: 0, delivery_fee_cents: 300, discount_amount: 0, wallet_applied_cents: 0 }, 2000);
    expect(r.torna).toBe(true);
    expect(r.voci.some((v) => v.etichetta === 'Consegna MyCity' && v.centesimi === 300)).toBe(true);
  });
});
