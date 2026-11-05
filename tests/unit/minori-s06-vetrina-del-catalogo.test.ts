import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { salvaProdottoTracciato, DaCompletare } from '@/lib/products/salvataggio-tracciato';

/**
 * S06 — La porta di scrittura del catalogo (PATCH /api/seller/products/:id).
 * 1895: un prodotto già in vendita non può perdere foto, nome o descrizione;
 *       ma un alimento vecchio senza ingredienti (il forno vero) cambia ancora prezzo.
 * 1889: «Attiva» su un prodotto ESAURITO incompleto si ferma come sulla bozza.
 * 1891: spostare un prodotto in vendita fra gli alimentari senza allergeni si ferma.
 * 2635: «Nascondi» passa dalla porta che scrive il registro.
 */
const CATEGORIE = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
];
const FOCACCIA = {
  id: 'p1', seller_id: 's1', status: 'available', name: 'Focaccia genovese',
  description: 'Focaccia con olio extravergine, cotta nel forno a legna.', price: 4, category_id: 'alim',
  images: ['https://x/f.jpg'], attributes: {}, stock: 5,
};

function db(prima: Record<string, unknown>) {
  const scritture: Record<string, unknown>[] = [];
  const tabella = (nome: string) => {
    let valori: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, eq: () => q, in: () => q,
      maybeSingle: async () => ({ data: prima, error: null }),
      update: (v: Record<string, unknown>) => { valori = v; return q; },
      then: (ok: (r: unknown) => unknown) => {
        if (nome === 'categories') return Promise.resolve({ data: CATEGORIE, error: null }).then(ok);
        if (valori) scritture.push(valori);
        return Promise.resolve({ data: [{ id: 'p1' }], error: null }).then(ok);
      },
    });
    return q;
  };
  return { db: { from: tabella } as never, scritture };
}
const tracce: unknown[] = [];
const salva = (prima: Record<string, unknown>, payload: Record<string, unknown>) => {
  const d = db(prima);
  return { esito: salvaProdottoTracciato({ db: d.db, prodottoId: 'p1', attoreId: 's1', origine: 'x', payload, scriviTraccia: (v) => { tracce.push(v); } }), d };
};

describe('1895 — in vetrina non si toglie quello che serve', () => {
  it('togliere tutte le foto a un prodotto in vendita si ferma', async () => {
    await expect(salva(FOCACCIA, { images: [] }).esito).rejects.toBeInstanceOf(DaCompletare);
  });
  it('svuotare la descrizione si ferma', async () => {
    await expect(salva(FOCACCIA, { description: 'Buona' }).esito).rejects.toBeInstanceOf(DaCompletare);
  });
  it('l\'alimento in vetrina senza ingredienti cambia ancora prezzo (il forno al lancio)', async () => {
    const { esito, d } = salva(FOCACCIA, { price: 4.5 });
    await expect(esito).resolves.toBeTruthy();
    expect(d.scritture[0]).toEqual({ price: 4.5 });
  });
  it('un prodotto vecchio già senza foto si salva lo stesso se la modifica non toglie niente', async () => {
    const { esito } = salva({ ...FOCACCIA, images: [] }, { images: [], name: 'Focaccia alta' });
    await expect(esito).resolves.toBeTruthy();
  });
});

describe('1889 — «Attiva» su un esaurito', () => {
  it('un alimento esaurito senza ingredienti non torna in vendita', async () => {
    await expect(salva({ ...FOCACCIA, status: 'sold' }, { status: 'available' }).esito).rejects.toBeInstanceOf(DaCompletare);
  });
});

describe('1891 — spostamento di categoria in vendita', () => {
  it('da Casa agli Alimentari senza allergeni si ferma', async () => {
    await expect(salva({ ...FOCACCIA, category_id: 'casa' }, { category_id: 'alim' }).esito).rejects.toBeInstanceOf(DaCompletare);
  });
});

describe('2635 — «Nascondi» lascia la traccia', () => {
  it('la porta di scrittura accetta lo stato bozza e scrive la traccia', async () => {
    tracce.length = 0;
    const { esito, d } = salva(FOCACCIA, { status: 'draft' });
    await esito;
    expect(d.scritture[0]).toEqual({ status: 'draft' });
    expect(tracce).toHaveLength(1);
  });
  it('le due pagine nascondono da lì, non scrivendo dal browser', () => {
    for (const p of ['app/seller/products/page.tsx', 'app/seller/products/[id]/edit/page.tsx']) {
      const src = readFileSync(p, 'utf8');
      expect(src, p).toContain('nascondiProdottoTracciato(id');
      expect(src, p).not.toContain('nascondiProdotto(supabase');
    }
  });
});
