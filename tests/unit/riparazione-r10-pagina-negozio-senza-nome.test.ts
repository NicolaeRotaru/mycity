import { describe, expect, it, vi } from 'vitest';

/**
 * R10-002 — Un negozio senza nome: il guscio risponde 404, ma i metadati della sua pagina su misura
 * restavano indicizzabili col canonico. Ora dicono «non trovata», noindex, senza canonico.
 */
const mondo: { riga: unknown } = { riga: null };
vi.mock('@/lib/supabase/lettura-per-metadati', () => ({ leggiPerMetadati: async () => mondo.riga }));

const { generateMetadata } = await import('@/app/store/[id]/[slug]/layout');

const sito = { pages: [{ id: 'p1', slug: 'chi-siamo', title: 'Chi siamo', visibility: 'public', sections: [] }] };
const riga = (nome: unknown) => ({ id: 'n1', store_name: nome, store_description: null, store_logo: null, is_approved: true, role: 'seller', store_site: sito });
const chiama = () => generateMetadata({ params: Promise.resolve({ id: 'n1', slug: 'chi-siamo' }) });

describe('pagina del negozio senza nome: metadati come per il «non trovato»', () => {
  it.each(['', null])('store_name %j: noindex e senza canonico', async (nome) => {
    mondo.riga = riga(nome);
    const meta = await chiama();
    expect(String(meta.title)).toMatch(/non trovat[oa]/i);
    expect(meta.robots).toEqual({ index: false });
    expect(meta.alternates).toEqual({ canonical: null });
  });

  it('negozio normale con pagina pubblicata: indicizzabile, col canonico, senza robots undefined', async () => {
    mondo.riga = riga('Forno Rossi');
    const meta = await chiama();
    expect(String(meta.title)).toContain('Forno Rossi');
    expect(meta.alternates).toEqual({ canonical: '/store/n1/chi-siamo' });
    expect(Object.prototype.hasOwnProperty.call(meta, 'robots')).toBe(false);
  });

  it('pagina nascosta: noindex esplicito', async () => {
    mondo.riga = { ...riga('Forno Rossi'), store_site: { pages: [{ ...sito.pages[0], visibility: 'hidden' }] } };
    const meta = await chiama();
    expect(meta.robots).toEqual({ index: false });
  });
});
