import { describe, it, expect } from 'vitest';
import { deliveryWindow, splitDuration, deliveryEstimate, EXPRESS_ETA_LABEL, STANDARD_ETA_LABEL } from '@/lib/delivery';

/**
 * Unit test puri per lib/delivery — finestra di consegna same-day e cutoff.
 * Senza network / DB / timer reali: si passa `now` esplicito.
 */

// Helper: timestamp ms per una data/ora locale specifica.
const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe('deliveryWindow', () => {
  it('prima del cutoff → consegna oggi', () => {
    const now = at(2026, 5, 30, 10, 0); // 10:00, cutoff 18
    const w = deliveryWindow(now, 18);
    expect(w.beforeCutoff).toBe(true);
    expect(w.day).toBe('oggi');
    // target = oggi alle 18
    expect(new Date(w.targetIso).getHours()).toBe(18);
  });

  it('dopo il cutoff → consegna domani', () => {
    const now = at(2026, 5, 30, 19, 0); // 19:00, oltre le 18
    const w = deliveryWindow(now, 18);
    expect(w.beforeCutoff).toBe(false);
    expect(w.day).toBe('domani');
    const target = new Date(w.targetIso);
    expect(target.getHours()).toBe(18);
    expect(target.getDate()).toBe(31); // giorno successivo
  });

  it('esattamente al cutoff → già domani (non sei più in tempo)', () => {
    const now = at(2026, 5, 30, 18, 0);
    expect(deliveryWindow(now, 18).day).toBe('domani');
  });

  it('rispetta un cutoffHour personalizzato', () => {
    const now = at(2026, 5, 30, 13, 0);
    expect(deliveryWindow(now, 12).day).toBe('domani');
    expect(deliveryWindow(now, 14).day).toBe('oggi');
  });
});

describe('deliveryEstimate', () => {
  it('non disponibile → Standard 2-3 giorni, senza giorno/ETA', () => {
    const now = at(2026, 5, 30, 10, 0);
    const e = deliveryEstimate({ available: false, nowMs: now, cutoffHour: 18 });
    expect(e.speed).toBe('standard');
    expect(e.day).toBeNull();
    expect(e.label).toBe(STANDARD_ETA_LABEL);
    expect(e.etaLabel).toBeUndefined();
  });

  it('disponibile prima del cutoff → Express oggi, ETA 30-60 min', () => {
    const now = at(2026, 5, 30, 10, 0); // prima delle 18
    const e = deliveryEstimate({ available: true, nowMs: now, cutoffHour: 18 });
    expect(e.speed).toBe('express');
    expect(e.day).toBe('oggi');
    expect(e.label).toBe('oggi');
    expect(e.etaLabel).toBe(EXPRESS_ETA_LABEL);
  });

  it('disponibile dopo il cutoff → Express domani, senza ETA in minuti', () => {
    const now = at(2026, 5, 30, 19, 0); // oltre le 18
    const e = deliveryEstimate({ available: true, nowMs: now, cutoffHour: 18 });
    expect(e.speed).toBe('express');
    expect(e.day).toBe('domani');
    expect(e.label).toBe('domani');
    expect(e.etaLabel).toBeUndefined();
  });
});

describe('splitDuration', () => {
  it('scompone ore/minuti/secondi', () => {
    expect(splitDuration(2 * 3_600_000 + 14 * 60_000 + 31_000)).toEqual({ h: 2, m: 14, s: 31 });
  });

  it('mai negativo', () => {
    expect(splitDuration(-5000)).toEqual({ h: 0, m: 0, s: 0 });
  });
});
