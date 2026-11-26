// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validaRigaDelCarrello, rispostaPerCarrelloNonVendibile, type ProdottoDelCatalogo } from '@/lib/ordini/valida-carrello';
import { SDG_SELLER_ID, eDiSdg, doveSiAttivaLAbbonamento } from '@/lib/products/sdgSeller';
import { MYCITY_SELLER_ID } from '@/lib/products/mycitySeller';
import { PRODOTTI_SDG, ID_PRODOTTO_SDG } from '@/lib/agenzia/prodotti-sdg';
import { FASCE, ABBONAMENTI, FRASE_PARTNER } from '@/lib/agenzia/preventivo';

/**
 * 24/11/2026 — SDG AGENZIA NEL MARKETPLACE, COI TRE ABBONAMENTI COME PRODOTTI.
 *
 * Nicola: «metti i tre abbonamenti come prodotti nella vetrina di SDG». Gli abbonamenti non si
 * comprano col carrello: la regola unica del carrello (carta e contanti) li rifiuta, il carrello del
 * browser non li prende, la pagina prodotto porta al preventivo. La prova che percorre la cassa in
 * contanti fino in fondo è sdg-un-abbonamento-non-diventa-un-ordine-in-contanti.test.ts; quella del
 * database è tests/sql/rls/sdg-un-abbonamento-non-entra-in-un-ordine.test.sql.
 */

const RADICE = path.resolve(__dirname, '../..');
const MIGRAZIONE = readFileSync(path.join(RADICE, 'migrations/707_sdg_agenzia_nel_marketplace.sql'), 'utf8');
const MIGRAZIONE_710 = readFileSync(path.join(RADICE, 'migrations/710_gli_abbonamenti_di_sdg_dicono_i_servizi_a_tre.sql'), 'utf8');
const MIGRAZIONE_711 = readFileSync(path.join(RADICE, 'migrations/711_l_analisi_del_business_e_la_bozza_del_sito.sql'), 'utf8');
// 26/11/2026 — Il rapporto dell'imprenditore cambia il testo dell'analisi: l'ultima che scrive le descrizioni è la 863.
const MIGRAZIONE_863 = readFileSync(path.join(RADICE, 'migrations/863_gli_abbonamenti_di_sdg_dicono_il_rapporto_dell_imprenditore.sql'), 'utf8');

const abbonamento = (p: Partial<ProdottoDelCatalogo> = {}): ProdottoDelCatalogo => ({
  id: ID_PRODOTTO_SDG.base, name: 'Abbonamento Base — 300 € al mese', price: 300,
  seller_id: SDG_SELLER_ID, stock: null, status: 'available', has_variants: false, ...p,
});

describe('la regola del carrello rifiuta gli abbonamenti di SDG (carta e contanti)', () => {
  const valida = (p: ProdottoDelCatalogo, sellerId: string) =>
    validaRigaDelCarrello({ riga: { productId: p.id, quantity: 1 }, sellerId, prodotti: [p], varianti: new Map(), sconti: new Map() });

  it('un abbonamento di SDG non si vende, e il messaggio manda alla pagina Abbonamento', () => {
    const esito = valida(abbonamento(), SDG_SELLER_ID);
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.motivo).toBe('ABBONAMENTO_NON_IN_CARRELLO');
    expect(esito.scarto.messaggio).toContain('pagina Abbonamento');
    expect(esito.scarto.messaggio).not.toContain('preventivo');
    expect(rispostaPerCarrelloNonVendibile(esito.scarto).status).toBe(400);
  });

  it('anche se il browser lo dichiara sotto un altro negozio', () => {
    const esito = valida(abbonamento(), 'aaaaaaaa-0000-0000-0000-000000000001');
    expect(esito.ok).toBe(false);
  });

  it('anche se il browser dichiara SDG per un prodotto di un altro negozio', () => {
    const esito = valida(abbonamento({ seller_id: 'aaaaaaaa-0000-0000-0000-000000000001' }), SDG_SELLER_ID);
    expect(esito.ok).toBe(false);
  });

  it('tutti e tre gli abbonamenti sono rifiutati', () => {
    for (const p of PRODOTTI_SDG) {
      expect(valida(abbonamento({ id: p.id, name: p.nome, price: Number(p.prezzoEuro) }), SDG_SELLER_ID).ok).toBe(false);
    }
  });

  it('il prodotto di un negozio vero, e quelli del negozio «MyCity», si vendono come prima', () => {
    expect(valida(abbonamento({ seller_id: 'aaaaaaaa-0000-0000-0000-000000000001' }), 'aaaaaaaa-0000-0000-0000-000000000001').ok).toBe(true);
    expect(valida(abbonamento({ seller_id: MYCITY_SELLER_ID, stock: 5 }), MYCITY_SELLER_ID).ok).toBe(true);
  });
});

