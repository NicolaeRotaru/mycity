/**
 * La pulizia di città e CAP nella ricerca degli indirizzi lasciava passare null su scritture comuni.
 *
 * «piacenza pc» minuscolo, «Piacenza, PC» nel campo città, un CAP con lo spazio («29 121»), un CAP
 * di quattro cifre, la città col CAP in coda, un altro CAP della stessa città (29122 per una via
 * che le mappe danno 29121): la città pulita non somigliava più a nessun risultato, o il CAP lo
 * scartava, e l'ordine passava senza coordinate. Qui un Nominatim finto e sciatto (non guarda la
 * città né il CAP, rispetta solo il riquadro) risponde sempre con gli stessi candidati: decide
 * solo la pulizia di `lib/geocodifica.ts`. Due casi devono restare null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://esempio.test' } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => undefined, error: () => undefined, info: () => undefined } }));

import { coordinateDiUnIndirizzo, cercaUnIndirizzo } from '@/lib/geocodifica';

type Risultato = { lat: string; lon: string; address: Record<string, string> };
const VIA_ROMA_PODENZANO: Risultato = {
  lat: '44.9583', lon: '9.6815',
  address: { road: 'Via Roma', village: 'Podenzano', county: 'Piacenza', postcode: '29027' },
};
const VIA_ROMA_PIACENZA: Risultato = {
  lat: '45.0497', lon: '9.6985',
  address: { road: 'Via Roma', city: 'Piacenza', county: 'Piacenza', postcode: '29121' },
};
const SANT_ANTONIO: Risultato = {
  lat: '45.0601', lon: '9.6402',
  address: { road: 'Strada Agazzana', suburb: 'Sant’Antonio a Trebbia', city: 'Piacenza', postcode: '29122' },
};
const SAN_NICOLO: Risultato = {
  lat: '45.0605', lon: '9.6012',
  address: { road: 'Via Emilia Est', village: 'San Nicolò', municipality: 'Rottofreno', postcode: '29010' },
};

const PIACENZA = { lat: 45.0497, lng: 9.6985 };

let chiamate: URL[] = [];
let candidati: Risultato[] = [];

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
  return new Response(JSON.stringify(risultati.slice(0, Number(p.get('limit') ?? '10'))), { status: 200 });
}

beforeEach(() => {
  chiamate = [];
  candidati = [VIA_ROMA_PODENZANO, VIA_ROMA_PIACENZA];
  vi.stubGlobal('fetch', async (input: unknown) => nominatimFinto(input));
});
afterEach(() => vi.unstubAllGlobals());

describe('la città e il CAP scritti come li scrivono le persone trovano Via Roma a Piacenza', () => {
  it.each([
    ['Piacenza', '29121'],
    ['PIACENZA', '29121'],
    ['piacenza pc', '29121'],
    ['Piacenza pc', '29121'],
    ['Piacenza PC', '29121'],
    ['Piacenza, PC', '29121'],
    ['piacenza, pc', '29121'],
    ['Piacenza, (PC)', '29121'],
    ['Piacenza (PC)', '29121'],
    ['piacenza (pc)', ''],
    ['Piacenza - PC', '29121'],
    ['  Piacenza   ', ' 29121 '],
    ['Piacenza', '29 121'],
    ['Piacenza', '2912'],
    ['Piacenza 29121', ''],
    ['Piacenza, Italia', '29121'],
    ['Piacenza', '29122'],
  ])('città «%s», CAP «%s» → il punto di Piacenza', async (city, zip) => {
    const c = await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city, zip });
    expect(c, `«${city}» «${zip}» diventava null`).toEqual(PIACENZA);
    // Alle mappe arriva la città pulita, e il CAP solo se è un CAP.
    const prima = chiamate[0].searchParams;
    expect(prima.get('city')).toMatch(/^piacenza$/i);
    const cap = prima.get('postalcode');
    if (cap !== null) expect(cap).toMatch(/^\d{5}$/);
  });

  it.each([
    ['Sant’Antonio a Trebbia'],
    ["Sant'Antonio a Trebbia"],
    ['SANT’ANTONIO A TREBBIA'],
    ['Sant Antonio a Trebbia'],
  ])('frazione con l’apostrofo: «%s»', async (city) => {
    candidati = [VIA_ROMA_PODENZANO, SANT_ANTONIO];
    const c = await coordinateDiUnIndirizzo({ address: 'Strada Agazzana 4', city, zip: '29122' });
    expect(c).toEqual({ lat: 45.0601, lng: 9.6402 });
  });

  it.each([['San Nicolò'], ["San Nicolo'"], ['SAN NICOLÒ'], ['san nicolo (pc)']])('frazione con l’accento: «%s»', async (city) => {
    candidati = [VIA_ROMA_PODENZANO, SAN_NICOLO];
    const c = await coordinateDiUnIndirizzo({ address: 'Via Emilia Est 3', city, zip: '29010' });
    expect(c).toEqual({ lat: 45.0605, lng: 9.6012 });
  });

  it('la rotta /api/geocode: «Via Roma 10, 29121 piacenza pc, Italia» trova Piacenza', async () => {
    expect(await cercaUnIndirizzo('Via Roma 10, 29121 piacenza pc, Italia')).toMatchObject({ esito: 'trovato', lat: 45.0497, lng: 9.6985 });
  });
});

describe('la pulizia non trasforma in Piacenza quello che Piacenza non è', () => {
  it('solo la via omonima di un altro comune, con «piacenza, pc»: resta null', async () => {
    candidati = [VIA_ROMA_PODENZANO];
    expect(await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'piacenza, pc', zip: '29121' })).toBeNull();
  });

  it('senza comune nelle mappe il CAP deve essere quello scritto: un altro CAP, anche vicino, scarta il risultato', async () => {
    candidati = [{ ...VIA_ROMA_PIACENZA, address: { road: 'Via Roma', postcode: '29122' } }];
    expect(await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' })).toBeNull();
  });

  it('il comune giusto ma il CAP di un’altra provincia: resta null', async () => {
    expect(await coordinateDiUnIndirizzo({ address: 'Via Roma 10', city: 'Piacenza', zip: '20121' })).toBeNull();
  });
});
