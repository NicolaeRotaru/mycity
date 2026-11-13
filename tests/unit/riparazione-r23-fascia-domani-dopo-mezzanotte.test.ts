import { afterEach, describe, expect, it, vi } from 'vitest';
import { negozioPuoServire, romeNow, type StoreHours } from '@/lib/store-hours';

/**
 * R23-005 — «Domani» si conta da quando la cassa ha proposto la fascia, non da quando la rotta la giudica.
 * Il negozio apre solo martedì (8:00–13:00). La fascia «Domani · 9:00–12:00» proposta lunedì alle 23:59
 * e arrivata alla rotta martedì alle 00:01 è per martedì: il negozio la serve.
 */
const SOLO_MARTEDI: StoreHours = { tue: [['08:00', '13:00']], mon: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
const DOMANI = 'Domani · 9:00–12:00';

afterEach(() => vi.useRealTimers());

describe('R23-005 — la fascia «domani» proposta prima di mezzanotte', () => {
  it('arrivata dopo mezzanotte si giudica sul giorno promesso, non su quello dopo', () => {
    vi.useFakeTimers();
    // lunedì 9/11/2026 23:59 a Piacenza (CET = UTC+1)
    const proposta = romeNow(new Date('2026-11-09T22:59:00Z'));
    // martedì 10/11/2026 00:01 a Piacenza
    vi.setSystemTime(new Date('2026-11-09T23:01:00Z'));
    expect(negozioPuoServire(SOLO_MARTEDI, DOMANI, romeNow(), proposta)).toBe(true);
  });

  it('senza istante di proposta resta la regola di prima: domani conta dall\'ora della richiesta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T23:01:00Z'));
    expect(negozioPuoServire(SOLO_MARTEDI, DOMANI)).toBe(false);
  });

  it('proposta e richiesta nello stesso giorno: nessun cambiamento', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T20:00:00Z'));
    const adesso = romeNow();
    expect(negozioPuoServire(SOLO_MARTEDI, DOMANI, adesso, adesso)).toBe(true);
  });
});
