import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S01 — 1521: la pagina «Metti in primo piano» manda la chiave del tentativo
 * che la rotta della sponsorizzazione usa contro il doppio pagamento.
 */
describe('1521 — la chiave contro il doppio pagamento della sponsorizzazione', () => {
  const pagina = readFileSync('app/seller/promote/page.tsx', 'utf8');
  it('la richiesta a /api/sponsored/checkout porta Idempotency-Key', () => {
    const i = pagina.indexOf("fetch('/api/sponsored/checkout'");
    expect(i).toBeGreaterThan(0);
    expect(pagina.slice(i, i + 300)).toContain("'Idempotency-Key': chiaveTentativo.current");
  });
  it('la chiave nasce una per modulo e si rifà dopo un esito', () => {
    expect(pagina).toContain('useRef<string>(crypto.randomUUID())');
    expect(pagina).toMatch(/chiaveTentativo\.current = crypto\.randomUUID\(\);/);
  });
  it('la rotta legge proprio quell intestazione', () => {
    expect(readFileSync('app/api/sponsored/checkout/route.ts', 'utf8')).toContain("req.headers.get('idempotency-key')");
  });
});
