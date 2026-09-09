import { describe, it, expect } from 'vitest';
import {
  salvaProdottoTracciato,
  colonneAmmesse,
  colonneDelPatchAi,
  campiCambiati,
  ProdottoNonTuo,
  type ClientDelCatalogo,
  type VoceDiTraccia,
} from '@/lib/products/salvataggio-tracciato';

/**
 * 8/9/2026 — LA TRACCIA DI CHI HA CAMBIATO IL PREZZO ESISTEVA SU UNA STRADA
 * SOLA.
 *
 * Le modifiche che passano dal server — «applica» nella chat catalogo, il
 * lavoro in blocco — finivano nel registro delle azioni con dentro il valore
 * che il campo aveva prima. Le altre no: il modulo del prodotto scriveva
 * diritto sul catalogo dal browser, e cosi' anche la modifica veloce di prezzo
 * e scorta nell'elenco. Due porte che spostano un prezzo senza lasciare niente
 * di scritto.
 *
 * Il caso vero che questa prova difende: il negoziante ha un prodotto da 20 €,
 * l'assistente gli propone 2 € (uno zero perso), lui accetta e salva. Il prezzo
 * sbagliato entra in vetrina — e senza registro nessuno sa piu' ne' quando e'
 * successo, ne' che quel numero l'aveva proposto la macchina, ne' a quanto
 * tornare.
 *
 * La prova ESEGUE la porta di scrittura con un database finto e un registro
 * finto: non cerca parole nel sorgente. Se domani la traccia sparisce, qui
 * diventa rosso.
 */

const PRODOTTO = 'p-1';
const NEGOZIANTE = 'venditore-1';

type Finto = {
  db: ClientDelCatalogo;
  riga: Record<string, unknown>;
  scritture: { valori: Record<string, unknown>; filtri: Record<string, string> }[];
};

