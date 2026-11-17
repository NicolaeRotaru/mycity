/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 17/11/2026 — Il Drop del giorno in home usava il giorno di Greenwich: alle 00:30 di Piacenza
 * (23:30 UTC) cercava il drop di ieri, mentre la pagina admin lo fissa sul giorno di Piacenza, e
 * il conto alla rovescia contava fino alla mezzanotte dell'orologio del dispositivo.
 */
type Opzioni = { queryKey: readonly unknown[] };
const g = globalThis as Record<string, unknown>;

const DROP = {
  id: 'd1',
  drop_date: '2026-11-18',
  discount_percent: 30,
  original_price: 10,
  drop_price: 7,
  headline: null,
  product: { id: 'p1', name: 'Focaccia', description: null, images: null, profiles: { id: 'n1', store_name: 'Forno Rossi' } },
};

afterEach(() => {
  vi.useRealTimers();
  delete g.__OPZIONI_QUERY__;
  delete g.__DATI_QUERY__;
});

describe('il Drop del giorno segue il giorno di Piacenza', () => {
  it('alle 23:30 UTC (00:30 a Piacenza) chiede il drop del giorno dopo', async () => {
    const mod = await monta('components/home/DropOfDay.tsx');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T23:30:00Z'));

    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    g.__DATI_QUERY__ = function dati(o: Opzioni) {
      return o.queryKey[0] === 'daily-drop' ? DROP : undefined;
    };

    const s = accendi(mod.default, {});
    const chiave = opzioni.find((o) => o.queryKey[0] === 'daily-drop')?.queryKey;
    s.smonta();
    expect(chiave).toEqual(['daily-drop', '2026-11-18']);
  }, 60000);

  it('alle 23:30 UTC il conto alla rovescia arriva alla mezzanotte di Piacenza, non a quella del dispositivo', async () => {
    const mod = await monta('components/home/DropOfDay.tsx');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T23:30:00Z'));
    g.__DATI_QUERY__ = function dati(o: Opzioni) {
      return o.queryKey[0] === 'daily-drop' ? DROP : undefined;
    };
    const s = accendi(mod.default, {});
    // Mancano 23 ore e 29 minuti alla mezzanotte di Piacenza fra il 18 e il 19 novembre.
    const conto = [...s.radice.querySelectorAll('.font-mono span')].map((e) => testoVisibile(e)).join('');
    s.smonta();
    expect(conto).toBe('23:29:59');
  }, 60000);

  it('a metà giornata il giorno è lo stesso a Greenwich e a Piacenza', async () => {
    const mod = await monta('components/home/DropOfDay.tsx');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T11:00:00Z'));
    const opzioni: Opzioni[] = [];
    g.__OPZIONI_QUERY__ = opzioni;
    const s = accendi(mod.default, {});
    expect(opzioni.find((o) => o.queryKey[0] === 'daily-drop')?.queryKey).toEqual(['daily-drop', '2026-11-17']);
    s.smonta();
  }, 60000);
});
