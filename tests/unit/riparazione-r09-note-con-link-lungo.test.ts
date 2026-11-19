import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** R09-016 — la nota di consegna con un link lungo non allarga la pagina (legge il sorgente). */
const leggi = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('R09-016 note di consegna che vanno a capo', () => {
  it.each([
    ['app/orders/[id]/page.tsx', /<span className="[^"]*\[overflow-wrap:anywhere\][^"]*">Note: \{order\.delivery_notes\}/],
    ['app/seller/orders/[id]/page.tsx', /<p className="[^"]*\[overflow-wrap:anywhere\][^"]*">Note: \{order\.delivery_notes\}/],
    ['app/rider/orders/[id]/page.tsx', /<span className="min-w-0 \[overflow-wrap:anywhere\]">\{order\.delivery_notes\}<\/span>/],
  ])('%s', (file, rx) => {
    expect(leggi(file)).toMatch(rx);
  });
});