/** Un catalogo finto con una riga sola, che rispetta i filtri `.eq()`. */
function catalogoFinto(riga: Record<string, unknown>): Finto {
  const stato: Finto = {
    riga: { ...riga },
    scritture: [],
    db: null as unknown as ClientDelCatalogo,
  };

  stato.db = {
    from(tabella: string) {
      if (tabella !== 'products') throw new Error(`tabella inattesa: ${tabella}`);
      return {
        select() {
          const filtri: Record<string, string> = {};
          const catena = {
            eq(colonna: string, valore: string) {
              filtri[colonna] = valore;
              return catena;
            },
            maybeSingle() {
              const combacia = Object.entries(filtri).every(([c, v]) => stato.riga[c] === v);
              return Promise.resolve({ data: combacia ? { ...stato.riga } : null, error: null });
            },
          };
          return catena;
        },
        update(valori: Record<string, unknown>) {
          const filtri: Record<string, string> = {};
          const catena = {
            eq(colonna: string, valore: string) {
              filtri[colonna] = valore;
              return catena;
            },
            then(risolvi: (r: { error: null }) => unknown, rifiuta?: (e: unknown) => unknown) {
              const combacia = Object.entries(filtri).every(([c, v]) => stato.riga[c] === v);
              if (combacia) {
                Object.assign(stato.riga, valori);
                stato.scritture.push({ valori: { ...valori }, filtri: { ...filtri } });
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

/** Il registro finto: raccoglie quello che `writeAudit` riceverebbe davvero. */
function registroFinto() {
  const voci: VoceDiTraccia[] = [];
  return { voci, scrivi: (v: VoceDiTraccia) => { voci.push(v); } };
}

const rigaBase = {
  id: PRODOTTO,
  seller_id: NEGOZIANTE,
  name: 'Coppa piacentina DOP',
  description: 'Stagionata sei mesi in cantina.',
  // Il database restituisce i numeri con la virgola come stringa: e' la forma
  // vera, non una comodita' della prova.
  price: '20.00',
  compare_at_price: null,
  unit: 'pezzo',
  condition: 'nuovo',
  stock: 4,
  category_id: 'cat-gastronomia',
  images: ['https://esempio/1.jpg'],
  attributes: { allergeni: 'nessuno' },
  tags: ['salumi'],
  express_enabled: true,
  status: 'available',
};

describe('la traccia della modifica al prodotto', () => {
  it('lo zero perso: da 20 € a 2 € resta scritto chi, quando e quanto era prima', async () => {
    const catalogo = catalogoFinto(rigaBase);
    const registro = registroFinto();

    const esito = await salvaProdottoTracciato({
      db: catalogo.db,
      prodottoId: PRODOTTO,
      attoreId: NEGOZIANTE,
      payload: { ...rigaBase, price: 2 },
      origine: 'venditore-modulo',
      scriviTraccia: registro.scrivi,
    });

    // Il salvataggio e' avvenuto davvero.
    expect(catalogo.riga.price, 'il prezzo non e stato scritto').toBe(2);

    // E ha lasciato una riga nel registro.
    expect(
      registro.voci.length,
      'la modifica dal browser non lascia nessuna traccia: il prezzo si muove e nessuno sa cosa cera prima',
    ).toBe(1);
    const voce = registro.voci[0];
    expect(voce.action).toBe('product.update');
    expect(voce.targetTable).toBe('products');
    expect(voce.targetId).toBe(PRODOTTO);
    expect(voce.actorId, 'senza attore la traccia non dice CHI').toBe(NEGOZIANTE);
    expect(voce.metadata.campi).toEqual(['price']);
    expect(voce.metadata.prima.price, 'il valore di prima e la sola cosa irrecuperabile: deve esserci').toBe('20.00');
    expect(voce.metadata.dopo.price).toBe(2);
    expect(voce.metadata.origine).toBe('venditore-modulo');
    expect(esito.campi).toEqual(['price']);
    expect(esito.tracciato).toBe(true);
  });

  it('dice se quel prezzo lo ha proposto lassistente o lo ha battuto il negoziante', async () => {
    const catalogo = catalogoFinto(rigaBase);
    const registro = registroFinto();

    await salvaProdottoTracciato({
      db: catalogo.db,
      prodottoId: PRODOTTO,
      attoreId: NEGOZIANTE,
      payload: { ...rigaBase, price: 22, description: 'Riscritta a mano dal negoziante.' },
      origine: 'venditore-modulo',
      // L'assistente aveva proposto prezzo e nome; il nome pero' e' rimasto
      // quello di prima, quindi non e' una modifica sua.
      campiDallAi: ['price', 'name'],
      scriviTraccia: registro.scrivi,
    });

    const voce = registro.voci[0];
    expect(voce.metadata.campi.sort()).toEqual(['description', 'price']);
    expect(
      voce.metadata.daAi,
      'il registro non distingue il numero proposto dalla macchina da quello battuto a mano',
    ).toEqual(['price']);
  });

  it('salvare senza cambiare niente non sporca il registro', async () => {
    const catalogo = catalogoFinto(rigaBase);
    const registro = registroFinto();

    // Stesso prezzo, ma il modulo lo manda come numero e il database lo tiene
    // come stringa: un confronto secco griderebbe «prezzo cambiato» a ogni giro.
    const esito = await salvaProdottoTracciato({
      db: catalogo.db,
      prodottoId: PRODOTTO,
      attoreId: NEGOZIANTE,
      payload: { ...rigaBase, price: 20 },
      origine: 'venditore-modulo',
      scriviTraccia: registro.scrivi,
    });

    expect(registro.voci.length, 'il registro si riempie di modifiche mai fatte').toBe(0);
    expect(esito.campi).toEqual([]);
    expect(catalogo.scritture.length, 'il salvataggio deve avvenire comunque: non e questa funzione a decidere se scrivere').toBe(1);
  });

  it('il prodotto di un altro negozio non si tocca e non si registra', async () => {
    const catalogo = catalogoFinto({ ...rigaBase, seller_id: 'un-altro-negozio' });
    const registro = registroFinto();

    await expect(
      salvaProdottoTracciato({
        db: catalogo.db,
        prodottoId: PRODOTTO,
        attoreId: NEGOZIANTE,
        payload: { price: 1 },
        origine: 'venditore-modulo',
        scriviTraccia: registro.scrivi,
      }),
    ).rejects.toBeInstanceOf(ProdottoNonTuo);

    expect(catalogo.riga.price, 'ha scritto sul prodotto di un altro').toBe('20.00');
    expect(registro.voci.length).toBe(0);
  });

  it('la scrittura resta legata al negozio di chi salva', async () => {
    const catalogo = catalogoFinto(rigaBase);
    const registro = registroFinto();

    await salvaProdottoTracciato({
      db: catalogo.db,
      prodottoId: PRODOTTO,
      attoreId: NEGOZIANTE,
      payload: { price: 21 },
      origine: 'venditore-modulo',
      scriviTraccia: registro.scrivi,
    });

    expect(catalogo.scritture[0].filtri).toEqual({ id: PRODOTTO, seller_id: NEGOZIANTE });
  });

  it('il corpo della richiesta non puo regalarsi il prodotto di un altro', async () => {
    const catalogo = catalogoFinto(rigaBase);
    const registro = registroFinto();

    await salvaProdottoTracciato({
      db: catalogo.db,
      prodottoId: PRODOTTO,
      attoreId: NEGOZIANTE,
      payload: { price: 21, seller_id: 'ladro', id: 'altro-prodotto', created_at: 'ieri' },
      origine: 'venditore-modulo',
      scriviTraccia: registro.scrivi,
    });

    expect(catalogo.scritture[0].valori, 'una colonna fuori lista e arrivata al catalogo').toEqual({ price: 21 });
    expect(catalogo.riga.seller_id).toBe(NEGOZIANTE);
  });

  it('se il registro cade il negoziante non perde il lavoro', async () => {
    const catalogo = catalogoFinto(rigaBase);

    const esito = await salvaProdottoTracciato({
      db: catalogo.db,
      prodottoId: PRODOTTO,
      attoreId: NEGOZIANTE,
      payload: { price: 18 },
      origine: 'venditore-modulo',
      scriviTraccia: () => { throw new Error('registro non raggiungibile'); },
    });

    expect(catalogo.riga.price, 'un guasto del registro ha annullato il salvataggio').toBe(18);
    expect(esito.tracciato, 'il guasto del registro va detto, non nascosto').toBe(false);
  });
});

describe('i pezzi che decidono cosa finisce nella traccia', () => {
  it('riconosce come cambiati solo i campi diversi davvero', () => {
    const cambiati = campiCambiati(
      { price: '20.00', name: 'Coppa', tags: ['salumi'], stock: null, express_enabled: true },
      { price: 20, name: 'Coppa piacentina', tags: ['salumi', 'dop'], stock: null, express_enabled: true },
    );
    expect(cambiati.sort()).toEqual(['name', 'tags']);
  });

  it('traduce i nomi del suggerimento nei nomi delle colonne', () => {
    // `category_slug` e `subcategory_name` scrivono la stessa colonna, e
    // `unlimited_stock` finisce nella scorta: senza questa traduzione il
    // registro direbbe che l'AI ha toccato campi che non esistono.
    expect(colonneDelPatchAi({ price: 9, category_slug: 'gastronomia', subcategory_name: 'Salumi' }))
      .toEqual(['price', 'category_id']);
    expect(colonneDelPatchAi({ unlimited_stock: true })).toEqual(['stock']);
    expect(colonneDelPatchAi({ price: undefined, name: 'x' }), 'un campo scartato non e dell AI').toEqual(['name']);
  });

  it('la lista delle colonne ammesse non lascia passare le colonne di sistema', () => {
    expect(colonneAmmesse({ price: 3, seller_id: 'x', id: 'y', qualcosa: 1 })).toEqual({ price: 3 });
    expect(colonneAmmesse(null)).toEqual({});
  });
});
