/**
 * R13-010 — La ricerca degli indirizzi chiamava il servizio pubblico delle mappe più volte al
 * secondo, senza un freno per tutto il sito (la regola d'uso di Nominatim: una al secondo).
 *
 * Un fetch finto annota l'istante (orologio finto) di ogni chiamata a Nominatim. Il freno del
 * sito resta quello vero (`rateLimitAsync`, senza Upstash: il contatore in memoria). Si mandano
 * insieme 10 richieste alla rotta /api/geocode con 10 indirizzi diversi, più 2 con lo stesso
 * indirizzo, e una dal server dell'ordine (`coordinateDiUnIndirizzo`); poi l'orologio avanza.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CENTRO = {
  lat: '45.0505', lon: '9.6905', display_name: 'Via, Piacenza, Italia',
  address: { city: 'Piacenza', postcode: '29121' },
};

let istanti: Array<{ t: number; via: string }> = [];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-14T09:00:00+01:00')); // un sabato mattina
  istanti = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname !== 'nominatim.openstreetmap.org') throw new Error(`rete inattesa: ${url.hostname}`);
    istanti.push({ t: Date.now(), via: url.searchParams.get('street') ?? url.searchParams.get('q') ?? '' });
    return new Response(JSON.stringify([CENTRO]), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function rotta() {
  const { POST } = await import('@/app/api/geocode/route');
  return (q: string, ip: string) =>
    POST(new Request('http://localhost/api/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ q }),
    })).then((r) => r.json() as Promise<{ lat: number | null }>);
}

describe('R13-010 · un freno solo per tutto il sito verso Nominatim', () => {
  it('mai più di una chiamata al secondo, da qualunque ingresso e da qualunque visitatore', async () => {
    const chiedi = await rotta();
    const { coordinateDiUnIndirizzo } = await import('@/lib/geocodifica');
    const tutte = [
      ...Array.from({ length: 10 }, (_, i) => chiedi(`Via Numero ${i + 1}, 29121 Piacenza, Italia`, `10.0.0.${i + 1}`)),
      coordinateDiUnIndirizzo({ address: 'Via del Server 1', city: 'Piacenza', zip: '29121' }),
    ];
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all(tutte);

    expect(istanti.length).toBeGreaterThan(0);
    for (let i = 1; i < istanti.length; i++) {
      expect(
        istanti[i].t - istanti[i - 1].t,
        `due chiamate a Nominatim a ${istanti[i].t - istanti[i - 1].t} ms l'una dall'altra`,
      ).toBeGreaterThanOrEqual(1_000);
    }
  });

  it('lo stesso indirizzo chiesto due volte insieme fa una chiamata sola, e la seconda ha la risposta', async () => {
    const chiedi = await rotta();
    const due = [
      chiedi('Via Calzolai 5, 29121 Piacenza, Italia', '10.0.0.1'),
      chiedi('Via Calzolai 5, 29121 Piacenza, Italia', '10.0.0.2'),
    ];
    await vi.advanceTimersByTimeAsync(15_000);
    const [a, b] = await Promise.all(due);
    expect(istanti.filter((x) => x.via.includes('Calzolai'))).toHaveLength(1);
    expect(a.lat).toBe(45.0505);
    expect(b.lat).toBe(45.0505);
  });

  it('lo stesso indirizzo chiesto più tardi non richiama il servizio', async () => {
    const chiedi = await rotta();
    const prima = chiedi('Via Calzolai 5, 29121 Piacenza, Italia', '10.0.0.1');
    await vi.advanceTimersByTimeAsync(2_000);
    await prima;
    const dopo = chiedi('via calzolai 5,  29121 piacenza, Italia', '10.0.0.3');
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await dopo).lat).toBe(45.0505);
    expect(istanti).toHaveLength(1);
  });
});
