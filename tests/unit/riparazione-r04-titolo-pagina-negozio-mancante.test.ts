import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * 17/11/2026 — Una pagina della vetrina di un negozio che non c'è (o di una pagina che il negozio
 * non ha) diceva «Pagina non trovata» due volte: nel titolo della scheda e nell'h1 della pagina.
 * Next manda i metadati in streaming dentro il corpo, quindi la scritta compariva doppia, come
 * succedeva alla 404 prima di R15-005. Il titolo deve dire «non trovata» con parole sue.
 */
const mondo: { riga: unknown } = { riga: null };
vi.mock('@/lib/supabase/lettura-per-metadati', () => ({
  leggiPerMetadati: async () => mondo.riga,
}));

const { generateMetadata } = await import('@/app/store/[id]/[slug]/layout');

// L'h1 che la pagina disegna quando la pagina del negozio non c'è.
const sorgente = readFileSync('app/store/[id]/[slug]/page.tsx', 'utf8');
const H1 = sorgente.match(/title="([^"]+)"\s*titoloCome="h1"/)?.[1] ?? '';

async function titolo(id: string, slug: string) {
  const meta = await generateMetadata({ params: Promise.resolve({ id, slug }) });
  return { titolo: String(meta.title), meta };
}

describe('il titolo della pagina di un negozio che non c’è', () => {
  it('l’h1 della pagina mancante è quello che conosciamo', () => {
    expect(H1).toBe('Pagina non trovata');
  });

  it('negozio inesistente: il titolo dice «non trovata» senza ripetere l’h1', async () => {
    mondo.riga = null;
    const { titolo: t, meta } = await titolo('mai-esistito', 'chi-siamo');
    expect(t.toLowerCase()).not.toContain(H1.toLowerCase());
    expect(t).toMatch(/non trovata/i);
    expect(t).toMatch(/MyCity$/);
    expect(meta.robots).toEqual({ index: false });
  });

  it('negozio vero ma pagina che non ha: stesso titolo, senza ripetizione', async () => {
    mondo.riga = {
      id: 'n1', store_name: 'Forno Rossi', store_description: null, store_logo: null,
      is_approved: true, role: 'seller', store_site: null,
    };
    const { titolo: t } = await titolo('n1', 'pagina-che-non-esiste');
    expect(t.toLowerCase()).not.toContain(H1.toLowerCase());
    expect(t).toMatch(/non trovata/i);
  });
});
