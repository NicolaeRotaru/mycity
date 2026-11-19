import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tassoDiConversione } from '@/app/seller/analytics/letture-dell-andamento';

/** R09-005 — il tasso non supera il 100% per un errore di misura. */
describe('R09-005 tasso di conversione', () => {
  it('più ordini che visite misurate: nessun tasso (campione troppo piccolo)', () => {
    expect(tassoDiConversione(12, 5)).toBeNull();
    expect(tassoDiConversione(3, 2)).toBeNull();
  });
  it('fino al 100% il conto resta quello', () => {
    expect(tassoDiConversione(5, 5)).toBe(100);
    expect(tassoDiConversione(4, 200)).toBe(2);
  });
  it('la scheda ha l\'etichetta in italiano e dice del campione piccolo', () => {
    const src = readFileSync(join(process.cwd(), 'app/seller/analytics/page.tsx'), 'utf8');
    expect(src).not.toContain('Conversion rate');
    expect(src).toContain('Visite che diventano ordini');
    expect(src).toContain('Campione troppo piccolo');
  });
});
