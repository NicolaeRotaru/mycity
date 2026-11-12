import { describe, expect, it } from 'vitest';
import { domandaDellaZona } from '@/components/checkout/ShippingAddressForm';
import { urlDellaRicerca } from '@/lib/geocodifica';

/**
 * S07 · cassa e server fanno alle mappe la stessa domanda.
 *
 * 12/11/2026 (R03-001) — Prima la domanda era una frase sola a testo libero, scritta uguale nei
 * due posti, e la prova la confrontava leggendola dal sorgente del server. Ora il server cerca in
 * forma strutturata (via, città, CAP: lib/geocodifica.ts) e la cassa gli manda proprio quei tre
 * campi (/api/geocode li passa alla stessa funzione). Qui si controlla che la ricerca che parte
 * dai campi della cassa porti la stessa via, la stessa città e lo stesso CAP che la cassa ha
 * scritto nella sua domanda.
 */
describe('S07 · cassa e server fanno alle mappe la stessa domanda', () => {
  for (const ind of [
    { address: 'Via Roma 1', city: 'Piacenza', zip: '29121' },
    { address: 'Via  Roma 1 ', city: ' Piacenza', zip: '29121 ' },
    { address: '  Corso Vittorio Emanuele II, 5', city: 'Piacenza  ', zip: '' },
  ]) {
    it(JSON.stringify(ind), () => {
      const domanda = domandaDellaZona(ind);
      const p = new URL(urlDellaRicerca(ind)).searchParams;
      expect(domanda).toContain(p.get('street')!);
      expect(domanda).toContain(p.get('city')!);
      if (ind.zip.trim()) expect(domanda).toContain(p.get('postalcode')!);
      else expect(p.get('postalcode')).toBeNull();
    });
  }
});
