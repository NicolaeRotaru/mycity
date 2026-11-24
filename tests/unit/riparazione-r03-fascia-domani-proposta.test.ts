import { afterEach, describe, expect, it, vi } from 'vitest';
import { motivoFasciaRifiutata } from '@/lib/quando-arriva';
import { romeNow } from '@/lib/store-hours';

// Il negozio apre solo martedì 9-13. Lunedì 23:59 la cassa propone «Domani · 9:00–11:00» (martedì);
// la rotta la giudica a mezzanotte e due minuti, quando «domani» sarebbe mercoledì (chiuso).
const SOLO_MARTEDI = {
  mon: [], tue: [['09:00', '13:00']], wed: [], thu: [], fri: [], sat: [], sun: [],
};
const FASCIA = 'Domani · 9:00–11:00';
const negozi = [{ nome: 'Forno', orari: SOLO_MARTEDI }];

afterEach(() => vi.useRealTimers());

describe('R03-003 / R03-006: «Domani» si conta dal giorno della proposta', () => {
  it('proposta lunedì 23:59, giudicata martedì 00:01: si giudica su martedì', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T22:59:00Z')); // lunedì 23:59 a Roma
    const propostaIl = romeNow();
    vi.setSystemTime(new Date('2026-11-23T23:01:00Z')); // martedì 00:01 a Roma
    expect(motivoFasciaRifiutata(FASCIA, negozi, undefined, propostaIl)).toBeNull();
  });

  it('senza il momento della proposta si giudica dal giorno della rotta (mercoledì, chiuso)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T23:01:00Z'));
    expect(motivoFasciaRifiutata(FASCIA, negozi)).toContain('Forno');
  });
});
