/**
 * @vitest-environment jsdom
 */
/**
 * R15-007 — In home ogni sezione chiedeva di nuovo alla vetrina lo stesso negozio.
 *
 * Le domande in volo per lo stesso negozio si univano solo se la select era scritta uguale, lettera
 * per lettera. Ma Drop del giorno e Ordina di nuovo chiedono «id, store_name» e le fasce
 * «id, store_name, is_approved»: alla vetrina vanno le stesse colonne (is_approved si aggiunge a
 * tutte), eppure partivano due domande per Pane Quotidiano. Ora conta l'insieme delle colonne.
 */
import { describe, it, expect } from 'vitest';
import { conNegozioApprovato, fetchSellerPublicMap, COLONNE_NEGOZIO_IN_VETRINA } from '@/lib/queries/seller-public-profiles';

type Riga = { id: string; store_name: string; store_logo: string | null; is_approved: boolean };

function vetrina(righe: Riga[]) {
  const domande: Array<{ colonne: string; ids: string[] }> = [];
  const client = {
    from: () => ({
      select: (colonne: string) => ({
        in: (_c: string, ids: string[]) => {
          domande.push({ colonne, ids: [...ids] });
          const chieste = colonne.split(',').map((c) => c.trim());
          const data = righe
            .filter((r) => ids.includes(r.id))
            .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => chieste.includes(k))));
          return Promise.resolve({ data, error: null });
        },
      }),
    }),
  };
  return { client, domande };
}

const PANE: Riga = { id: 'pane', store_name: 'Pane Quotidiano', store_logo: 'pane.png', is_approved: true };
const LATTE: Riga = { id: 'latte', store_name: 'Latteria', store_logo: null, is_approved: true };

describe('R15-007 · la vetrina chiesta una volta per negozio, anche con la select scritta diversa', () => {
  it('Drop del giorno («id, store_name») e una fascia (colonne della vetrina) insieme: una domanda sola', async () => {
    const { client, domande } = vetrina([PANE, LATTE]);
    const prodotto = { id: 'p1', seller_id: 'pane' };
    const fascia = [{ id: 'p2', seller_id: 'pane' }, { id: 'p3', seller_id: 'latte' }];
    const [drop, tendenze] = await Promise.all([
      conNegozioApprovato(client, [prodotto], 'id, store_name'),
      conNegozioApprovato(client, fascia, COLONNE_NEGOZIO_IN_VETRINA),
    ]);
    expect(drop.map((p) => p.profiles.store_name)).toEqual(['Pane Quotidiano']);
    expect(tendenze.map((p) => p.profiles.store_name)).toEqual(['Pane Quotidiano', 'Latteria']);
    expect(domande.map((d) => d.ids), 'la stessa riga di Pane Quotidiano chiesta due volte').toEqual([['pane'], ['latte']]);
  });

  it('le stesse colonne in un altro ordine sono la stessa domanda', async () => {
    const { client, domande } = vetrina([PANE]);
    const [a, b] = await Promise.all([
      fetchSellerPublicMap(client, ['pane'], 'id, store_name, store_logo'),
      fetchSellerPublicMap(client, ['pane'], 'store_logo,store_name, id'),
    ]);
    expect(a.get('pane')?.store_logo).toBe('pane.png');
    expect(b.get('pane')?.store_logo).toBe('pane.png');
    expect(domande).toHaveLength(1);
  });

  it('colonne davvero diverse restano due domande: a chi chiede il logo il logo arriva', async () => {
    const { client, domande } = vetrina([PANE]);
    const [senza, con] = await Promise.all([
      fetchSellerPublicMap(client, ['pane'], 'id, store_name'),
      fetchSellerPublicMap(client, ['pane'], 'id, store_name, store_logo'),
    ]);
    expect(senza.get('pane')?.store_name).toBe('Pane Quotidiano');
    expect(con.get('pane')?.store_logo).toBe('pane.png');
    expect(domande).toHaveLength(2);
  });
});
