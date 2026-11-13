import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/checkout/page.tsx', 'utf8');

describe('R19-004 · «Ho già un account» salva la bozza prima di uscire', () => {
  it('il link verso l\'accesso ha un onClick che salva la bozza', () => {
    const m = src.match(/<Link href="\/sign-in\?returnTo=\/checkout"([^>]*)>/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/onClick=\{salvaLaBozzaPerAccesso\}/);
  });
  it('il salvataggio passa da bozzaDaSalvare (con la scadenza) ed è lo stesso di «Ordina»', () => {
    const i = src.indexOf('const salvaLaBozzaPerAccesso');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 700)).toMatch(/localStorage\.setItem\('mc_checkout_draft', JSON\.stringify\(bozzaDaSalvare\(/);
    const h = src.indexOf('const handleSubmit');
    expect(src.slice(h)).toMatch(/if \(!authUser\) \{[\s\S]{0,900}salvaLaBozzaPerAccesso\(\);\s*router\.push\('\/sign-in\?returnTo=\/checkout'\)/);
  });
});
