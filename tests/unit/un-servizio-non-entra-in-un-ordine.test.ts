/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validaRigaDelCarrello, rispostaPerCarrelloNonVendibile, type ProdottoDelCatalogo } from '@/lib/ordini/valida-carrello';
import { buildProductPayload, type ProductFormValues } from '@/lib/products/schema';
import { colonneAmmesse, campiCambiati } from '@/lib/products/salvataggio-tracciato';
import {
  conColonneDelServizio,
  dettagliDelServizio,
  eServizio,
  etichettaDurata,
  leggiServizi,
  mancanoLeColonneDelServizio,
  MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI,
} from '@/lib/products/servizio';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';

vi.mock('@/lib/analytics/events', () => ({ trackAddToCart: vi.fn(), trackRemoveFromCart: vi.fn() }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: vi.fn() }));

/**
 * 27/11/2026 — UN ANNUNCIO PUÒ ESSERE UN SERVIZIO, E UN SERVIZIO NON DIVENTA UN ORDINE.
 *
 * Nicola: «permetti di offrire anche servizi oltre a prodotti ai venditori». Un servizio (il
 * taglio del parrucchiere, l'orlo della sarta) per ora si prenota scrivendo al negozio: non
 * si compra col carrello e non si paga online. Le porte: la cassa sul server (questa prova),
 * il carrello del browser, e il trigger della migrazione 999g
 * (tests/sql/rls/un-servizio-non-entra-in-un-ordine.test.sql).
 *
 * Il sito deve reggere anche prima della 999g: senza la colonna `tipo` ogni annuncio è un prodotto.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-0000000005e1';

function annuncio(p: Partial<ProdottoDelCatalogo> = {}): ProdottoDelCatalogo {
  return { id: 'p-taglio', name: 'Taglio donna', price: 25, seller_id: NEGOZIO, stock: null, status: 'available', has_variants: false, ...p };
}

function valida(prodotto: ProdottoDelCatalogo, sellerId = NEGOZIO) {
  return validaRigaDelCarrello({
    riga: { productId: prodotto.id, quantity: 1 },
    sellerId,
    prodotti: [prodotto],
    varianti: new Map(),
    sconti: new Map(),
  });
}

describe('la cassa (contanti e carta) rifiuta un servizio', () => {
  it('un servizio è scartato, col suo nome e un 400', () => {
    const esito = valida(annuncio({ tipo: 'servizio' }));
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.motivo).toBe('SERVIZIO_NON_IN_CARRELLO');
    expect(esito.scarto.messaggio).toContain('Taglio donna');
    expect(esito.scarto.messaggio).toContain('scrivi al negozio');
    expect(rispostaPerCarrelloNonVendibile(esito.scarto).status).toBe(400);
  });

  it('un prodotto dello stesso negozio passa come prima', () => {
    const esito = valida(annuncio({ id: 'p-shampoo', name: 'Shampoo', price: 9, stock: 5, tipo: 'prodotto' }));
    expect(esito.ok).toBe(true);
  });

  it('prima della 999g la riga non ha `tipo`: è un prodotto e passa', () => {
    expect(valida(annuncio({ id: 'p-shampoo', name: 'Shampoo', stock: 5 })).ok).toBe(true);
  });

  it('un abbonamento di SDG (diventato servizio) tiene il suo messaggio, che viene prima', () => {
    const esito = valida(annuncio({ seller_id: SDG_SELLER_ID, tipo: 'servizio' }), SDG_SELLER_ID);
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.motivo).toBe('ABBONAMENTO_NON_IN_CARRELLO');
  });
});

describe('il modulo del negoziante: il payload di un servizio', () => {
  const values: ProductFormValues = { name: ' Taglio donna ', description: ' Taglio e piega, su appuntamento ', price: 25, stock: 4, category_id: 'c1' };
  const comune = {
    values,
    imageUrls: [],
    attributes: {},
    unit: 'pezzo' as const,
    condition: 'nuovo' as const,
    tags: [],
    expressEnabled: true,
    unlimitedStock: false,
    status: 'available',
  };

  it('un servizio ha scorta null, niente condizione né consegna veloce, e le sue colonne', () => {
    const p = buildProductPayload({ ...comune, servizio: { tipo: 'servizio', durataMinuti: 45, dove: 'in_negozio' } });
    expect(p.stock).toBeNull();
    expect(p.condition).toBeNull();
    expect(p.express_enabled).toBeNull();
    expect(p.tipo).toBe('servizio');
    expect(p.durata_minuti).toBe(45);
    expect(p.dove_servizio).toBe('in_negozio');
  });

  it('durata e «dove» fuori dai valori ammessi partono vuoti, non sbagliati', () => {
    const p = buildProductPayload({ ...comune, servizio: { tipo: 'servizio', durataMinuti: 3, dove: 'sulla_luna' as never } });
    expect(p.durata_minuti).toBeNull();
    expect(p.dove_servizio).toBeNull();
  });

  it('un prodotto qualsiasi non porta le colonne nuove: salva anche prima della 999g', () => {
    const p = buildProductPayload({ ...comune, servizio: { tipo: 'prodotto' } });
    expect('tipo' in p).toBe(false);
    expect('durata_minuti' in p).toBe(false);
    expect('dove_servizio' in p).toBe(false);
    expect(p.stock).toBe(4);
  });

  it('un servizio che torna prodotto lo dice, e svuota durata e «dove»', () => {
    const p = buildProductPayload({ ...comune, servizio: { tipo: 'prodotto', eraServizio: true } });
    expect(p.tipo).toBe('prodotto');
    expect(p.durata_minuti).toBeNull();
    expect(p.dove_servizio).toBeNull();
  });
});

describe('la porta di scrittura della modifica', () => {
  it('lascia passare tipo, durata e «dove» validi', () => {
    expect(colonneAmmesse({ tipo: 'servizio', durata_minuti: 45, dove_servizio: 'a_domicilio' })).toEqual({
      tipo: 'servizio',
      durata_minuti: 45,
      dove_servizio: 'a_domicilio',
    });
  });

  it('butta via i valori che il database rifiuterebbe', () => {
    expect(colonneAmmesse({ tipo: 'biglietto', durata_minuti: 'tanto', dove_servizio: 'ovunque' })).toEqual({});
  });

  it('nel registro finisce il cambio di tipo', () => {
    expect(campiCambiati({}, { tipo: 'servizio' })).toContain('tipo');
  });
});

describe('prima della migrazione 999g', () => {
  it('la lettura col `tipo` ripiega su quella senza, se la colonna non c\'è', async () => {
    const senza = { data: [{ id: 'p1' }], error: null };
    const esito = await conColonneDelServizio(
      async () => ({ data: null, error: { code: '42703', message: 'column products.tipo does not exist' } }),
      async () => senza,
    );
    expect(esito).toBe(senza);
  });

  it('un altro errore non è «schema indietro»: torna com\'è', async () => {
    const errore = { data: null, error: { code: '42501', message: 'permission denied for table products' } };
    const esito = await conColonneDelServizio(async () => errore, async () => ({ data: [], error: null }));
    expect(esito).toBe(errore);
  });

  it('il salvataggio di un servizio senza colonne si riconosce, anche già tradotto per il browser', () => {
    expect(mancanoLeColonneDelServizio({ code: 'PGRST204', message: "Could not find the 'tipo' column of 'products' in the schema cache" })).toBe(true);
    expect(mancanoLeColonneDelServizio(new Error(MESSAGGIO_SERVIZI_NON_ANCORA_ATTIVI))).toBe(true);
    expect(mancanoLeColonneDelServizio({ code: 'PGRST204', message: "Could not find the 'prezzo' column" })).toBe(false);
  });
});

describe('le etichette', () => {
  it('servizio solo con tipo «servizio»', () => {
    expect(eServizio({ tipo: 'servizio' })).toBe(true);
    expect(eServizio({ tipo: 'prodotto' })).toBe(false);
    expect(eServizio({})).toBe(false);
    expect(eServizio(null)).toBe(false);
  });

  it('durata e «dove» in parole', () => {
    expect(etichettaDurata(45)).toBe('45 min');
    expect(etichettaDurata(60)).toBe('1 h');
    expect(etichettaDurata(90)).toBe('1 h 30 min');
    expect(etichettaDurata(null)).toBeNull();
    expect(dettagliDelServizio({ durata_minuti: 45, dove_servizio: 'a_domicilio' })).toBe('45 min · A domicilio');
    expect(dettagliDelServizio({})).toBeNull();
  });
});

describe('il carrello del browser', () => {
  beforeEach(() => localStorage.clear());

  it('non accetta un servizio quando sa che lo è, e non salva il tipo nelle righe', async () => {
    const { addToCart, getCart } = await import('@/lib/cart');
    addToCart({ id: 'p-taglio', name: 'Taglio donna', price: 25, sellerId: NEGOZIO, tipo: 'servizio' });
    expect(getCart()).toHaveLength(0);
    addToCart({ id: 'p-shampoo', name: 'Shampoo', price: 9, sellerId: NEGOZIO, tipo: 'prodotto' });
    expect(getCart()).toHaveLength(1);
    expect('tipo' in getCart()[0]).toBe(false);
  });
});

describe('la lettura dei servizi per le card', () => {
  function clientFinto(risposta: (blocco: string[]) => { data: unknown; error: unknown }) {
    const blocchi: string[][] = [];
    const client = {
      from: () => ({
        select: () => ({
          in: (_c: string, blocco: string[]) => ({
            eq: async () => {
              blocchi.push(blocco);
              return risposta(blocco);
            },
          }),
        }),
      }),
    };
    return { client, blocchi };
  }

  it('chiede a blocchi di cento id, e torna i servizi coi dettagli', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const { client, blocchi } = clientFinto((b) => ({
      data: b.includes('p7') ? [{ id: 'p7', durata_minuti: 45, dove_servizio: 'online' }] : [],
      error: null,
    }));
    const mappa = await leggiServizi(client, ids);
    expect(blocchi.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(mappa.get('p7')).toEqual({ durata_minuti: 45, dove_servizio: 'online' });
    expect(mappa.size).toBe(1);
  });

  it('prima della 999g la colonna non c\'è: nessun servizio, nessun errore', async () => {
    const { client } = clientFinto(() => ({ data: null, error: { code: '42703', message: 'column products.tipo does not exist' } }));
    expect((await leggiServizi(client, ['p1'])).size).toBe(0);
  });
});
