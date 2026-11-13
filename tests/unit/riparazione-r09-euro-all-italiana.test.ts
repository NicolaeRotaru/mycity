import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatPrice } from '@/lib/format';

// R09-024 — In tanti punti l'euro era scritto all'inglese: «€12.50» nell'anteprima del prodotto su
// WhatsApp, «Totale: €12.50» nel carrello condiviso, «= €5.00» nei punti, «€0 – €500» nei filtri.
// Prova sui file di R09: niente euro davanti alla cifra e niente toFixed per un prezzo.
const FILE = [
  'app/product/[id]/opengraph-image.tsx',
  'components/ShareCartButton.tsx',
  'app/profile/loyalty/page.tsx',
];
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('R09-024 · l’euro si scrive all’italiana', () => {
  it.each(FILE)('%s non scrive «€» davanti alla cifra né usa toFixed', (f) => {
    const s = senzaCommenti(readFileSync(f, 'utf8'));
    expect(s).not.toMatch(/€\s?\$?\{|'€\d|€\d/);
    expect(s).not.toMatch(/toFixed\(2\)/);
    expect(s).toContain('formatPrice(');
  });

  it('i filtri del prezzo in italiano mettono l’euro dopo la cifra', () => {
    const it = JSON.parse(readFileSync('messages/it.json', 'utf8')) as { search: Record<string, string> };
    expect(it.search.filterPrice).toBe('Fino a {max} €');
    expect(it.search.filterPriceRange).toBe('{min} € – {max} €');
    expect(it.search.filterPriceMin).toBe('Da {min} €');
  });

  it('formatPrice scrive «12,50 €»', () => {
    expect(formatPrice(12.5).replace(/\s/g, ' ')).toBe('12,50 €');
  });
});
