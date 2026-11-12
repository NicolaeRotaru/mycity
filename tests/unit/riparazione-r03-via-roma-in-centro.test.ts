/**
 * R03-001 — «Via Roma 10, 29121 Piacenza» non finisce su una Via Roma di un altro comune.
 *
 * Il finto Nominatim fa quello che la palestra ha misurato: per la via dal nome comune il
 * primo risultato è una Via Roma omonima fuori città (44.9583, 9.6815, 10 km dal negozio),
 * il secondo quella vera del centro. Prima si prendeva il primo a testo libero e la cassa
 * diceva «troppo lontano». Ora si tiene solo il risultato del comune scritto; se nessuno
 * combacia la risposta è null (l'ordine passa senza coordinate), mai un punto fuori città.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';

const NEGOZIO = { lat: 45.0526, lng: 9.6929 }; // centro di Piacenza

const VIA_ROMA_ALTRO_COMUNE = {
  lat: '44.9583',
  lon: '9.6815',
  address: { road: 'Via Roma', village: 'Podenzano', postcode: '29027' },
};
const VIA_ROMA_PIACENZA = {
  lat: '45.0517',
  lon: '9.6990',
  address: { road: 'Via Roma', city: 'Piacenza', postcode: '29121' },
};

const chiamate: string[] = [];

function nominatim(risposta: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    chiamate.push(String(url));
    return new Response(JSON.stringify(risposta), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  chiamate.length = 0;
});

describe('R03-001 — la via del centro resta in centro', () => {
  it('Via Roma 10, 29121 Piacenza: si sceglie la Via Roma di Piacenza, non quella omonima a 10 km', async () => {
    nominatim([VIA_ROMA_ALTRO_COMUNE, VIA_ROMA_PIACENZA]);
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    expect(c).not.toBeNull();
    expect(c).toEqual({ lat: 45.0517, lng: 9.699 });
    const fuori = fuoriZonaDiConsegna({
      storeLat: NEGOZIO.lat,
      storeLng: NEGOZIO.lng,
      deliveryLat: c!.lat,
      deliveryLng: c!.lng,
    });
    expect(fuori).toBe(false);
  });

  it('se c\'è solo la via omonima di un altro comune la risposta è null (l\'ordine non si blocca con «troppo lontano»)', async () => {
    nominatim([VIA_ROMA_ALTRO_COMUNE]);
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    expect(c).toBeNull();
  });

  it('la ricerca è strutturata, chiusa nel riquadro di Piacenza e chiede più risultati', async () => {
    nominatim([VIA_ROMA_PIACENZA]);
    await coordinateDiUnIndirizzo({ address: 'Via Cavour 3', city: 'Piacenza', zip: '29121' });
    const u = new URL(chiamate[0]);
    expect(u.searchParams.get('street')).toBe('Via Cavour 3');
    expect(u.searchParams.get('city')).toBe('Piacenza');
    expect(u.searchParams.get('postalcode')).toBe('29121');
    expect(u.searchParams.get('viewbox')).toBeTruthy();
    // Il riquadro non è un confine: un indirizzo fuori zona si deve trovare, per essere rifiutato.
    expect(u.searchParams.get('bounded')).toBeNull();
    expect(Number(u.searchParams.get('limit'))).toBeGreaterThan(1);
    expect(u.searchParams.get('q')).toBeNull();
  });

  it('il CAP di un altro comune scarta il risultato anche col nome della città giusto', async () => {
    nominatim([{ lat: '44.95', lon: '9.68', address: { city: 'Piacenza', postcode: '29027' } }]);
    expect(await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' })).toBeNull();
    nominatim([{ lat: '45.05', lon: '9.69', address: { city: 'Piacenza', postcode: '29122' } }]);
    expect(await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'piacenza', zip: '29121' })).toEqual({ lat: 45.05, lng: 9.69 });
  });

  it('un indirizzo a Milano si trova (e il controllo dei 5 km lo rifiuta), non torna null', async () => {
    nominatim([{ lat: '45.4642', lon: '9.19', address: { city: 'Milano', postcode: '20121' } }]);
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 1', city: 'Milano', zip: '20121' });
    expect(c, 'fuori dal riquadro tornava null e l ordine passava').not.toBeNull();
    expect(fuoriZonaDiConsegna({ storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng, deliveryLat: c!.lat, deliveryLng: c!.lng })).toBe(true);
  });

  it('«Piacenza (PC)» e il CAP generico 29100 combaciano con Piacenza 29121', async () => {
    nominatim([VIA_ROMA_PIACENZA]);
    expect(await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza (PC)', zip: '29100' })).toEqual({ lat: 45.0517, lng: 9.699 });
  });
});
