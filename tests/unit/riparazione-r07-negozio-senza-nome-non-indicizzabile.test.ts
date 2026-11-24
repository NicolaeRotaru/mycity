import { describe, expect, it, vi } from 'vitest';

/**
 * R07-002 — Un negozio approvato ma senza nome: il guscio risponde 404, ma i metadati restavano
 * quelli di un negozio vero (titolo «Negozio — Acquista online…», indicizzabile, canonico). Ora
 * dicono «non trovata», non si indicizzano e non hanno il canonico, come per il negozio che non c'è.
 */
const mondo: { riga: unknown } = { riga: null };
vi.mock('@/lib/supabase/lettura-per-metadati', () => ({ leggiPerMetadati: async () => mondo.riga }));

const { generateMetadata } = await import('@/app/store/[id]/layout');

describe('negozio senza nome: metadati come per il «non trovato»', () => {
  it.each([null, '', undefined])('store_name %j: non indicizzabile, senza canonico', async (nome) => {
    mondo.riga = { id: 'n1', store_name: nome, store_description: null, store_logo: null, store_address: 'Via Roma 1', is_approved: true, role: 'seller' };
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'n1' }) });
    expect(String(meta.title)).toMatch(/non trovat[oa]/i);
    expect(meta.robots).toEqual({ index: false });
    expect(meta.alternates).toEqual({ canonical: null });
  });

  it('controprova: con il nome il negozio resta indicizzabile', async () => {
    mondo.riga = { id: 'n2', store_name: 'Forno Rossi', store_description: null, store_logo: null, store_address: null, is_approved: true, role: 'seller' };
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'n2' }) });
    expect(String(meta.title)).toContain('Forno Rossi');
    expect(meta.alternates).toEqual({ canonical: '/store/n2' });
  });
});
