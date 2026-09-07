import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  rispostaPerCarrelloNonVendibile,
  validaRigaDelCarrello,
  type ProdottoDelCatalogo,
  type VarianteDelCatalogo,
} from '@/lib/ordini/valida-carrello';

/**
 * 6/9/2026 — LA STESSA VERIFICA DEL CARRELLO ERA SCRITTA DUE VOLTE.
 *
 * Le due strade che creano un ordine — contanti (app/api/orders/cod) e carta
 * (app/api/stripe/checkout) — controllavano a mano, ognuna per conto suo, che il
 * prodotto esista, sia del negozio giusto, sia disponibile, che la variante sia
 * valida e sua, che le scorte bastino e che il prezzo sia quello scontato della
 * promozione. Trenta righe uguali, in due file da settecento.
 *
 * Non era un difetto che si vedeva ieri: le due copie coincidevano. Era il
 * difetto di domani. La prossima regola di vendita — un prodotto sospeso dal
 * moderatore, un tetto di pezzi per cliente, una categoria che non si consegna a
 * casa — sarebbe finita in una copia sola, e sarebbe nato il caso in cui la
 * stessa cosa si compra pagando in contanti e non con la carta. È già successo
 * due volte in questo progetto: coi prezzi e con gli avvisi.
 *
 * Questa prova esercita la regola condivisa in tutti i suoi casi limite, e
 * controlla che le due rotte la chiamino invece di riscriverla.
 *
 * ⚪ Non apre il database: le righe del catalogo arrivano già lette, come nella
 * realtà. Che la lettura sia giusta lo provano le prove delle due rotte.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const ALTRO_NEGOZIO = 'bbbbbbbb-0000-0000-0000-000000000002';

function pane(p: Partial<ProdottoDelCatalogo> = {}): ProdottoDelCatalogo {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Pane',
    price: 5,
    seller_id: NEGOZIO,
    stock: 10,
    status: 'available',
    has_variants: false,
    ...p,
  };
}

function varianti(...righe: VarianteDelCatalogo[]) {
  return new Map(righe.map((v) => [v.id, v]));
}

function valida(input: {
  prodotti?: ProdottoDelCatalogo[];
  riga?: { productId: string; quantity: number; variantId?: string | null };
  sellerId?: string;
  varianti?: Map<string, VarianteDelCatalogo>;
  sconti?: Map<string, number>;
}) {
  return validaRigaDelCarrello({
    prodotti: input.prodotti ?? [pane()],
    riga: input.riga ?? { productId: pane().id, quantity: 1 },
    sellerId: input.sellerId ?? NEGOZIO,
    varianti: input.varianti ?? varianti(),
    sconti: input.sconti ?? new Map(),
  });
}

describe('la regola che dice se una riga del carrello si può vendere', () => {
  it('passa il prodotto disponibile, col prezzo in centesimi', () => {
    const esito = valida({ riga: { productId: pane().id, quantity: 3 } });
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.riga.unitCents, 'il prezzo unitario non è quello del catalogo').toBe(500);
    expect(esito.riga.quantity).toBe(3);
    expect(esito.riga.variantId).toBeNull();
    expect(esito.prodotto.name).toBe('Pane');
  });

  it('applica lo sconto della promozione, non il prezzo pieno', () => {
    const esito = valida({ sconti: new Map([[pane().id, 20]]) });
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.riga.unitCents, 'il cliente pagherebbe il prezzo pieno mentre il badge dice -20%').toBe(400);
  });

  it('rifiuta un prodotto che non esiste', () => {
    const esito = valida({ riga: { productId: 'sconosciuto', quantity: 1 } });
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.motivo).toBe('PRODOTTO_NON_TROVATO');
  });

  it('rifiuta un prodotto attribuito al negozio sbagliato', () => {
    const esito = valida({ sellerId: ALTRO_NEGOZIO });
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.motivo).toBe('VENDITORE_SBAGLIATO');
    expect(esito.scarto.messaggio).toContain('Pane');
  });

  it('rifiuta un prodotto non più in vendita', () => {
    const esito = valida({ prodotti: [pane({ status: 'draft' })] });
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.motivo).toBe('PRODOTTO_NON_DISPONIBILE');
  });

  it('rifiuta le scorte che non bastano', () => {
    const esito = valida({ prodotti: [pane({ stock: 2 })], riga: { productId: pane().id, quantity: 3 } });
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.motivo).toBe('SCORTE_INSUFFICIENTI');
    expect(esito.scarto.messaggio, 'chi compra deve leggere quanti pezzi restano').toContain('2 disponibili');
  });

  it('lascia passare la quantità pari alle scorte: l ultimo pezzo si vende', () => {
    const esito = valida({ prodotti: [pane({ stock: 3 })], riga: { productId: pane().id, quantity: 3 } });
    expect(esito.ok, 'l ultimo pezzo in magazzino risultava invendibile').toBe(true);
  });

  it('con le scorte non dichiarate (null) non blocca la vendita', () => {
    const esito = valida({ prodotti: [pane({ stock: null })], riga: { productId: pane().id, quantity: 99 } });
    expect(esito.ok).toBe(true);
  });

  describe('quando il prodotto ha le varianti', () => {
    const conVarianti = pane({ has_variants: true, stock: 0 });
    const taglia = { id: 'v1', product_id: conVarianti.id, label: 'Grande', stock: 4 };

    it('chiede di sceglierne una', () => {
      const esito = valida({ prodotti: [conVarianti], varianti: varianti(taglia) });
      expect(esito.ok).toBe(false);
      if (esito.ok) return;
      expect(esito.scarto.motivo).toBe('VARIANTE_DA_SCEGLIERE');
    });

    it('rifiuta la variante di un altro prodotto', () => {
      const estranea = { id: 'v9', product_id: 'un-altro-prodotto', label: 'Piccola', stock: 9 };
      const esito = valida({
        prodotti: [conVarianti],
        varianti: varianti(estranea),
        riga: { productId: conVarianti.id, quantity: 1, variantId: 'v9' },
      });
      expect(esito.ok).toBe(false);
      if (esito.ok) return;
      expect(esito.scarto.motivo).toBe('VARIANTE_NON_VALIDA');
    });

    it('guarda le scorte della variante, non quelle del prodotto', () => {
      const troppe = valida({
        prodotti: [conVarianti],
        varianti: varianti(taglia),
        riga: { productId: conVarianti.id, quantity: 5, variantId: 'v1' },
      });
      expect(troppe.ok, 'ha venduto 5 pezzi di una variante che ne ha 4').toBe(false);

      const giuste = valida({
        prodotti: [conVarianti],
        varianti: varianti(taglia),
        riga: { productId: conVarianti.id, quantity: 4, variantId: 'v1' },
      });
      expect(giuste.ok, 'il prodotto ha stock 0 ma la variante 4: la vendita deve passare').toBe(true);
      if (!giuste.ok) return;
      expect(giuste.riga.variantId).toBe('v1');
      expect(giuste.riga.variantLabel).toBe('Grande');
    });
  });
});

describe('la risposta che arriva a chi compra', () => {
  it('«non trovato» è 404, la merce finita è 409, il resto è 400', async () => {
    const casi = [
      { motivo: 'PRODOTTO_NON_TROVATO', atteso: 404 },
      { motivo: 'SCORTE_INSUFFICIENTI', atteso: 409 },
      { motivo: 'VENDITORE_SBAGLIATO', atteso: 400 },
      { motivo: 'PRODOTTO_NON_DISPONIBILE', atteso: 400 },
      { motivo: 'VARIANTE_DA_SCEGLIERE', atteso: 400 },
      { motivo: 'VARIANTE_NON_VALIDA', atteso: 400 },
    ] as const;

    for (const caso of casi) {
      const res = rispostaPerCarrelloNonVendibile({ motivo: caso.motivo, messaggio: 'Pane non disponibile.' });
      expect(res.status, `${caso.motivo} risponde col codice sbagliato`).toBe(caso.atteso);
      const corpo = (await res.json()) as { ok: boolean; error: { message: string } };
      expect(corpo.ok, 'la risposta non è nella forma del progetto').toBe(false);
      expect(corpo.error.message, 'il motivo non arriva a chi compra').toBe('Pane non disponibile.');
    }
  });
});

describe('le due rotte dei soldi', () => {
  const rotte = ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts'];

  it('chiamano la regola condivisa invece di riscriversela in casa', () => {
    for (const rotta of rotte) {
      const sorgente = readFileSync(path.join(process.cwd(), rotta), 'utf8');
      expect(sorgente, `${rotta} non usa la regola condivisa`).toContain('validaRigaDelCarrello');
      expect(
        sorgente,
        `${rotta} ha di nuovo la sua copia del controllo sulle varianti: quando cambia una regola, cambia solo qui`,
      ).not.toContain('Variante non valida per');
    }
  });
});
