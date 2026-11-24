import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R04-002 (parte chiudibile) — i riquadri `bg-white|bg-surface-0 border border-cream-300 rounded-*` scritti a mano
 * in chi siamo, bacheca del fattorino, griglia prodotti e filtri del negozio diventano <Card>
 * (il raggio per contesto è già deciso in Card.tsx). Prova leggera, come quella di R16-003.
 */
const FILE = ['app/about/page.tsx', 'app/rider/page.tsx', 'components/ProductGrid.tsx', 'components/StoreProductExplorer.tsx'];
const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('R04-002 — riquadri a mano -> Card nei file di R04', () => {
  it.each(FILE)('%s importa Card e non ha più <div> a mano con lo schema della card', (f) => {
    const src = leggi(f);
    expect(src).toContain("import { Card } from '@/components/ui/Card'");
    expect(src).toContain('<Card');
    const aMano = src
      .split('\n')
      .filter((r) => /<div\b[^>]*className="[^"]*\b(bg-white|bg-surface-0)\b[^"]*"/.test(r))
      .filter((r) => !/\baria-live=/.test(r)) // la card con aria-live non può ancora essere una Card (Card non passa aria-live)
      .filter((r) => /\bborder border-cream-300\b/.test(r) && /\brounded-(lg|xl|2xl)\b/.test(r));
    expect(aMano).toEqual([]);
  });
});
