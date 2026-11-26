/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { useCoordinateDellaZona, ATTESA_ZONA_MS } from '@/components/checkout/ShippingAddressForm';
import { accendi } from './aiuti/schermo';

/**
 * R24 — Alla cassa, mentre si scrive l'indirizzo, la ricerca della zona vecchia si annulla
 * (AbortController) e, anche se la sua risposta arriva dopo, non sovrascrive quella nuova.
 */

type Chiamata = { q: string; signal: AbortSignal | undefined; rispondi: (lat: number, lng: number) => void };
let chiamate: Chiamata[] = [];
const reteDiPartenza = globalThis.fetch;

beforeEach(() => {
  chiamate = [];
  vi.useFakeTimers();
  globalThis.fetch = ((_url: string, init?: { body?: string; signal?: AbortSignal }) =>
    new Promise((resolve) => {
      chiamate.push({
        q: JSON.parse(init?.body ?? '{}').q,
        signal: init?.signal,
        rispondi: (lat, lng) => resolve({ ok: true, status: 200, json: async () => ({ lat, lng }) }),
      });
    })) as unknown as typeof fetch;
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

function Cassa(p: { iniziale: Ind }) {
  const [ind, setInd] = useState(p.iniziale);
  impostaIndirizzo = setInd;
  const c = useCoordinateDellaZona(ind);
  return createElement('p', null, c ? `${c.lat},${c.lng}` : 'NIENTE');
}

async function avanza(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const A: Ind = { address: 'Via Roma 10', city: 'Podenzano', zip: '29027', lat: null, lng: null };
const B: Ind = { address: 'Via Cavour 1', city: 'Piacenza', zip: '29121', lat: null, lng: null };

describe('la ricerca vecchia della zona', () => {
  it('si annulla quando l\'indirizzo cambia mentre la risposta non e\' ancora arrivata', async () => {
    schermo = accendi(Cassa, { iniziale: A });
    await avanza(ATTESA_ZONA_MS + 10);
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0].signal?.aborted).toBe(false);
    await act(async () => impostaIndirizzo(B));
    expect(chiamate[0].signal?.aborted).toBe(true);
  });

  it('la risposta vecchia che arriva dopo la nuova non la sovrascrive', async () => {
    schermo = accendi(Cassa, { iniziale: A });
    await avanza(ATTESA_ZONA_MS + 10);
    await act(async () => impostaIndirizzo(B));
    await avanza(ATTESA_ZONA_MS + 10);
    expect(chiamate).toHaveLength(2);
    await act(async () => { chiamate[1].rispondi(45.048, 9.7); });
    expect(schermo.radice.textContent).toBe('45.048,9.7');
    await act(async () => { chiamate[0].rispondi(44.955, 9.683); });
    expect(schermo.radice.textContent).toBe('45.048,9.7');
  });

  it('si annulla anche allo smontaggio', async () => {
    schermo = accendi(Cassa, { iniziale: A });
    await avanza(ATTESA_ZONA_MS + 10);
    expect(chiamate[0].signal?.aborted).toBe(false);
    schermo.smonta();
    schermo = null;
    expect(chiamate[0].signal?.aborted).toBe(true);
  });
});
