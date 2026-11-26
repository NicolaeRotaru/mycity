/**
 * R09-004 — I testi sulla bozza della cassa dicono il vero: la bozza non ha una scadenza
 * (il campo e le funzioni della scadenza sono stati tolti da lib/bozza-checkout.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
const bozza = readFileSync('lib/bozza-checkout.ts', 'utf8');

describe('R09-004 — la bozza della cassa non scade, e i testi lo dicono', () => {
  it('lib/bozza-checkout.ts non ha nessuna scadenza', () => {
    expect(bozza).not.toMatch(/scadeIl|BOZZA_VALE_MS|scadenzaDellaBozzaValida/);
  });
  it('il commento di salvaLaBozzaPerAccesso non promette una scadenza', () => {
    const i = cassa.indexOf('const salvaLaBozzaPerAccesso');
    expect(i).toBeGreaterThan(0);
    const commento = cassa.slice(Math.max(0, i - 400), i);
    expect(commento).not.toMatch(/porta anche la scadenza/);
    expect(commento).toMatch(/non ha una scadenza/);
  });
});
