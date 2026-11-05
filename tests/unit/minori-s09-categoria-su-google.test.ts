/**
 * S09 — Le descrizioni Google/WhatsApp delle categorie (schede 2087, 1989).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mondo = vi.hoisted(() => ({
  righe: {} as Record<string, unknown>,
}));

vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {} } }));
vi.mock('@/lib/supabase/lettura-per-metadati', () => ({
  leggiPerMetadati: async (_t: string, _c: string, dove: Record<string, string>) =>
    mondo.righe[dove.slug ?? `id:${dove.id}`] ?? null,
}));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'limit']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => ok({ data: [{ id: 'p1' }], error: null });
    return { from: () => q };
  },
}));

import { generateMetadata } from '@/app/category/[slug]/layout';
import { fraseComeArriva } from '@/lib/promesse-pubbliche';

beforeEach(() => {
  mondo.righe = {
    bambini: { id: 'c-b', slug: 'bambini', name: 'Bambini', parent_id: 'c-abb' },
    'id:c-abb': { name: 'Abbigliamento' },
    panificio: { id: 'c-p', slug: 'panificio', name: 'Panificio', parent_id: null },
  };
});

const descrizione = async (slug: string) =>
  String((await generateMetadata({ params: Promise.resolve({ slug }) })).description);

describe('2087 — il ripiego per le sottocategorie', () => {
  it('non scrive «Acquista bambini»', async () => {
    const d = await descrizione('bambini');
    expect(d).not.toMatch(/Acquista\s+\p{Ll}/u);
    expect(d).toMatch(/^Abbigliamento · Bambini dai negozi di Piacenza/);
  });
  it('senza madre resta il nome con la maiuscola', async () => {
    expect(await descrizione('panificio')).toMatch(/^Panificio dai negozi di Piacenza/);
  });
});

describe('1989 — nessuna descrizione scritta a mano promette tempi o zone che il codice non tiene', () => {
  it('casa e le altre non dicono veloce, rapida, provincia, gratis o minuti', async () => {
    for (const slug of ['alimentari', 'abbigliamento', 'casa', 'elettronica', 'libri', 'giardino', 'bellezza', 'sport']) {
      mondo.righe[slug] = { id: `c-${slug}`, slug, name: slug };
      // La frase condivisa sulla consegna nasce dagli interruttori veri: lì «veloce» è mantenuta.
      const d = (await descrizione(slug)).replace(fraseComeArriva(), '');
      expect(d, slug).not.toMatch(/veloc|rapid|provincia|gratis|gratuit|\bminut|\d+\s*[-–]\s*\d+\s*min/i);
    }
  });
});
