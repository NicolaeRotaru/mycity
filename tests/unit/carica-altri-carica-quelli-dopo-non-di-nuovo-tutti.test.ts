import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { finestraDellaPagina } from '@/lib/paginazione';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 30/8/2026 (R080) — «CARICA ALTRI» RISCARICAVA OGNI VOLTA ANCHE I PRODOTTI
 * GIA' VISTI.
 *
 * La finestra non si spostava: si allargava. Il tetto veniva moltiplicato per
 * il numero di pressioni — 96, poi 192, poi 288, poi 384 — e il risultato di
 * prima si buttava via, perche' la chiave della cache conteneva il tetto.
 * Alla quarta pressione si erano scaricate 960 righe, con le loro foto, per
 * mostrarne 384: traffico e attesa crescono col QUADRATO delle pressioni,
 * sulla connessione di chi guarda, e ogni pressione e' piu' lenta della
 * precedente. Chi guarda non capisce cosa succede: vede solo che il pulsante
 * rallenta.
 *
 * Questa prova ESEGUE la lettura vera contro un database finto e guarda cosa
 * viene chiesto: la finestra della seconda pagina, e le righe che tornano.
 */

const negozio = { id: '22222222-2222-2222-2222-000000000001', store_name: 'Pane Quotidiano', store_hours: null, is_approved: true };

function catalogo(quanti: number): Tabelle {
  return {
    seller_public_profiles: [negozio],
    products: Array.from({ length: quanti }, (_, i) => ({
      id: `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`,
      name: `Prodotto ${i}`,
      price: 10,
      compare_at_price: null,
      images: [],
      stock: 5,
      has_variants: false,
      // Tutti pubblicati nello stesso istante: e' il caso in cui l'ordine fra
      // due righe lo deciderebbe il database, ed e' proprio quello che fa
      // saltare o ripetere le righe fra una pagina e l'altra.
      created_at: '2026-08-01T10:00:00Z',
      seller_id: negozio.id,
      category_id: null,
      status: 'available',
    })),
  };
}

const CENTO = 100;

async function pagina(db: ReturnType<typeof fintoDb>, n: number) {
  return leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
    sort: 'newest',
    tetto: CENTO,
    finestra: finestraDellaPagina(n, CENTO),
  });
}

describe('«Carica altri» sulla griglia dei prodotti', () => {
  it('la seconda pressione chiede le righe DOPO, non di nuovo tutte', async () => {
    const db = fintoDb(catalogo(250));

    await pagina(db, 0);
    await pagina(db, 1);

    const letture = db.chiamate.filter((c) => c.tabella === 'products');
    expect(letture).toHaveLength(2);
    expect(letture[0].finestra).toEqual([0, 99]);
    expect(
      letture[1].finestra,
      'la seconda pressione riscarica dall inizio: le prime cento righe arrivano due volte',
    ).toEqual([100, 199]);
    for (const l of letture) {
      expect(l.tetto, 'c e ancora un tetto che cresce invece di una finestra che si sposta').toBeNull();
    }
  });

  it('le righe della seconda pagina sono altre righe', async () => {
    const db = fintoDb(catalogo(250));

    const prima = await pagina(db, 0);
    const seconda = await pagina(db, 1);

    expect(prima).toHaveLength(CENTO);
    expect(seconda).toHaveLength(CENTO);
    const ripetute = seconda.filter((r) => prima.some((p) => p.id === r.id));
    expect(
      ripetute.map((r) => r.name),
      'la seconda pagina ripesca prodotti gia mostrati',
    ).toEqual([]);
  });

  it('l ordinamento e deterministico, altrimenti fra una pagina e l altra si salta una riga', async () => {
    const db = fintoDb(catalogo(120));
    await pagina(db, 0);
    const lettura = db.chiamate.find((c) => c.tabella === 'products');

    expect(
      lettura?.ordinamenti,
      'senza un secondo criterio d ordine due prodotti pubblicati insieme si scambiano di posto fra una pagina e l altra',
    ).toContain('id');
  });

  it('l ultima pagina torna corta: e cosi che si sa che sono finiti', async () => {
    const db = fintoDb(catalogo(150));
    const seconda = await pagina(db, 1);
    expect(seconda).toHaveLength(50);
  });
});

/**
 * La guardia strutturale: la lettura qui sopra si prova per davvero, ma chi
 * decide quale finestra chiedere e' la griglia. Se torna a moltiplicare il
 * tetto per il numero di pressioni, questa diventa rossa.
 */
describe('la griglia non torna ad allargare il tetto', () => {
  const griglia = readFileSync('components/ProductGrid.tsx', 'utf8');

  it('chiede una finestra che si sposta', () => {
    expect(griglia, 'la griglia non usa piu la finestra condivisa').toContain('finestraDellaPagina(');
  });

  it('non moltiplica piu il tetto per il numero di pressioni', () => {
    expect(
      griglia,
      'il tetto e tornato a crescere: ogni «Carica altri» riscarica anche quello che si vede gia',
    ).not.toMatch(/\*\s*pagine/);
  });
});
