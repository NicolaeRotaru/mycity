import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const seme = readFileSync(path.resolve(__dirname, '../../seeds/001_piacenza_stores.sql'), 'utf8');

describe('il seme di sviluppo non punta a placehold.co', () => {
  it('nessun indirizzo placehold.co', () => {
    expect(seme).not.toMatch(/placehold\.co/i);
  });
  it('i prodotti inseriti restano 240, senza foto (la scheda mostra il segnaposto locale)', () => {
    const righe = seme.match(/^\s+\(s_\w+, c_\w+, '/gm) ?? [];
    expect(righe).toHaveLength(240);
    expect((seme.match(/'\[\]'::jsonb\)/g) ?? []).length).toBeGreaterThanOrEqual(240);
  });
});
