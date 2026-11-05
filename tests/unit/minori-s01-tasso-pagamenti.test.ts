import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** S01 — 645: il tasso dei pagamenti riusciti del pannello conta solo la cassa clienti. */
describe('645 — il tasso di autorizzazione non mescola i negozi coi clienti', () => {
  it('la lettura di payment_attempts filtra i tentativi senza carrello', () => {
    const s = readFileSync('app/admin/page.tsx', 'utf8');
    const i = s.indexOf(".from('payment_attempts')");
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 600)).toContain(".not('pending_checkout_id', 'is', null)");
  });
});
