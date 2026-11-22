/**
 * R11-009 — Cercando una parola a metà e sfogliando più pagine con un filtro che toglie pertinenti
 * (qui il prezzo; vale uguale per vetrina, solo disponibili, categoria): ogni prodotto atteso esce
 * UNA volta sola, e le righe lette per pagina non crescono con le pagine.
 *
 * Il finto qui sotto applica davvero i filtri, l'ordine, `.range()` e l'esclusione
 * `or=(id.not.in.(…))` come PostgREST.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';

type Riga = Record<string, unknown>;
type Lettura = { tabella: string; righe: number; finestra: [number, number] | null };

function fintoDb(tabelle: Record<string, Riga[]>, rpc: string[], opzioni: { nomeInErrore?: boolean } = {}) {
  const letture: Lettura[] = [];
  const rpcArgs: Array<Record<string, unknown>> = [];
  class Q {
    private fil: Array<(r: Riga) => boolean> = [];
    private ord: Array<{ c: string; asc: boolean }> = [];
    private fin: [number, number] | null = null;
    private tetto: number | null = null;
    private perNome = false;
    constructor(private t: string) {}
    select() { return this; }
    eq(c: string, v: unknown) { this.fil.push((r) => r[c] === v); return this; }
    in(c: string, v: unknown[]) { this.fil.push((r) => v.includes(r[c])); return this; }
    lte(c: string, v: number) { this.fil.push((r) => Number(r[c]) <= v); return this; }
    gte(c: string, v: number) { this.fil.push((r) => Number(r[c]) >= v); return this; }
    ilike(c: string, v: string) {
      this.perNome = true;
      const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
      this.fil.push((r) => re.test(String(r[c])));
      return this;
    }
    or(e: string) {
      const m = /^id\.not\.in\.\((.*)\)$/.exec(e);
      if (m) { const fuori = m[1].split(','); this.fil.push((r) => !fuori.includes(String(r.id))); }
      else this.fil.push((r) => r.stock == null || Number(r.stock) > 0);
      return this;
    }
    order(c: string, o?: { ascending?: boolean }) { this.ord.push({ c, asc: o?.ascending !== false }); return this; }
    range(a: number, b: number) { this.fin = [a, b]; return this; }
    limit(n: number) { this.tetto = n; return this; }
    then<T>(ok: (v: { data: Riga[] | null; error: { message: string } | null }) => T) {
      if (opzioni.nomeInErrore && this.perNome) return Promise.resolve(ok({ data: null, error: { message: 'timeout' } }));
      let righe = (tabelle[this.t] ?? []).filter((r) => this.fil.every((f) => f(r)));
      for (const o of [...this.ord].reverse()) {
        righe = [...righe].sort((x, y) => {
          const a = x[o.c] as string | number; const b = y[o.c] as string | number;
          return (a === b ? 0 : a < b ? -1 : 1) * (o.asc ? 1 : -1);
        });
      }
      if (this.fin) righe = righe.slice(this.fin[0], this.fin[1] + 1);
      else if (this.tetto != null) righe = righe.slice(0, this.tetto);
      letture.push({ tabella: this.t, righe: righe.length, finestra: this.fin });
      return Promise.resolve(ok({ data: righe, error: null }));
    }
  }
  const client = {
    from: (t: string) => new Q(t),
    rpc: async (_n: string, a: Record<string, unknown>) => { rpcArgs.push(a); return { data: rpc.slice(0, Number(a.lim)).map((id) => ({ id, rank: 1 })), error: null }; },
  };
  return { client: client as unknown as SupabaseClient, letture, rpcArgs };
}

const prodotto = (id: string, name: string, price: number, giorno: number) => ({
  id, name, price, compare_at_price: null, images: [], stock: 3, has_variants: false,
  created_at: `2026-11-${String(giorno).padStart(2, '0')}T10:00:00Z`, seller_id: 's1', category_id: null, status: 'available',
});
const TABELLE = {
  seller_public_profiles: [{ id: 's1', store_name: 'Forno', store_hours: null, is_approved: true }],
  products: [
    // pertinenti, in ordine di pertinenza: a1 e a4 il filtro sul prezzo li toglie
    prodotto('a1', 'Focaccia', 5, 1),
    prodotto('a2', 'Pane integrale', 2, 2),
    prodotto('a3', 'Grissini', 2, 3),
    prodotto('a4', 'Pane toscano', 9, 4),
    prodotto('a5', 'Pane carasau', 1, 5),
    // solo il nome ha la parola: dal più recente
    ...[8, 7, 6, 5, 4, 3, 2, 1].map((n, i) => prodotto(`n${i + 1}`, `Pane tipo ${n}`, 1, 20 - i)),
    prodotto('n9', 'Pane caro', 9, 25),
  ],
};
const PERTINENTI = ['a1', 'a2', 'a3', 'a4', 'a5'];
const ATTESI = ['a2', 'a3', 'a5', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'];

async function sfoglia(db: ReturnType<typeof fintoDb>, pagine: number, tetto = 4) {
  const fuori: string[][] = [];
  for (let k = 0; k < pagine; k++) {
    const pagina = await leggiProdottiDellaGriglia(db.client, {
      sort: 'relevance', search: 'pane', maxPrice: 3, tetto, finestra: [k * tetto, k * tetto + tetto - 1],
    });
    fuori.push(pagina.map((r) => r.id));
  }
  return fuori;
}

afterEach(() => vi.restoreAllMocks());

describe('R11-009 · ricerca per pertinenza su più pagine con un filtro', () => {
  it('sfogliando tre pagine ogni prodotto atteso esce una volta sola, nell ordine giusto', async () => {
    const db = fintoDb(TABELLE, PERTINENTI);
    const pagine = await sfoglia(db, 3);
    expect(pagine.flat()).toEqual(ATTESI);
  });

  it('le righe lette per pagina non crescono con le pagine', async () => {
    const perPagina: number[] = [];
    for (const k of [0, 1, 2]) {
      const db = fintoDb(TABELLE, PERTINENTI);
      await leggiProdottiDellaGriglia(db.client, {
        sort: 'relevance', search: 'pane', maxPrice: 3, tetto: 4, finestra: [k * 4, k * 4 + 3],
      });
      perPagina.push(db.letture.filter((l) => l.tabella === 'products').reduce((t, l) => t + l.righe, 0));
      expect(db.rpcArgs[0].lim, 'si chiedono sempre gli stessi pertinenti, qualunque sia la pagina').toBe(200);
    }
    // I pertinenti costano uguale a ogni pagina e la fetta per nome è di 4 righe al più: la pagina 3
    // non legge più della pagina 1 (prima: 200 + 96·k).
    expect(perPagina[2]).toBeLessThanOrEqual(perPagina[0]);
    expect(perPagina[1]).toBeLessThanOrEqual(perPagina[0]);
  });

  it('se la lettura per nome sbaglia si mostrano i pertinenti e la griglia non va in errore', async () => {
    const avviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = fintoDb(TABELLE, PERTINENTI, { nomeInErrore: true });
    const pagina = await leggiProdottiDellaGriglia(db.client, {
      sort: 'relevance', search: 'pane', maxPrice: 3, tetto: 4, finestra: [0, 3],
    });
    expect(pagina.map((r) => r.id)).toEqual(['a2', 'a3', 'a5']);
    expect(avviso).toHaveBeenCalled();
  });

  it('un pertinente che ha anche la parola nel nome non esce due volte, e la sua posizione non sposta le pagine', async () => {
    const db = fintoDb(TABELLE, ['a2', 'a3', 'a5']);
    const pagine = await sfoglia(db, 3);
    const tutti = pagine.flat();
    expect(new Set(tutti).size).toBe(tutti.length);
    expect(tutti).toEqual(ATTESI);
  });

  it('con una finestra «Carica altri» piena, anche con un solo pertinente', async () => {
    const tab = {
      seller_public_profiles: TABELLE.seller_public_profiles,
      products: [
        prodotto('p1', 'Pomodori', 2, 20), prodotto('p2', 'Pomodorini', 2, 19),
        prodotto('p3', 'Pomo d oro', 2, 18), prodotto('p4', 'Pane', 2, 17),
      ],
    };
    const db = fintoDb(tab, ['p1']);
    const q = (finestra: [number, number]) => leggiProdottiDellaGriglia(db.client, { sort: 'relevance', search: 'pomo', tetto: 2, finestra });
    expect((await q([0, 1])).map((x) => x.id)).toEqual(['p1', 'p2']);
    expect((await q([2, 3])).map((x) => x.id)).toEqual(['p3']);
  });
});
