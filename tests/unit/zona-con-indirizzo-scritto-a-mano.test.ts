/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, useState } from 'react';
import { useCoordinateDellaZona, ATTESA_ZONA_MS, domandaDellaZona } from '@/components/checkout/ShippingAddressForm';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';
import { accendi } from './aiuti/schermo';

/**
 * La cassa avvisava «fuori zona» solo con un indirizzo SALVATO. Scritto a mano
 * o corretto, l'indirizzo non ha coordinate (cambiarlo le azzera): il server lo
 * geolocalizzava e rifiutava, ma solo dopo «ordina». Qui si prova che la cassa
 * fa la stessa ricerca prima, e che dice la zona anche a chi scrive a mano.
 */

const NEGOZIO = { lat: 45.0526, lng: 9.693 }; // centro di Piacenza
const PODENZANO = { lat: 44.955, lng: 9.683 };

let chiamate: string[] = [];
let risposta: () => Promise<unknown> = async () => ({ lat: PODENZANO.lat, lng: PODENZANO.lng });
const reteDiPartenza = globalThis.fetch;

beforeEach(() => {
  chiamate = [];
  risposta = async () => ({ lat: PODENZANO.lat, lng: PODENZANO.lng });
  vi.useFakeTimers();
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    chiamate.push(JSON.parse(init?.body ?? '{}').q);
    const j = await risposta();
    return { ok: true, status: 200, json: async () => j };
  }) as unknown as typeof fetch;
});

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  vi.useRealTimers();
  globalThis.fetch = reteDiPartenza;
});

type Ind = { address: string; city: string; zip: string; lat: number | null; lng: number | null };
let impostaIndirizzo: (i: Ind) => void = () => undefined;

function Cassa(p: { iniziale: Ind; ritiro?: boolean }) {
  const [ind, setInd] = useState(p.iniziale);
  impostaIndirizzo = setInd;
  const c = useCoordinateDellaZona(ind, p.ritiro);
  const fuori = fuoriZonaDiConsegna({ storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng, deliveryLat: c?.lat ?? null, deliveryLng: c?.lng ?? null, pickupInStore: p.ritiro });
  return createElement('p', null, fuori ? 'FUORI-ZONA' : 'IN-ZONA');
}

async function avanza(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const aMano: Ind = { address: 'Via Roma 10', city: 'Podenzano', zip: '29027', lat: null, lng: null };

describe('la zona si sa anche con l\'indirizzo scritto a mano', () => {
  it('Podenzano scritto a mano: la cassa lo cerca e dice fuori zona prima di «ordina»', async () => {
    schermo = accendi(Cassa, { iniziale: aMano });
    expect(schermo.radice.textContent).toBe('IN-ZONA'); // prima della ricerca non si sa
    await avanza(ATTESA_ZONA_MS + 10);
    expect(chiamate).toEqual([domandaDellaZona(aMano)]);
    expect(chiamate[0]).toBe('Via Roma 10, 29027 Podenzano, Italia'); // la stessa domanda del server
    expect(schermo.radice.textContent).toBe('FUORI-ZONA');
  });

  it('indirizzo corretto dopo la risposta: le coordinate vecchie non valgono piu\'', async () => {
    schermo = accendi(Cassa, { iniziale: aMano });
    await avanza(ATTESA_ZONA_MS + 10);
    expect(schermo.radice.textContent).toBe('FUORI-ZONA');
    risposta = async () => ({ lat: 45.048, lng: 9.7 }); // in centro
    await act(async () => impostaIndirizzo({ address: 'Via Cavour 1', city: 'Piacenza', zip: '29121', lat: null, lng: null }));
    expect(schermo.radice.textContent).toBe('IN-ZONA');
    await avanza(ATTESA_ZONA_MS + 10);
    expect(schermo.radice.textContent).toBe('IN-ZONA');
    expect(chiamate).toHaveLength(2);
  });

  it('chi sta ancora scrivendo non fa una ricerca a ogni tasto', async () => {
    schermo = accendi(Cassa, { iniziale: { ...aMano, address: 'Via R' } });
    await avanza(ATTESA_ZONA_MS / 2);
    await act(async () => impostaIndirizzo(aMano));
    await avanza(ATTESA_ZONA_MS + 10);
    expect(chiamate).toEqual([domandaDellaZona(aMano)]);
  });

  it('indirizzo che non si trova o rete giu\': non si blocca nessuno', async () => {
    risposta = async () => ({ lat: null, lng: null });
    schermo = accendi(Cassa, { iniziale: aMano });
    await avanza(ATTESA_ZONA_MS + 10);
    expect(schermo.radice.textContent).toBe('IN-ZONA');
    schermo.smonta();
    risposta = async () => { throw new Error('rete giu'); };
    schermo = accendi(Cassa, { iniziale: aMano });
    await avanza(ATTESA_ZONA_MS + 10);
    expect(schermo.radice.textContent).toBe('IN-ZONA');
  });

  it('indirizzo salvato: si usano le sue coordinate, senza ricerca; ritiro in negozio: nessuna ricerca', async () => {
    schermo = accendi(Cassa, { iniziale: { ...aMano, ...PODENZANO } });
    await avanza(ATTESA_ZONA_MS + 10);
    expect(schermo.radice.textContent).toBe('FUORI-ZONA');
    schermo.smonta();
    schermo = accendi(Cassa, { iniziale: aMano, ritiro: true });
    await avanza(ATTESA_ZONA_MS + 10);
    expect(schermo.radice.textContent).toBe('IN-ZONA');
    expect(chiamate).toEqual([]);
  });
});

describe('la cassa usa la zona cercata, non solo le coordinate del modulo', () => {
  const src = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  it('la domanda della zona parte dalle coordinate cercate per l\'indirizzo scritto', () => {
    expect(src).toMatch(/const coordZona\s*=\s*useCoordinateDellaZona\(form,\s*pickupInStore\)/);
    const def = src.match(/const gruppoFuoriZona\s*=\s*([\s\S]*?\}\)\);)/)![1];
    expect(def).toMatch(/deliveryLat:\s*coordZona\?\.lat/);
    expect(def).toMatch(/deliveryLng:\s*coordZona\?\.lng/);
  });

  it('le coordinate cercate non entrano nel modulo (ne\' nel prezzo ne\' nell\'ordine)', () => {
    expect(src).not.toMatch(/setForm\([^)]*coordZona/);
    expect(src).not.toMatch(/lat:\s*coordZona/);
  });
});