describe('il carrello del browser non prende un abbonamento di SDG', () => {
  beforeEach(() => localStorage.clear());

  it('addToCart lo lascia fuori, e una merce normale entra', async () => {
    const { addToCart, getCart } = await import('@/lib/cart');
    addToCart({ id: ID_PRODOTTO_SDG.premium, name: 'Abbonamento Premium', price: 999, sellerId: SDG_SELLER_ID });
    expect(getCart()).toHaveLength(0);
    addToCart({ id: 'pane', name: 'Pane', price: 3, sellerId: 'aaaaaaaa-0000-0000-0000-000000000001' });
    expect(getCart().map((r) => r.id)).toEqual(['pane']);
  });
});

describe('la pagina prodotto porta alla pagina Abbonamento, non al carrello', () => {
  it('un negozio va alla sua pagina Abbonamento, chi non lo è va a iscriversi', () => {
    expect(doveSiAttivaLAbbonamento(true).href).toBe('/seller/abbonamento');
    expect(doveSiAttivaLAbbonamento(true).testo).not.toContain('preventivo');
    expect(doveSiAttivaLAbbonamento(false).href).toBe('/sell');
  });

  it('eDiSdg riconosce solo SDG', () => {
    expect(eDiSdg(SDG_SELLER_ID)).toBe(true);
    expect(eDiSdg(SDG_SELLER_ID.toUpperCase())).toBe(true);
    expect(eDiSdg(MYCITY_SELLER_ID)).toBe(false);
    expect(eDiSdg(null)).toBe(false);
    expect(eDiSdg(undefined)).toBe(false);
  });
});

describe('i tre prodotti dicono quello che dice il listino', () => {
  it('nome e prezzo vengono da FASCE', () => {
    expect(PRODOTTI_SDG.map((p) => p.nome)).toEqual([
      'Abbonamento Base — 300 € al mese',
      'Abbonamento Business — 500 € al mese',
      'Abbonamento Premium — 999 € al mese',
    ]);
    for (const p of PRODOTTI_SDG) expect(Math.round(Number(p.prezzoEuro) * 100)).toBe(FASCE[p.fascia].prezzoMese);
  });

  it('la descrizione dice per chi è, cosa comprende e chi la realizza', () => {
    for (const f of ABBONAMENTI) {
      const p = PRODOTTI_SDG.find((x) => x.fascia === f)!;
      expect(p.descrizione).toContain(FASCE[f].perChi);
      for (const testo of Object.values(FASCE[f].servizi)) expect(p.descrizione).toContain(testo);
      expect(p.descrizione).toContain(FRASE_PARTNER);
    }
  });

  it('la migrazione 707 scrive gli stessi id, nomi e prezzi', () => {
    for (const p of PRODOTTI_SDG) {
      expect(MIGRAZIONE).toMatch(new RegExp(`\\('${p.id}'::uuid, '${p.nome}', '[^]*?', ${p.prezzoEuro.replace('.', '\\.')}\\)`));
    }
    expect(MIGRAZIONE).toContain(SDG_SELLER_ID);
  });

  // 24/11/2026 — Servizi da 4 a 3 (la scheda Google dentro la gestione social) e «si attiva dalla
  // pagina Abbonamento»: la 710 riscrive le descrizioni, che devono essere quelle del listino.
  it('la migrazione 710 riscrive le descrizioni coi servizi a 3, senza la scheda Google a sé', () => {
    expect(MIGRAZIONE_710).not.toContain('Scheda Google su Maps:');
    expect(MIGRAZIONE_710).toContain('Gestione dei social e di Google Maps:');
    expect(MIGRAZIONE_710).toContain(`p.seller_id = '${SDG_SELLER_ID}'::uuid`);
  });

  // 24/11/2026 sera — L'analisi del business è il quarto servizio: la 711 riscrive le descrizioni,
  // che devono essere quelle del listino di oggi (sempre l'ultima migrazione che le scrive).
  it('la migrazione 711 scrive le descrizioni con l analisi del business', () => {
    expect(MIGRAZIONE_711).toContain('· Analisi del business:');
    expect(MIGRAZIONE_711).toContain(`p.seller_id = '${SDG_SELLER_ID}'::uuid`);
  });

  it('la migrazione 863 scrive le descrizioni di oggi, col rapporto dell imprenditore', () => {
    const sql = MIGRAZIONE_863.replace(/''/g, "'");
    expect(MIGRAZIONE_863).toContain(`p.seller_id = '${SDG_SELLER_ID}'::uuid`);
    for (const p of PRODOTTI_SDG) {
      expect(sql).toContain(`('${p.id}'::uuid, '${p.descrizione}')`);
      expect(p.descrizione).toContain('· Analisi del business:');
      expect(p.descrizione).not.toContain('Scheda Google su Maps:');
      expect(p.descrizione).not.toContain('preventivo');
    }
    expect(MIGRAZIONE_711).toContain(`p.seller_id = '${SDG_SELLER_ID}'::uuid`);
  });
});
