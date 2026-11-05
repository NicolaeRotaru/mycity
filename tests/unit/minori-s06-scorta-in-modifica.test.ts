/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { monta } from './aiuti/monta-componente';
import { attendi, clicca } from './aiuti/schermo';
import { salvaProdottoTracciato, ScortaCambiata } from '@/lib/products/salvataggio-tracciato';
import { controllaScorteVarianti, saveProductVariantsServer } from '@/lib/products/persistVariantsServer';

/**
 * S06 — La scorta in «Modifica prodotto».
 * 2110: riscrivere la stessa scorta vista all'apertura, quando le vendite l'hanno mossa,
 *       non dice più «salvato» senza salvare.
 * 2111: il modulo confronta con la scorta vista all'apertura, non con quella riletta.
 * 2112: da scorta fissa a illimitata, e ritorno, la scorta parte.
 * 2478: la scorta cambiata di una taglia si scopre prima di scrivere il prodotto.
 * 2113: la regola delle taglie è quella del prodotto, e il browser passa le scorte viste.
 * 2520: nessun rimando a una «migrazione 169» che non esiste.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const CATEGORIE = [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }];
const iniziali = (extra: Record<string, unknown> = {}) => ({
  name: 'Focaccia genovese', description: 'Focaccia con olio extravergine, cotta nel forno a legna.',
  price: 4, compareAtPrice: null, unit: 'pezzo', condition: null, stock: 5, category_id: 'cat-1',
  images: ['https://mycity.test/focaccia.jpg'], attributes: {}, tags: [], expressEnabled: true,
  status: 'available', variants: [], ...extra,
});

function scrivi(campo: HTMLInputElement, valore: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function apri(valori: Record<string, unknown>) {
  const salvati: Record<string, unknown>[] = [];
  const mod = await monta('components/seller/ProductForm.tsx');
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  const props = (v: Record<string, unknown>) => ({
    mode: 'edit', categories: CATEGORIE, initialValues: v,
    onSubmit: (p: Record<string, unknown>) => salvati.push(p),
    sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
  });
  await act(async () => { root.render(createElement(mod.default as ComponentType<Record<string, unknown>>, props(valori))); });
  const ridisegna = async (v: Record<string, unknown>) => {
    await act(async () => { root.render(createElement(mod.default as ComponentType<Record<string, unknown>>, props(v))); });
  };
  const salva = async () => {
    const b = Array.from(radice.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('Salva modifiche'));
    await act(async () => { clicca(b as HTMLButtonElement); });
    await attendi(); await attendi();
  };
  const campo = (n: string) => radice.querySelector(`[name="${n}"]`) as HTMLInputElement;
  return { radice, root, salvati, ridisegna, salva, campo };
}

describe('2110 — la stessa scorta riscritta', () => {
  it('il modulo la manda, confermata, con la scorta vista', async () => {
    const m = await apri(iniziali());
    // Come una persona: cancella il 5 e lo riscrive.
    await act(async () => { scrivi(m.campo('stock'), ''); });
    await act(async () => { scrivi(m.campo('stock'), '5'); });
    await m.salva();
    expect(m.salvati).toHaveLength(1);
    expect(m.salvati[0].stock).toBe(5);
    expect(m.salvati[0].stock_visto).toBe(5);
    expect(m.salvati[0].stock_confermato).toBe(true);
    m.root.unmount();
  });

  it('la porta di scrittura, se nel frattempo le vendite l\'hanno mossa, lo dice', async () => {
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', seller_id: 's1', stock: 3, status: 'available' }, error: null }) }) }),
        update: vi.fn(),
      }),
    };
    await expect(salvaProdottoTracciato({
      db: db as never, prodottoId: 'p1', attoreId: 's1', origine: 'x',
      payload: { stock: 5, stock_visto: 5, stock_confermato: true }, scriviTraccia: () => {},
    })).rejects.toBeInstanceOf(ScortaCambiata);
  });
});

describe('2111 — confronto con la scorta vista all\'apertura', () => {
  it('ridisegnato con la scorta riletta, la scorta non toccata non parte', async () => {
    const m = await apri(iniziali({ stock: 5 }));
    await m.ridisegna(iniziali({ stock: 3 }));
    await act(async () => { scrivi(m.campo('price'), '4.5'); });
    await m.salva();
    expect(m.salvati).toHaveLength(1);
    expect('stock' in m.salvati[0]).toBe(false);
    m.root.unmount();
  });
});

describe('2112 — fissa ↔ illimitata', () => {
  const spunta = (r: HTMLElement) =>
    Array.from(r.querySelectorAll('input[type="checkbox"]')).find((c) =>
      /illimitat/i.test(c.closest('label')?.textContent ?? '')) as HTMLInputElement;
  it('da 5 a illimitata parte null', async () => {
    const m = await apri(iniziali({ stock: 5 }));
    await act(async () => { clicca(spunta(m.radice)); });
    await m.salva();
    expect(m.salvati[0].stock).toBeNull();
    m.root.unmount();
  });
  it('da illimitata a 5 parte 5', async () => {
    const m = await apri(iniziali({ stock: null }));
    await act(async () => { clicca(spunta(m.radice)); });
    await act(async () => { scrivi(m.campo('stock'), '5'); });
    await m.salva();
    expect(m.salvati[0].stock).toBe(5);
    m.root.unmount();
  });
});

function dbVarianti(righe: { id: string; stock: number }[], scritture: string[]) {
  const c: Record<string, unknown> = {};
  const catena = () => c;
  Object.assign(c, {
    select: catena, eq: catena, in: catena,
    then: (ok: (v: unknown) => void) => ok({ data: righe, error: null }),
    delete: () => { scritture.push('delete'); return { in: async () => ({ error: null }) }; },
    update: () => { scritture.push('update'); return c; },
    insert: async () => { scritture.push('insert'); return { error: null }; },
  });
  return { from: () => c } as never;
}

describe('2478 — taglia cambiata: si scopre prima di scrivere', () => {
  it('controllaScorteVarianti lancia senza scrivere niente', async () => {
    const scritture: string[] = [];
    const db = dbVarianti([{ id: 'v-s', stock: 1 }], scritture);
    await expect(controllaScorteVarianti(db, 'p1', [{ id: 'v-s', options: {}, label: 'S', stock: 4 }], { 'v-s': 2 }))
      .rejects.toThrow(/La scorta di «S» è cambiata/);
    expect(scritture).toEqual([]);
  });
  it('la pagina di modifica lo chiama prima di salvare il prodotto', () => {
    const src = readFileSync('app/seller/products/[id]/edit/page.tsx', 'utf8');
    const i = src.indexOf('await controllaScorteVariantiDalBrowser(');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(src.indexOf('await salvaProdottoDalBrowser('));
  });
});

describe('2113 — una regola sola e la porta del browser', () => {
  it('la taglia riscritta uguale a quella vista non parte (stessa regola del prodotto)', async () => {
    const scritture: string[] = [];
    const db = dbVarianti([{ id: 'v-s', stock: 2 }], scritture);
    await saveProductVariantsServer(db, 'p1', [{ id: 'v-s', options: {}, label: 'S', stock: 2 }], { 'v-s': 2 });
    expect(readFileSync('lib/products/persistVariantsServer.ts', 'utf8')).toContain('!scortaCambiata(row.stock, vista)');
  });
  it('la pagina del negoziante passa da persistVariants, che inoltra le scorte viste', () => {
    const pagina = readFileSync('app/seller/products/[id]/edit/page.tsx', 'utf8');
    expect(pagina).not.toContain("from '@/lib/products/persistVariantsServer'");
    expect(readFileSync('lib/products/persistVariants.ts', 'utf8')).toMatch(/saveProductVariantsServer\(supabase, productId, variants, scorteViste\)/);
  });
});

describe('2520 — nessuna migrazione fantasma', () => {
  it('lib/products non cita la «migrazione 169»', () => {
    for (const f of readdirSync('lib/products')) {
      if (!f.endsWith('.ts')) continue;
      expect(readFileSync(`lib/products/${f}`, 'utf8'), f).not.toMatch(/migrazione 169/);
    }
  });
});

describe('2578 (revisore) — «Duplica» manda davvero l\'esclusione dal recesso', () => {
  it('in creazione, con la spunta già messa dal prodotto copiato, parte non_recedibile: true', async () => {
    const salvati: Record<string, unknown>[] = [];
    const mod = await monta('components/seller/ProductForm.tsx');
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => {
      root.render(createElement(mod.default as ComponentType<Record<string, unknown>>, {
        mode: 'create', categories: CATEGORIE, recessoSegnabile: true,
        initialValues: { ...iniziali(), name: 'Focaccia (copia)', status: 'draft', nonRecedibile: true },
        onSubmit: (p: Record<string, unknown>) => salvati.push(p),
        sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
      }));
    });
    const b = Array.from(radice.querySelectorAll('button')).find((x) => /Pubblica prodotto/.test(x.textContent ?? ''));
    expect(b, 'il pulsante «Pubblica prodotto» non è a video').toBeTruthy();
    await act(async () => { clicca(b as HTMLButtonElement); });
    await attendi(); await attendi();
    expect(salvati.at(-1)?.non_recedibile).toBe(true);
    root.unmount();
  });
});
