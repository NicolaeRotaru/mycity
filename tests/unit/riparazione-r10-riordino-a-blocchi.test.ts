/**
 * R10-004 R10-005 — IL RIORDINO A BLOCCHI GUARDA IL PREZZO PAGATO.
 *
 * Con «più recensiti» o «voto minimo» la griglia riceve `idsColVoto`: oltre un blocco
 * (`DIMENSIONE_BLOCCO`) ogni blocco si legge a parte, le righe si riuniscono e si rimettono in
 * ordine in memoria (`nellOrdineDelDatabase`), perché l'ordine del database vale solo dentro il blocco.
 * Se la memoria guardasse il prezzo pieno, un prodotto scontato finirebbe dopo uno che costa di più
 * alla cassa. Qui il catalogo ha più di tre blocchi di id, molti prodotti scontati e coppie con lo
 * stesso prezzo pagato: l'ordine atteso è quello di una lettura sola (prezzo pagato, poi prezzo pieno,
 * poi id decrescente), come lo darebbe il database.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { DIMENSIONE_BLOCCO } from '@/lib/supabase/blocchi';
import type { SupabaseClient } from '@supabase/supabase-js';

const NEGOZIO = { id: '22222222-2222-2222-2222-000000000001', store_name: 'Forno', store_hours: null, is_approved: true };
const QUANTI = DIMENSIONE_BLOCCO * 2 + 50;

function riga(i: number) {
  const id = `p-${String(i).padStart(3, '0')}`;
  const price = 10 + ((i * 7) % 40); // 10..49, con molti prezzi uguali
  // Uno ogni tre è scontato della metà: il suo prezzo pagato non segue più il prezzo pieno.
  const prezzo_pagato = i % 3 === 0 ? price / 2 : price;
  return {
    id, name: id, price, prezzo_pagato, compare_at_price: null, images: [], stock: 3, has_variants: false,
    category_id: null, status: 'available', seller_id: NEGOZIO.id, created_at: '2026-11-20T10:00:00Z',
  };
}

const prodotti = Array.from({ length: QUANTI }, (_, i) => riga(i + 1));
const catalogo = (): Tabelle => ({ seller_public_profiles: [NEGOZIO], products: prodotti });
const cliente = () => fintoDb(catalogo()).client as unknown as SupabaseClient;

// Gli id dei recensiti in un ordine mescolato: ogni blocco ha prodotti di ogni fascia di prezzo.
const idsColVoto = prodotti.map((p) => p.id).sort((a, b) => ((Number(a.slice(2)) * 37) % 251) - ((Number(b.slice(2)) * 37) % 251));

// L'ordine atteso, scritto qui e non letto dal sito: prezzo pagato, poi prezzo pieno, poi id decrescente;
// per «decrescente» i primi due criteri si rovesciano e l'id resta decrescente.
function attesi(sort: 'price_asc' | 'price_desc'): string[] {
  const verso = sort === 'price_asc' ? 1 : -1;
  return [...prodotti]
    .sort((a, b) => verso * (a.prezzo_pagato - b.prezzo_pagato) || verso * (a.price - b.price) || (a.id < b.id ? 1 : -1))
    .map((p) => p.id);
}

describe('R10-004 R10-005 · il riordino dei blocchi segue il prezzo pagato', () => {
  it('il catalogo di prova supera davvero un blocco e ha il prezzo pagato diverso dal pieno', () => {
    expect(idsColVoto.length).toBeGreaterThan(DIMENSIONE_BLOCCO * 2);
    expect(prodotti.some((p) => p.prezzo_pagato !== p.price)).toBe(true);
    // Almeno una coppia con lo stesso prezzo pagato e prezzo pieno diverso (decide il prezzo pieno).
    const viste = new Map<number, Set<number>>();
    for (const p of prodotti) viste.set(p.prezzo_pagato, (viste.get(p.prezzo_pagato) ?? new Set()).add(p.price));
    expect([...viste.values()].some((s) => s.size > 1)).toBe(true);
  });

  for (const sort of ['price_asc', 'price_desc'] as const) {
    it(`${sort}: la lettura a blocchi dà l'elenco di una lettura sola (prezzo pagato, pieno, id)`, async () => {
      const aBlocchi = await leggiProdottiDellaGriglia(cliente(), { sort, tetto: QUANTI, idsColVoto });
      expect(aBlocchi.map((r) => r.id)).toEqual(attesi(sort));
    });

    it(`${sort}: le finestre successive non saltano né ripetono righe`, async () => {
      const c = cliente();
      const p1 = await leggiProdottiDellaGriglia(c, { sort, tetto: 40, idsColVoto, finestra: [0, 39] });
      const p2 = await leggiProdottiDellaGriglia(c, { sort, tetto: 40, idsColVoto, finestra: [40, 79] });
      expect([...p1, ...p2].map((r) => r.id)).toEqual(attesi(sort).slice(0, 80));
    });
  }

  it('price_asc: un prodotto scontato da 40 € a 20 € passa davanti a uno da 25 € (non scontato)', async () => {
    const c = fintoDb({
      seller_public_profiles: [NEGOZIO],
      products: [
        { ...riga(1), id: 'scontato', price: 40, prezzo_pagato: 20 },
        { ...riga(2), id: 'pieno-25', price: 25, prezzo_pagato: 25 },
        ...Array.from({ length: DIMENSIONE_BLOCCO + 5 }, (_, i) => ({ ...riga(i + 10), id: `x-${i}`, price: 60 + i, prezzo_pagato: 60 + i })),
      ],
    }).client as unknown as SupabaseClient;
    const ids = ['pieno-25', ...Array.from({ length: DIMENSIONE_BLOCCO + 5 }, (_, i) => `x-${i}`), 'scontato'];
    const righe = await leggiProdottiDellaGriglia(c, { sort: 'price_asc', tetto: 5, idsColVoto: ids });
    expect(righe.map((r) => r.id).slice(0, 2)).toEqual(['scontato', 'pieno-25']);
  });
});
