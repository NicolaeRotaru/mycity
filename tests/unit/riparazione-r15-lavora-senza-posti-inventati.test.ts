import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const lavora = readFileSync(path.resolve(__dirname, '../../app/lavora-con-noi/page.tsx'), 'utf8');

describe('lavora con noi non pubblica posizioni inventate', () => {
  it('nessuna delle quattro posizioni è nel file', () => {
    for (const t of ['Account negozi', 'Coordinatore flotta', 'Product Designer', 'Operatore supporto clienti'])
      expect(lavora).not.toContain(t);
  });
  it('con zero posizioni lo dice e offre la candidatura spontanea', () => {
    expect(lavora).toMatch(/Oggi non abbiamo posizioni aperte/);
    expect(lavora).toContain("mailtoContatto('lavoro', 'Candidatura spontanea')");
    expect(lavora).toMatch(/const JOBS: Array<[^=]*= \[\];/);
  });
});
