/**
 * R16-001 — i contenitori con bg-surface-0 + bordo + raggio scritti a mano diventano <Card variant="surface">.
 * Prova leggera sui file della sessione: nessuna className con bg-surface-0, border e rounded insieme
 * (restano a mano solo il pannello-dialog delle notifiche e le pillole/barre che non sono card), e /near usa Card.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = ['app/near/page.tsx', 'app/rider/earnings/page.tsx', 'components/seller/SellerShell.tsx'];
const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('R16-001 · card surface', () => {
  it('nessuna card a mano con bg-surface-0 + border + rounded (salvo il dialog delle notifiche)', () => {
    for (const f of FILE) {
      const righe = leggi(f).split('\n').filter((r) => /className=/.test(r) && /\bbg-surface-0\b/.test(r) && /\bborder\b/.test(r) && /\brounded-/.test(r));
      const ammesse = righe.filter((r) => !/role|z-modal/.test(r));
      expect(ammesse, f).toEqual([]);
    }
  });
  it('/near usa Card variant surface per l\'invito alla posizione', () => {
    const src = leggi('app/near/page.tsx');
    expect(src).toContain("import { Card } from '@/components/ui/Card'");
    expect(src).toMatch(/<Card variant="surface" padding="none" className="mb-4 flex/);
  });
});
