import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R07-008 (12/11/2026) — il tasto per togliere una foto dal reso era h-6 w-6
 * (24 px), la metà del minimo di 44. Prova leggera sulle classi del tasto.
 */
const pagina = readFileSync('app/orders/[id]/return/page.tsx', 'utf8');

describe('R07-008 · il tasto «togli la foto» è grande almeno 44 px', () => {
  it('l area del tasto è h-11 w-11, e il pallino visibile sta dentro', () => {
    const i = pagina.indexOf('aria-label={`Togli la foto ${i + 1}`}');
    expect(i).toBeGreaterThan(-1);
    const tasto = pagina.slice(i, pagina.indexOf('</button>', i));
    const classi = tasto.match(/className="([^"]+)"/)?.[1] ?? '';
    expect(classi).toMatch(/\bh-11\b/);
    expect(classi).toMatch(/\bw-11\b/);
    expect(classi).not.toMatch(/\bh-6\b/);
    // Le miniature stanno a gap-2 (8 px): il tasto non deve sporgere oltre, o copre la foto accanto.
    expect(classi).toMatch(/-right-2\b/);
  });
});
