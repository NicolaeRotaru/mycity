import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COLORI_DEL_SITO, esadecimaliIn } from './aiuti/tavolozza-del-sito';

/**
 * R08-010 — Nella mappa «Vicino a te» il pallino «sei qui» era blu (#2563eb, con l'alone
 * rgba(37,99,235,.25)): un colore che il design system non ha. Il pallino è HTML scritto a
 * mano dentro il divIcon di Leaflet, quindi i controlli sulle classi Tailwind non lo vedono.
 * Qui si leggono tutti i colori scritti nel file e si pretende che siano della tavolozza
 * (il nero e il bianco delle ombre e dei bordi sono neutri e ammessi).
 */
const src = readFileSync('components/NearbyStoresMap.tsx', 'utf8');
const NEUTRI = new Set(['#000000', '#FFFFFF']);
const esa = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

describe('R08-010 — la mappa usa i colori del marchio', () => {
  it('ogni esadecimale scritto nel file è della tavolozza', () => {
    const fuori = esadecimaliIn(src).filter((h) => !COLORI_DEL_SITO.has(h) && !NEUTRI.has(h));
    expect(fuori).toEqual([]);
  });

  it('ogni rgba() scritto nel file è un colore della tavolozza (o il nero delle ombre)', () => {
    const fuori = [...src.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)]
      .map((m) => esa(Number(m[1]), Number(m[2]), Number(m[3])))
      .filter((h) => !COLORI_DEL_SITO.has(h) && !NEUTRI.has(h));
    expect(fuori).toEqual([]);
  });
});
