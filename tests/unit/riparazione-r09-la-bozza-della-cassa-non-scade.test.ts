/**
 * R09-004 — I testi sulla bozza della cassa dicono il vero.
 *
 * Il 26/11 mattina la bozza non aveva una scadenza (il campo e le funzioni della scadenza erano
 * stati tolti da lib/bozza-checkout.ts), e il nome di questo file viene da lì. Dal 26/11 sera
 * (R26-016) la bozza scade dopo due ore, contate dall'ora del salvataggio (`sceltaIl`), e il
 * controllo sta nella cassa (`bozzaScaduta`), non in lib/bozza-checkout.ts: i testi devono dire
 * questo, e niente di più.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
const bozza = readFileSync('lib/bozza-checkout.ts', 'utf8');

describe('R09-004 — i testi sulla scadenza della bozza della cassa dicono dove sta davvero', () => {
  it('lib/bozza-checkout.ts non ha nessuna scadenza', () => {
    expect(bozza).not.toMatch(/scadeIl|BOZZA_VALE_MS|scadenzaDellaBozzaValida/);
  });
  it('il commento di salvaLaBozzaPerAccesso dice la scadenza vera e dove si controlla', () => {
    const i = cassa.indexOf('const salvaLaBozzaPerAccesso');
    expect(i).toBeGreaterThan(0);
    const commento = cassa.slice(Math.max(0, i - 400), i);
    expect(commento).not.toMatch(/porta anche la scadenza/);
    expect(commento).not.toMatch(/non ha una scadenza/);
    expect(commento).toMatch(/due ore/);
    expect(commento).toMatch(/bozzaScaduta/);
    expect(cassa).toMatch(/function bozzaScaduta\(/);
  });
});
