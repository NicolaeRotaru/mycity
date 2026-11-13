/**
 * R13-001 — «Via Roma 10, 29121 Piacenza» finiva a Podenzano, a 10 km dal negozio, e la cassa
 * diceva «troppo lontano» a chi abita in pieno centro.
 *
 * Il finto Nominatim fa quello che la palestra ha misurato: più risultati, e il PRIMO fuori
 * Piacenza (una via omonima di un altro comune della provincia). Si guarda il comportamento dai
 * due ingressi che ci sono già: `coordinateDiUnIndirizzo` (il server dell'ordine, contanti e
 * carta) e la rotta POST /api/geocode (la cassa, la rubrica, il negozio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';

const NEGOZIO = { storeLat: 45.0526, storeLng: 9.693 }; // Salumeria del Borgo, in centro

type Risultato = { lat: string; lon: string; display_name: string; address: Record<string, string> };
const PODENZANO: Risultato = {
  lat: '44.9583', lon: '9.6815', display_name: 'Via Roma, Podenzano, Piacenza, Emilia-Romagna, 29027, Italia',
  address: { road: 'Via Roma', village: 'Podenzano', county: 'Piacenza', postcode: '29027' },
};
const GOSSOLENGO: Risultato = {
  lat: '45.0030', lon: '9.6150', display_name: 'Via Mazzini, Gossolengo, Piacenza, Emilia-Romagna, 29020, Italia',
  address: { road: 'Via Mazzini', town: 'Gossolengo', county: 'Piacenza', postcode: '29020' },
};
const CENTRO: Risultato = {
  lat: '45.0505', lon: '9.6905', display_name: 'Via Roma, Centro Storico, Piacenza, Emilia-Romagna, 29121, Italia',
  address: { road: 'Via Roma', suburb: 'Centro Storico', city: 'Piacenza', county: 'Piacenza', postcode: '29121' },
};
const MILANO: Risultato = {
  lat: '45.4642', lon: '9.19', display_name: 'Via Roma, Milano, Lombardia, 20121, Italia',
  address: { road: 'Via Roma', city: 'Milano', postcode: '20121' },
};

// Quarto: frazione di Gossolengo (CAP 29020) e comune in provincia di Napoli (CAP 80010).
const QUARTO_NAPOLI: Risultato = {
  lat: '40.8770', lon: '14.1420', display_name: 'Via Roma, Quarto, Napoli, Campania, 80010, Italia',
  address: { road: 'Via Roma', town: 'Quarto', county: 'Napoli', postcode: '80010' },
};
const QUARTO_GOSSOLENGO: Risultato = {
  lat: '45.0110', lon: '9.6390', display_name: 'Via Roma, Quarto, Gossolengo, Piacenza, Emilia-Romagna, 29020, Italia',
  address: { road: 'Via Roma', hamlet: 'Quarto', town: 'Gossolengo', county: 'Piacenza', postcode: '29020' },
};

let risposta: Risultato[] = [];
let chiamate: URL[] = [];

beforeEach(() => {
  vi.resetModules();
  chiamate = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname !== 'nominatim.openstreetmap.org') throw new Error(`rete inattesa: ${url.hostname}`);
    chiamate.push(url);
    return new Response(JSON.stringify(risposta), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function dalServer(ind: { address: string; city: string; zip: string }) {
  const { coordinateDiUnIndirizzo } = await import('@/lib/geocodifica');
  return coordinateDiUnIndirizzo(ind);
}

async function dallaRotta(q: string) {
  const { POST } = await import('@/app/api/geocode/route');
  const res = await POST(new Request('http://localhost/api/geocode', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({ q }),
  }));
  return { status: res.status, corpo: (await res.json()) as { lat: number | null; lng: number | null; luogo?: string | null } };
}

function fuori(c: { lat: number | null; lng: number | null } | null): boolean {
  return fuoriZonaDiConsegna({ ...NEGOZIO, deliveryLat: c?.lat ?? null, deliveryLng: c?.lng ?? null });
}

describe('R13-001 · Via Roma in centro non è fuori zona', () => {
  it('il server dell\'ordine sceglie la Via Roma di Piacenza anche se il primo risultato è a Podenzano', async () => {
    risposta = [PODENZANO, CENTRO];
    const c = await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    expect(c).toMatchObject({ lat: 45.0505, lng: 9.6905 });
    expect(fuori(c)).toBe(false);
  });

  it('la rotta /api/geocode dà la stessa risposta alla frase della cassa', async () => {
    risposta = [PODENZANO, CENTRO];
    const { status, corpo } = await dallaRotta('Via Roma 10, 29121 Piacenza, Italia');
    expect(status).toBe(200);
    expect(corpo).toMatchObject({ lat: 45.0505, lng: 9.6905 });
    expect(fuori(corpo)).toBe(false);
  });

  it('un comune vicino, dentro il riquadro, non passa per Piacenza (Via Mazzini a Gossolengo)', async () => {
    risposta = [GOSSOLENGO, { ...CENTRO, address: { ...CENTRO.address, road: 'Via Mazzini' } }];
    const c = await dalServer({ address: 'Via Mazzini 3', city: 'Piacenza', zip: '29121' });
    expect(fuori(c)).toBe(false);
  });

  it('se nessun risultato è nel comune scritto la risposta è «non so», e l\'ordine non si blocca', async () => {
    risposta = [PODENZANO];
    expect(await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' })).toBeNull();
    const { corpo } = await dallaRotta('Via Roma 10, 29121 Piacenza, Italia');
    expect(corpo).toMatchObject({ lat: null, lng: null });
  });

  it('senza città scritta si intende Piacenza (il negozio che scrive solo la via)', async () => {
    risposta = [PODENZANO, CENTRO];
    const { corpo } = await dallaRotta('Via Roma 12, Italia');
    expect(corpo).toMatchObject({ lat: 45.0505, lng: 9.6905 });
  });

  it('un indirizzo di Milano resta a Milano: il controllo dei 5 km lo ferma come prima', async () => {
    risposta = [MILANO];
    const c = await dalServer({ address: 'Via Roma 1', city: 'Milano', zip: '20121' });
    expect(c).toMatchObject({ lat: 45.4642, lng: 9.19 });
    expect(fuori(c)).toBe(true);
  });

  it('R13-006 · la rotta dice anche il nome del posto trovato, da mostrare al negozio', async () => {
    risposta = [MILANO];
    const { corpo } = await dallaRotta('Via Roma 1, Milano');
    expect(corpo).toEqual({ lat: 45.4642, lng: 9.19, luogo: MILANO.display_name });
  });

  it('collaudo · un CAP diverso da quello scritto si scarta: Quarto (29020) non finisce a Napoli', async () => {
    risposta = [QUARTO_NAPOLI];
    expect(await dalServer({ address: 'Via Roma 15', city: 'Quarto', zip: '29020' })).toBeNull();
    const { corpo } = await dallaRotta('Via Roma 15, 29020 Quarto, Italia');
    expect(corpo).toMatchObject({ lat: null, lng: null });
    expect(fuori(corpo)).toBe(false);
  });

  it('collaudo · la Quarto col CAP scritto si trova anche se le mappe mettono prima quella di Napoli', async () => {
    risposta = [QUARTO_NAPOLI, QUARTO_GOSSOLENGO];
    expect(await dalServer({ address: 'Via Roma 15', city: 'Quarto', zip: '29020' })).toMatchObject({ lat: 45.011, lng: 9.639 });
  });

  it('collaudo · fuori dal riquadro, con il CAP scritto, un risultato senza CAP non è affidabile', async () => {
    risposta = [{ ...QUARTO_NAPOLI, address: { road: 'Via Roma', town: 'Quarto', county: 'Napoli' } }];
    expect(await dalServer({ address: 'Via Roma 15', city: 'Quarto', zip: '29020' })).toBeNull();
  });

  it('collaudo · anche a Piacenza un CAP di un altro comune si scarta, ma senza CAP dentro il riquadro vale', async () => {
    risposta = [{ ...CENTRO, address: { ...CENTRO.address, postcode: '29027' } }];
    expect(await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' })).toBeNull();
    const senzaCap = { ...CENTRO.address } as Record<string, string>;
    delete senzaCap.postcode;
    risposta = [{ ...CENTRO, address: senzaCap }];
    expect(await dalServer({ address: 'Via Roma 11', city: 'Piacenza', zip: '29121' })).toMatchObject({ lat: 45.0505, lng: 9.6905 });
    risposta = [{ ...CENTRO, address: { ...CENTRO.address, postcode: '29121;29122' } }];
    expect(await dalServer({ address: 'Via Roma 12', city: 'Piacenza', zip: '29122' })).toMatchObject({ lat: 45.0505, lng: 9.6905 });
  });

  it('secondo collaudo · dentro Piacenza un CAP della città diverso da quello del risultato non scarta l\'indirizzo', async () => {
    risposta = [CENTRO];
    expect(await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '29100' })).toMatchObject({ lat: 45.0505, lng: 9.6905 });
    const { corpo } = await dallaRotta('Via Roma 10, 29100 Piacenza, Italia');
    expect(corpo).toMatchObject({ lat: 45.0505, lng: 9.6905 });
    expect(fuori(corpo)).toBe(false);
    risposta = [{ ...CENTRO, address: { ...CENTRO.address, postcode: '29122' } }];
    expect(await dalServer({ address: 'Via Roma 12', city: 'Piacenza', zip: '29121' })).toMatchObject({ lat: 45.0505, lng: 9.6905 });
  });

  it('secondo collaudo · il CAP della città mette solo in ordine: vince il risultato col CAP scritto', async () => {
    const ALTRO_CAP = { ...CENTRO, lat: '45.0400', lon: '9.7000', address: { ...CENTRO.address, postcode: '29122' } };
    risposta = [ALTRO_CAP, CENTRO];
    expect(await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' })).toMatchObject({ lat: 45.0505, lng: 9.6905 });
  });

  it('secondo collaudo · a Nominatim non va il CAP di Piacenza (29100), quello di un altro comune sì', async () => {
    risposta = [CENTRO];
    await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '29100' });
    expect(chiamate[0].searchParams.get('postalcode')).toBeNull();
    risposta = [QUARTO_GOSSOLENGO];
    await dalServer({ address: 'Via Roma 15', city: 'Quarto', zip: '29020' });
    expect(chiamate[1].searchParams.get('postalcode')).toBe('29020');
  });

  it('collaudo · «Piacenza PC» e un CAP storpiato («2912 Piacenza») restano chiusi nel riquadro', async () => {
    risposta = [CENTRO];
    await dalServer({ address: 'Via Roma 10', city: 'Piacenza PC', zip: '29121' });
    await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '2912' });
    await dallaRotta('Via Roma 10, 29121 Piacenza (PC), Italia');
    expect(chiamate).toHaveLength(3);
    for (const url of chiamate) {
      expect(url.searchParams.get('bounded')).toBe('1');
      expect(url.searchParams.get('viewbox')).toBeTruthy();
      expect(url.searchParams.get('city')).toBe('Piacenza');
    }
  });

  it('collaudo · «Piacenza d\'Adige» non è Piacenza: niente riquadro', async () => {
    risposta = [];
    await dalServer({ address: 'Via Roma 1', city: "Piacenza d'Adige", zip: '35040' });
    expect(chiamate[0].searchParams.get('bounded')).toBeNull();
  });

  it('la domanda è strutturata e, per Piacenza, chiusa nel riquadro della città', async () => {
    risposta = [CENTRO];
    await dalServer({ address: 'Via Roma 10', city: 'Piacenza', zip: '29121' });
    const p = chiamate[0].searchParams;
    expect(p.get('street')).toBe('Via Roma 10');
    expect(p.get('city')).toBe('Piacenza');
    expect(p.get('postalcode')).toBeNull(); // il CAP della città serve solo a ordinare i risultati
    expect(p.get('bounded')).toBe('1');
    expect(p.get('viewbox')).toBeTruthy();
    expect(Number(p.get('limit'))).toBeGreaterThan(1);
    expect(p.get('q')).toBeNull();
  });
});
