import { describe, it, expect } from 'vitest';
import {
  salvaProdottoTracciato,
  type ClientDelCatalogo,
  type VoceDiTraccia,
} from '@/lib/products/salvataggio-tracciato';

/**
 * 27/10/2026 — «ATTIVA» DALL'ELENCO METTEVA IN VENDITA UNA FOCACCIA SENZA
 * ALLERGENI.
 *
 * Il modulo del prodotto lascia salvare una bozza senza allergeni e senza
 * ingredienti: blocca solo la pubblicazione. Ma nell'elenco «I miei prodotti»
 * ogni bozza ha il pulsante «Attiva», che manda `{ status: 'available' }` a
 * PATCH /api/seller/products/:id. Quella porta non guardava nessun campo
 * obbligatorio: la focaccia andava in vendita senza dire a chi e' allergico al
 * sesamo o al latte cosa contiene (Reg. UE 1169/2011, vendita a distanza).
 *
 * E quando il guardiano del database (migrazione 126) rifiuta con il suo
 * messaggio chiaro, la rotta lo buttava via e scriveva «Riprova»: riprovare
 * dava sempre lo stesso errore.
 *
 * La prova ESEGUE la porta di scrittura (la rotta e' solo il filo che la chiama)
 * con un database finto: non cerca parole nel sorgente.
 */

const PRODOTTO = 'p-focaccia';
const NEGOZIANTE = 'forno-1';

const CATEGORIE = [
  { id: 'cat-alimentari', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'cat-pane', name: 'Pane', slug: 'pane', parent_id: 'cat-alimentari' },
  { id: 'cat-casa', name: 'Casa', slug: 'casa', parent_id: null },
];

const bozzaFocaccia = {
  id: PRODOTTO,
  seller_id: NEGOZIANTE,
  name: 'Focaccia',
  description: 'Focaccia genovese con olio extravergine.',
  price: '3.50',
  compare_at_price: null,
  unit: 'pezzo',
  condition: 'nuovo',
  stock: 10,
  category_id: 'cat-pane',
  images: ['https://esempio/focaccia.jpg'],
  attributes: {} as Record<string, unknown>,
  tags: [],
  express_enabled: true,
  status: 'draft',
};

type Finto = {
  db: ClientDelCatalogo;
  riga: Record<string, unknown>;
  scritture: Record<string, unknown>[];
  letturaCategorie: number;
};

/** Un catalogo finto: una riga di prodotto, l'albero delle categorie, e un errore di scrittura a scelta. */
function catalogoFinto(
  riga: Record<string, unknown>,
  erroreScrittura: { code?: string; message?: string } | null = null,
): Finto {
  const stato: Finto = { riga: { ...riga }, scritture: [], letturaCategorie: 0, db: null as unknown as ClientDelCatalogo };
  stato.db = {
    from(tabella: string) {
      if (tabella === 'categories') {
        return {
          select() {
            stato.letturaCategorie += 1;
            return {
              then(risolvi: (r: unknown) => unknown, rifiuta?: (e: unknown) => unknown) {
                return Promise.resolve({ data: CATEGORIE.map((c) => ({ ...c })), error: null }).then(risolvi, rifiuta);
              },
            };
          },
        };
      }
      if (tabella !== 'products') throw new Error(`tabella inattesa: ${tabella}`);
      return {
        select() {
          const filtri: Record<string, string> = {};
          const catena = {
            eq(c: string, v: string) { filtri[c] = v; return catena; },
            maybeSingle() {
              const ok = Object.entries(filtri).every(([c, v]) => stato.riga[c] === v);
              return Promise.resolve({ data: ok ? { ...stato.riga } : null, error: null });
            },
          };
          return catena;
        },
        update(valori: Record<string, unknown>) {
          const filtri: Record<string, string> = {};
          const catena = {
            eq(c: string, v: string) { filtri[c] = v; return catena; },
            then(risolvi: (r: unknown) => unknown, rifiuta?: (e: unknown) => unknown) {
              if (erroreScrittura) return Promise.resolve({ error: erroreScrittura }).then(risolvi, rifiuta);
              const ok = Object.entries(filtri).every(([c, v]) => stato.riga[c] === v);
              if (ok) {
                Object.assign(stato.riga, valori);
                stato.scritture.push({ ...valori });
              }
              return Promise.resolve({ error: null }).then(risolvi, rifiuta);
            },
          };
          return catena;
        },
      };
    },
  } as unknown as ClientDelCatalogo;
  return stato;
}

function salva(catalogo: Finto, payload: Record<string, unknown>, voci: VoceDiTraccia[] = []) {
  return salvaProdottoTracciato({
    db: catalogo.db,
    prodottoId: PRODOTTO,
    attoreId: NEGOZIANTE,
    payload,
    origine: 'venditore-elenco',
    scriviTraccia: (v) => { voci.push(v); },
  });
}

describe('la porta di scrittura non mette in vendita una scheda incompleta', () => {
  it('«Attiva» su una bozza di focaccia senza allergeni e ingredienti: rifiutata, con cosa manca, e niente scritto', async () => {
    const catalogo = catalogoFinto(bozzaFocaccia);
    const voci: VoceDiTraccia[] = [];

    const esito = salva(catalogo, { status: 'available' }, voci);

    await expect(esito, 'la bozza senza allergeni e andata in vendita').rejects.toThrow(/Allergeni/);
    await expect(salva(catalogo, { status: 'available' })).rejects.toThrow(/Ingredienti/);
    expect(catalogo.riga.status, 'la focaccia e in vetrina').toBe('draft');
    expect(catalogo.scritture, 'qualcosa e stato scritto sul catalogo').toHaveLength(0);
    expect(voci, 'una modifica mai avvenuta e finita nel registro').toHaveLength(0);
  });

  it('la stessa bozza con allergeni e ingredienti si attiva (il pulsante non e rotto)', async () => {
    const catalogo = catalogoFinto({
      ...bozzaFocaccia,
      attributes: { allergeni: 'Glutine', ingredienti: 'Farina di grano, acqua, olio, sale, lievito' },
    });

    await salva(catalogo, { status: 'available' });

    expect(catalogo.riga.status).toBe('available');
  });

  it('il modulo che aggiunge la prima foto e pubblica nello stesso salvataggio passa', async () => {
    const catalogo = catalogoFinto({
      ...bozzaFocaccia,
      images: [],
      attributes: { allergeni: 'Glutine', ingredienti: 'Farina, acqua, sale' },
    });

    await salva(catalogo, { images: ['https://esempio/nuova.jpg'], status: 'available' });

    expect(catalogo.riga.status).toBe('available');
  });

  it('un prezzo cambiato su un prodotto gia in vendita non fa controlli (lavoro normale)', async () => {
    const catalogo = catalogoFinto({ ...bozzaFocaccia, status: 'available' });

    await salva(catalogo, { price: 4 });

    expect(catalogo.riga.price).toBe(4);
    expect(catalogo.letturaCategorie, 'ha riletto le categorie per un prezzo').toBe(0);
  });
});
