/**
 * La cassa diceva «troppo lontano» a chi abita in Via Roma, in pieno centro di Piacenza.
 *
 * La ricerca dell'indirizzo era a testo libero, con un risultato solo e nessun confine: il
 * primo risultato per «Via Roma 10, 29121 Piacenza, Italia» era la Via Roma di Podenzano, a
 * 10 km dal negozio, e il controllo dei 5 km rifiutava l'ordine. Qui un Nominatim finto fa
 * quello che la palestra ha misurato (la via omonima fuori città viene per prima) e si
 * pretende che la cassa trovi la Via Roma di Piacenza, o niente: mai il «fuori zona» per un
 * indirizzo del centro. La rotta /api/geocode ha la sua prova accanto (…-rotta.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://esempio.test' } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => undefined, error: () => undefined, info: () => undefined } }));

import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';

const NEGOZIO = { storeLat: 45.0526, storeLng: 9.693 }; // Salumeria del Borgo, in centro

type Risultato = { lat: string; lon: string; address: Record<string, string> };
const VIA_ROMA_PODENZANO: Risultato = {
  lat: '44.9583', lon: '9.6815',
  address: { road: 'Via Roma', village: 'Podenzano', county: 'Piacenza', postcode: '29027' },
};
const VIA_ROMA_PIACENZA: Risultato = {
  lat: '45.0497', lon: '9.6985',
  address: { road: 'Via Roma', city: 'Piacenza', county: 'Piacenza', postcode: '29121' },
};
const VIA_ROMA_MILANO: Risultato = {
  lat: '45.4642', lon: '9.19',
  address: { road: 'Via Roma', city: 'Milano', postcode: '20121' },
};

let chiamate: URL[] = [];
let candidati: Risultato[] = [];

/**
 * Un Nominatim finto e un po' sciatto, come quello vero per le vie dal nome comune: non
 * guarda la città, mette per prima la via omonima. Rispetta solo il riquadro (bounded=1
 * con viewbox) e il numero di risultati chiesto.
 */
function nominatimFinto(input: unknown): Response {
  const u = new URL(String(input));
  chiamate.push(u);
  const p = u.searchParams;
  let risultati = [...candidati];
  if (p.get('bounded') === '1' && p.get('viewbox')) {
    const [x1, y1, x2, y2] = p.get('viewbox')!.split(',').map(Number);
    const [ovest, est] = [Math.min(x1, x2), Math.max(x1, x2)];
    const [sud, nord] = [Math.min(y1, y2), Math.max(y1, y2)];
    risultati = risultati.filter((r) => {
      const lat = Number(r.lat), lng = Number(r.lon);
      return lat >= sud && lat <= nord && lng >= ovest && lng <= est;
    });
  }
  const limite = Number(p.get('limit') ?? '10');
  return new Response(JSON.stringify(risultati.slice(0, limite)), { status: 200 });
}

beforeEach(() => {
  chiamate = [];
  candidati = [VIA_ROMA_PODENZANO, VIA_ROMA_PIACENZA, VIA_ROMA_MILANO];
  vi.stubGlobal('fetch', async (input: unknown) => nominatimFinto(input));
});
afterEach(() => vi.unstubAllGlobals());

const fuori = (c: { lat: number; lng: number } | null) =>
  fuoriZonaDiConsegna({ ...NEGOZIO, deliveryLat: c?.lat ?? null, deliveryLng: c?.lng ?? null });

describe('la cassa: Via Roma 10, 29121 Piacenza è in centro, non a Podenzano', () => {
  it('le coordinate sono quelle di Piacenza e la consegna è dentro la zona', async () => {
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    expect(c).toEqual({ lat: 45.0497, lng: 9.6985 });
    expect(fuori(c)).toBe(false);
  });

  it('la domanda è strutturata, chiusa nel riquadro di Piacenza, con più risultati', async () => {
    await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    const prima = chiamate[0].searchParams;
    expect(prima.get('q')).toBeNull();
    expect(prima.get('street')).toBe('Via Roma 10');
    expect(prima.get('city')).toBe('Piacenza');
    expect(prima.get('postalcode')).toBe('29121');
    expect(prima.get('countrycodes')).toBe('it');
    expect(prima.get('bounded')).toBe('1');
    expect(prima.get('viewbox')).toBeTruthy();
    expect(Number(prima.get('limit'))).toBeGreaterThan(1);
  });

  it('se c\'è solo la via omonima di un altro comune, nessuna coordinata: l\'ordine non è bloccato', async () => {
    candidati = [VIA_ROMA_PODENZANO];
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    expect(c).toBeNull();
    expect(fuori(c)).toBe(false);
  });

  it('un risultato col CAP di un altro posto si scarta anche se le mappe non dicono il comune', async () => {
    candidati = [{ ...VIA_ROMA_PODENZANO, address: { road: 'Via Roma', postcode: '29027' } }];
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    expect(c).toBeNull();
    expect(fuori(c)).toBe(false);
  });

  it('una consegna a Milano resta fuori zona, come prima', async () => {
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Milano', zip: '20121' });
    expect(c).toEqual({ lat: 45.4642, lng: 9.19 });
    expect(fuori(c)).toBe(true);
  });
});
