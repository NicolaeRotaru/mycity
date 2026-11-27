import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('R12-006 — sotto il logo i formati scritti sono quelli che la casella accetta', () => {
  const src = readFileSync(join(process.cwd(), 'components', 'VendorForm.tsx'), 'utf8');
  it('non c\'è più «(PNG, JPG)» scritto a mano', () => {
    expect(src).not.toContain('(PNG, JPG)');
  });
  it('il testo sotto il logo usa tipiScrittiPerUmani(), la stessa fonte di mappaAccept()', () => {
    expect(src).toMatch(/immagine quadrata \(\{tipiScrittiPerUmani\(\)\}\)/);
    expect(src).toContain('accept: mappaAccept()');
  });
});
