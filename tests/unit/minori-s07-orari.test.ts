import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chiaveDiOggi,
  formatToday,
  isOpenNow,
  negozioPuoServire,
  romeNow,
  ultimoRitiroDellaFascia,
  type StoreHours,
} from '@/lib/store-hours';

/** Un istante sull'orologio da parete italiano (come lo produce romeNow). */
const ora = (aaaa: number, mm: number, gg: number, h: number, m = 0) => new Date(aaaa, mm - 1, gg, h, m);

describe('S07 · il negozio che chiude a mezzanotte', () => {
  const sera: StoreHours = { mon: [['18:00', '00:00']], tue: [['18:00', '00:00']], wed: [['18:00', '00:00']] };
  it('lunedì alle 20:30 è aperto', () => {
    expect(isOpenNow(sera.mon, ora(2026, 11, 2, 20, 30))).toBe(true);
    expect(formatToday(sera.mon, ora(2026, 11, 2, 20, 30))).toBe('Aperto fino alle 00:00');
  });
  it('alle 23:59 ancora aperto, alle 17:59 non ancora', () => {
    expect(isOpenNow(sera.mon, ora(2026, 11, 2, 23, 59))).toBe(true);
    expect(isOpenNow(sera.mon, ora(2026, 11, 2, 17, 59))).toBe(false);
  });
  it('la cassa accetta «Adesso» la sera', () => {
    expect(negozioPuoServire(sera, 'Adesso · arrivo in 30-60 min', ora(2026, 11, 2, 20, 30))).toBe(
      negozioPuoServire(sera, undefined, ora(2026, 11, 2, 20, 30)),
    );
    expect(negozioPuoServire(sera, undefined, ora(2026, 11, 2, 20, 30))).toBe(true);
  });
  it('una fascia che passa la mezzanotte (19:00–01:00) vale almeno fino a mezzanotte', () => {
    expect(isOpenNow([['19:00', '01:00']], ora(2026, 11, 2, 22, 0))).toBe(true);
  });
});

describe('S07 · due intervalli attaccati sono un negozio aperto di fila', () => {
  it('9-13, 13-17:30 e 17:30-19:30: ogni fascia di oggi si legge come col negozio aperto di fila', () => {
    const forno: StoreHours = { mon: [['09:00', '13:00'], ['13:00', '17:30'], ['17:30', '19:30']] };
    const adesso = ora(2026, 11, 2, 8, 0);
    const solo: StoreHours = { mon: [['09:00', '19:30']] };
    // Per ogni fascia di oggi, la risposta è la stessa del negozio scritto con un intervallo solo.
    for (const fascia of [
      'In giornata · 15:00–18:00',
      'Stasera · 18:00–20:00',
      'Oggi · 11:00–13:00',
      'Oggi · 13:00–16:30',
      'Oggi · 16:30–18:00',
    ]) {
      expect(ultimoRitiroDellaFascia(forno, fascia, adesso), fascia).toEqual(ultimoRitiroDellaFascia(solo, fascia, adesso));
    }
    // Il caso che prima sbagliava: il ritiro si fa entro le 17:00 (dentro 13-17:30) e la fascia
    // finisce alle 18:00, dentro l'intervallo attaccato dopo.
    expect(ultimoRitiroDellaFascia(forno, 'Oggi · 16:30–18:00', adesso)?.apertoFinoAllaFine).toBe(true);
  });
});

describe('S07 · il giorno e l\'ora con lo stesso orologio', () => {
  it('server in UTC, 23:30 di martedì = 00:30 di mercoledì a Piacenza: la casella è mercoledì', () => {
    expect(chiaveDiOggi(romeNow(new Date('2026-11-03T23:30:00Z')))).toBe('wed');
  });
  it('romeNow segue il cambio d\'ora (inverno +1, estate +2)', () => {
    const inverno = romeNow(new Date('2026-01-15T10:05:07Z'));
    expect([inverno.getHours(), inverno.getMinutes(), inverno.getSeconds()]).toEqual([11, 5, 7]);
    const estate = romeNow(new Date('2026-07-15T22:30:00Z'));
    expect([estate.getDate(), estate.getHours(), estate.getMinutes()]).toEqual([16, 0, 30]);
  });
  it('nessuna pagina sceglie più il giorno con l\'orologio della macchina', () => {
    for (const f of [
      'app/stores/page.tsx', 'components/StoreListRow.tsx', 'components/store-sections/HeroSection.tsx',
      'components/store-sections/HoursSection.tsx', 'components/home/HeroStoreCard.tsx',
      'components/ProductGrid.tsx', 'components/StorePreviewCard.tsx',
    ]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/DAY_KEYS\[new Date\(\)\.getDay\(\)\]/);
    }
  });
  it('romeNow non costruisce un formattatore a ogni chiamata (costo vicino a new Date)', () => {
    const src = readFileSync('lib/store-hours.ts', 'utf8');
    const corpo = src.slice(src.indexOf('export function romeNow'), src.indexOf('export function romeNow') + 400);
    expect(corpo).not.toMatch(/toLocaleString/);
  });
});

describe('S07 · il no della fascia dice il motivo vero', () => {
  it('bar aperto martedì 10:30-19:00, lunedì sera «Domani · 9:00–11:00»: non dice «è chiuso in quella fascia»', async () => {
    const { motivoNegozioChiuso } = await import('@/lib/store-hours');
    const bar: StoreHours = { tue: [['10:30', '19:00']] , mon: [['10:30', '19:00']], wed: [], thu: [] };
    const lunediSera = ora(2026, 11, 2, 19, 0);
    expect(negozioPuoServire(bar, 'Domani · 9:00–11:00', lunediSera)).toBe(false);
    const msg = motivoNegozioChiuso('Bar', 'Domani · 9:00–11:00', lunediSera);
    expect(msg).toContain('domani');
    expect(msg).not.toMatch(/è chiuso in quella fascia/);
    expect(msg).toMatch(/apre troppo tardi/);
  });
});
