import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R22-005 — Nelle recensioni del fattorino un commento con una parola lunga allargava la pagina sul telefono
// piccolo, e i filtri per stelle erano alti 24 px. Prova leggera sulle classi.
const src = readFileSync('app/rider/reviews/page.tsx', 'utf8');

describe('R22-005 · recensioni del fattorino sul telefono', () => {
  it('il commento va a capo anche dentro una parola lunga', () => {
    const riga = src.split('\n').find((l) => l.includes('{r.comment &&')) ?? '';
    expect(riga).toContain('break-words');
    expect(riga).toContain('[overflow-wrap:anywhere]');
  });

  it('i filtri per stelle e «Mostra tutte» hanno una zona da toccare di almeno 44 px', () => {
    const stella = src.split('\n').find((l) => l.includes('flex w-full items-center gap-3')) ?? '';
    expect(stella).toContain('min-h-11');
    const tutte = src.split('\n').find((l) => l.includes('Mostra tutte')) ?? '';
    expect(tutte).toContain('min-h-11');
  });
});
