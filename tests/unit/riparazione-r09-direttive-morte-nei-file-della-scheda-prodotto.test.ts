/**
 * La scheda prodotto e la sua immagine di condivisione non portano permessi «eslint-disable» che non
 * saltano niente (la regola @next/next/no-img-element è spenta in .eslintrc.json: il permesso era morto).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

type Messaggio = { message: string };
type Eslint = { lintFiles(f: string[]): Promise<Array<{ filePath: string; messages: Messaggio[] }>> };
const { ESLint } = createRequire(import.meta.url)('eslint') as {
  ESLint: new (o?: { reportUnusedDisableDirectives?: string }) => Eslint;
};

describe('direttive eslint-disable morte nei file di R09 della scheda prodotto', () => {
  it('nessuna direttiva senza effetto in page.tsx e opengraph-image.tsx del prodotto', async () => {
    const eslint = new ESLint({ reportUnusedDisableDirectives: 'warn' });
    const risultati = await eslint.lintFiles(['app/product/[id]/page.tsx', 'app/product/[id]/opengraph-image.tsx']);
    const morte = risultati.flatMap((r) => r.messages.filter((m) => /Unused eslint-disable/.test(m.message)));
    expect(morte).toEqual([]);
  }, 90_000);
});
