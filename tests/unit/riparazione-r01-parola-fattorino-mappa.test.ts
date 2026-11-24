// R01-009 — l'etichetta del pin sulla mappa dell'ordine dice «Fattorino», come il resto del testo al cliente.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'app', 'orders', '[id]', 'page.tsx'), 'utf8');

describe('R01-009 la mappa dell\'ordine e l\'email dicono «fattorino»', () => {
  it('l\'etichetta del pin sulla mappa è «Fattorino», non «Rider»', () => {
    const i = src.indexOf('label: posizioneRider.fresca');
    expect(i).toBeGreaterThan(-1);
    const blocco = src.slice(i, i + 220);
    expect(blocco).toContain("'Fattorino'");
    expect(blocco).toContain('Fattorino · ultima posizione');
    expect(blocco).not.toMatch(/['`]Rider\b|`Rider /);
  });

  it('l\'email dell\'ordine pronto parla di un fattorino', async () => {
    const t = readFileSync(join(process.cwd(), 'lib', 'email', 'templates.ts'), 'utf8');
    expect(t).toContain('un fattorino passa a prenderlo');
    expect(t).not.toContain('un rider passa a prenderlo');
  });
});
