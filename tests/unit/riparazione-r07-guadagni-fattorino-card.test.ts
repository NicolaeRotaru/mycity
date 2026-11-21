import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R07-001 — nei guadagni del fattorino le card dello storico erano scritte a mano
 * (`rounded-lg border border-cream-300 bg-surface-0`): ora sono la primitiva Card.
 * Prova statica: nel file non resta la card scritta a mano (`rounded-lg border ... bg-surface-0`) e le due card usano la variante.
 */
const src = readFileSync(join(process.cwd(), 'app', 'rider', 'earnings', 'page.tsx'), 'utf8');

describe('R07-001 — lo storico consegne usa la Card', () => {
  it('nessuna card a mano con bg-surface-0', () => {
    expect(src).not.toMatch(/rounded-lg border border-cream-300 bg-surface-0/);
  });
  it('le due card dello storico sono <Card variant="surface">', () => {
    expect(src.match(/<Card [^>]*variant="surface" radius="lg"/g)?.length).toBe(2);
  });
});
