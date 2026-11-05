import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** S03 — scheda 18: i tre attrezzi mettono le migrazioni nello stesso ordine, 108 prima di 108b. */
describe('ordine delle migrazioni', () => {
  it('lo script del rilascio e la ricostruzione della CI ordinano byte per byte, come il generatore dei tipi', () => {
    for (const f of ['scripts/applica-migrazioni-mancanti.sh', 'tests/sql/harness/apply.sh']) {
      const testo = readFileSync(f, 'utf8');
      expect(testo, f).toMatch(/ls "\$MIG"\/\*\.sql \| LC_ALL=C sort\)/);
      expect(testo, f).not.toMatch(/for f in \$\(ls "\$MIG"\/\*\.sql \| sort -V\)/);
    }
    expect(readFileSync('scripts/gen-db-types.mjs', 'utf8')).toMatch(/readdirSync\(MIGRATIONS_DIR\)\.filter\(\(f\) => f\.endsWith\('\.sql'\)\)\.sort\(\)/);
  });

  it('con quell ordine 108 viene prima di 108b, e la shell e Node danno lo stesso elenco', () => {
    const shell = spawnSync('bash', ['-c', 'ls migrations/*.sql | LC_ALL=C sort'], { encoding: 'utf8' }).stdout.trim().split('\n').map((p) => p.replace('migrations/', ''));
    const node = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    expect(shell).toEqual(node);
    expect(shell.indexOf('108_atomic_coupon_claim.sql')).toBeLessThan(shell.indexOf('108b_seller_public_profiles_stripe_trust.sql'));
  });
});
