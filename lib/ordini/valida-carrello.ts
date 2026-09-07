import type { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { discountedUnitCents } from '@/lib/promotions';

/**
 * «QUESTA RIGA DEL CARRELLO SI PUÒ VENDERE?» — LA RISPOSTA IN UN POSTO SOLO.
 *
 * 6/9/2026 — Le due strade che creano un ordine, contanti e carta, facevano a
 * mano la stessa identica verifica del carrello contro il catalogo: il prodotto
 * esiste, è del negozio giusto, è «available», la variante è valida e sua, le
 * scorte bastano, il prezzo è quello scontato della promozione. Normalizzando i
 * due blocchi, 58 righe su 86 erano identiche.
 *
 * Oggi le due copie coincidono. Il costo si paga domani: la prossima regola di
 * vendita — prodotto sospeso dal moderatore, quantità massima per cliente,
 * categoria non consegnabile a domicilio — viene aggiunta a una copia sola, e
 * nasce il caso in cui una cosa si può comprare pagando in contanti e non con la
 * carta. È già successo con i prezzi (il conto ora vive in lib/ordini/prezzi.ts)
 * e con gli avvisi: stessa malattia, stesso rimedio.
 *
 * Qui non c'è nessuna lettura del database: le righe del catalogo arrivano già
 * lette dal chiamante, che sa come leggerle (con la sessione del cliente, in
 * parallelo). Questa funzione decide e basta — quindi si prova per intero senza
 * un database.
 *
 * I MESSAGGI SONO QUELLI CHE LEGGE CHI COMPRA: sono rimasti parola per parola
 * quelli di prima, in italiano, col nome del prodotto dentro.
 */

/** La riga del catalogo che serve per decidere. Le colonne sono quelle già lette dalle due rotte. */
export type ProdottoDelCatalogo = {
  id: string;
  name: string;
  price: number;
  seller_id?: string | null;
  stock?: number | null;
  status?: string | null;
  has_variants?: boolean | null;
};

/** La variante richiesta, come arriva da `product_variants`. */
export type VarianteDelCatalogo = {
  id: string;
  product_id: string;
  label: string;
  stock: number;
};

/** Quello che il browser ha chiesto: prodotto, quantità, eventuale variante. */
export type RigaRichiesta = {
  productId: string;
  quantity: number;
  variantId?: string | null;
};

/** Perché questa riga non si può vendere. Il codice serve a chi chiama, il messaggio a chi compra. */
export type MotivoScarto =
  | 'PRODOTTO_NON_TROVATO'
  | 'VENDITORE_SBAGLIATO'
  | 'PRODOTTO_NON_DISPONIBILE'
  | 'VARIANTE_DA_SCEGLIERE'
  | 'VARIANTE_NON_VALIDA'
  | 'SCORTE_INSUFFICIENTI';

export type CarrelloNonVendibile = {
  motivo: MotivoScarto;
  /** Il testo che arriva a chi sta comprando. */
  messaggio: string;
};

/** La riga approvata, col prezzo unitario già scontato in centesimi. */
export type RigaVendibile = {
  productId: string;
  quantity: number;
  unitCents: number;
  variantId: string | null;
  variantLabel: string | null;
};

/**
 * L'esito porta con sé anche la riga di catalogo trovata: chi chiama ne ha
 * bisogno (la carta ci costruisce il nome e la foto della riga di pagamento) e
 * senza di essa dovrebbe ricercarla, cioè rifare a mano il pezzo che questa
 * funzione esiste per non far rifare. Il tipo resta quello del chiamante.
 */
export type EsitoRiga<P extends ProdottoDelCatalogo = ProdottoDelCatalogo> =
  | { ok: true; riga: RigaVendibile; prodotto: P }
  | { ok: false; scarto: CarrelloNonVendibile };

/**
 * Decide se UNA riga del carrello si può vendere, e a che prezzo.
 *
 * L'ordine dei controlli è quello di prima e conta: prima l'esistenza, poi il
 * proprietario, poi lo stato, poi la variante, poi le scorte. Cambiarlo
 * cambierebbe il messaggio che legge chi compra.
 */
export function validaRigaDelCarrello<P extends ProdottoDelCatalogo>(input: {
  riga: RigaRichiesta;
  /** Il negozio del gruppo a cui la riga appartiene. */
  sellerId: string;
  /** I prodotti già letti dal catalogo (tutti quelli del carrello). */
  prodotti: P[];
  /** Le varianti già lette, per id. */
  varianti: Map<string, VarianteDelCatalogo>;
  /** Lo sconto promozionale attivo per prodotto, in percentuale. */
  sconti: Map<string, number>;
}): EsitoRiga<P> {
  const { riga, sellerId, prodotti, varianti, sconti } = input;

  const p = prodotti.find((x) => x.id === riga.productId);
  if (!p) {
    return { ok: false, scarto: { motivo: 'PRODOTTO_NON_TROVATO', messaggio: `Prodotto ${riga.productId} non trovato` } };
  }
  if (p.seller_id !== sellerId) {
    return {
      ok: false,
      scarto: { motivo: 'VENDITORE_SBAGLIATO', messaggio: `Prodotto ${p.name} non appartiene al venditore indicato.` },
    };
  }
  // Nota: l'approvazione del venditore è già garantita dall'RLS (migration 023:
  // solo prodotti `available` di venditori approvati sono leggibili) — un
  // prodotto non leggibile cade sul controllo qui sopra. `products` NON ha una
  // colonna is_approved: si controlla solo lo status.
  if (p.status !== 'available') {
    return { ok: false, scarto: { motivo: 'PRODOTTO_NON_DISPONIBILE', messaggio: `Prodotto ${p.name} non disponibile.` } };
  }

  // Varianti: un prodotto con varianti richiede una variante valida, e lo stock
  // che conta è quello della variante, non quello del prodotto.
  let variantId: string | null = null;
  let variantLabel: string | null = null;
  if (Boolean(p.has_variants)) {
    if (!riga.variantId) {
      return {
        ok: false,
        scarto: { motivo: 'VARIANTE_DA_SCEGLIERE', messaggio: `Scegli un'opzione (es. taglia/colore) per ${p.name}.` },
      };
    }
    const v = varianti.get(riga.variantId);
    if (!v || v.product_id !== p.id) {
      return { ok: false, scarto: { motivo: 'VARIANTE_NON_VALIDA', messaggio: `Variante non valida per ${p.name}.` } };
    }
    if (v.stock < riga.quantity) {
      return {
        ok: false,
        scarto: {
          motivo: 'SCORTE_INSUFFICIENTI',
          messaggio: `Disponibilità insufficiente per ${p.name} (${v.label}): ${v.stock} disponibili.`,
        },
      };
    }
    variantId = v.id;
    variantLabel = v.label;
  } else if (typeof p.stock === 'number' && p.stock < riga.quantity) {
    return {
      ok: false,
      scarto: { motivo: 'SCORTE_INSUFFICIENTI', messaggio: `Stock insufficiente per ${p.name} (${p.stock} disponibili).` },
    };
  }

  return {
    ok: true,
    prodotto: p,
    riga: {
      productId: p.id,
      quantity: riga.quantity,
      unitCents: discountedUnitCents(p.price, sconti.get(p.id) ?? 0),
      variantId,
      variantLabel,
    },
  };
}

/**
 * La risposta HTTP per una riga che non si può vendere — la stessa sulle due
 * rotte, coi codici di prima: «non trovato» è 404, la merce finita è un
 * conflitto (409), tutto il resto è una richiesta non valida (400).
 *
 * Sta qui e non nelle rotte perché era proprio la mappa fra motivo e codice a
 * poter divergere: la carta poteva rispondere 400 dove i contanti rispondevano
 * 409, e il browser mostra messaggi diversi sui due.
 */
export function rispostaPerCarrelloNonVendibile(scarto: CarrelloNonVendibile): NextResponse {
  if (scarto.motivo === 'PRODOTTO_NON_TROVATO') return ApiErrors.notFound(scarto.messaggio);
  if (scarto.motivo === 'SCORTE_INSUFFICIENTI') return ApiErrors.conflict(scarto.messaggio);
  return ApiErrors.invalidRequest(scarto.messaggio);
}
