/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 17/11/2026 — LA CATEGORIA MADRE CON LE FILE CADUTE E IL CONTEGGIO CHE RISPONDE.
 *
 * Nella pagina di una categoria madre ogni fila di prodotti (una per sottocategoria, più «Altri
 * prodotti») si nasconde da sola quando la sua lettura cade. La pagina diceva «non riesco a
 * caricare i prodotti» solo se cadeva anche la domanda di conteggio: con le file giù e il conteggio
 * che risponde 7, sotto i bottoni delle sottocategorie restava il bianco. Qui la pagina vera si
 * monta con le file vere (components/ProductGrid.tsx), il react-query vero e un database finto.
 */
const g = globalThis as Record<string, unknown>;

const CATEGORIE = [
  { id: 'c-alim', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null },
  { id: 'c-forno', slug: 'forno', name: 'Forno', icon: null, parent_id: 'c-alim' },
  { id: 'c-vini', slug: 'vini', name: 'Vini', icon: null, parent_id: 'c-alim' },
];
const PRODOTTI = [
  {
    id: 'p-focaccia', name: 'Focaccia genovese', description: 'Alta e soffice', price: 4.5, compare_at_price: null,
    images: ['f.jpg'], seller_id: 'n-forno', status: 'available', created_at: '2026-11-10T08:00:00Z',
    category_id: 'c-forno', stock: 10, has_variants: false, unit: 'pezzo', condition: 'nuovo',
  },
];

type Mondo = { fileCadute: boolean; conteggioCaduto: boolean; fileFerme: boolean };
let mondo: Mondo;
const fileInAttesa: Array<() => void> = [];
const sbloccaLeFile = () => fileInAttesa.splice(0).forEach((via) => via());

function database() {
  const catena = (tavola: string) => {
    let soloConteggio = false;
    const risposta = async () => {
      if (tavola === 'categories') return { data: CATEGORIE, error: null };
      if (tavola === 'seller_public_profiles') {
        return { data: [{ id: 'n-forno', store_name: 'Forno del borgo', store_hours: null, is_approved: true }], error: null };
      }
      if (tavola === 'products') {
        if (soloConteggio) {
          return mondo.conteggioCaduto
            ? { data: null, count: null, error: { message: 'TypeError: fetch failed' } }
            : { data: null, count: 7, error: null };
        }
        if (mondo.fileFerme) await new Promise<void>((r) => { fileInAttesa.push(r); });
        return mondo.fileCadute
          ? { data: null, error: { message: 'TypeError: fetch failed' } }
          : { data: PRODOTTI, error: null };
      }
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'neq', 'in', 'is', 'or', 'order', 'limit', 'range', 'gt', 'gte', 'lte', 'lt', 'ilike', 'not']) c[m] = () => c;
    c.select = (_colonne: string, opzioni?: { head?: boolean }) => {
      soloConteggio = !!opzioni?.head;
      return c;
    };
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => risposta().then(ok, ko);
    return c;
  };
  return { from: catena, rpc: () => Promise.resolve({ data: [], error: null }) };
}

async function lascia(volte = 30) {
  for (let i = 0; i < volte; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function apriLaCategoria() {
  g.__CLIENT_SUPABASE__ = database();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const mod = await monta('app/category/[slug]/page.tsx', { veri: ['@tanstack/react-query'] });
  const Pagina = mod.default as (p: unknown) => unknown;
  const params = { slug: 'alimentari' };
  const schermo = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never, { params })));
  await lascia();
  const testo = () => testoVisibile(schermo.radice);
  const riprova = () =>
    [...schermo.radice.querySelectorAll('button')].find((b) => testoVisibile(b).toLowerCase().includes('riprova'));
  return { schermo, qc, testo, riprova };
}

afterEach(() => {
  delete g.__CLIENT_SUPABASE__;
  document.body.innerHTML = '';
});

describe('categoria madre: file cadute e conteggio che risponde', () => {
  it('le file cadono e il conteggio dice 7: la pagina lo dice e offre «Riprova», invece del bianco', async () => {
    mondo = { fileCadute: true, conteggioCaduto: false, fileFerme: false };
    const { schermo, qc, testo, riprova } = await apriLaCategoria();
    expect(testo(), 'la pagina della categoria non si è disegnata').toContain('Alimentari');
    expect(qc.getQueryData(['products', { conteggio: true, categoryIds: ['c-alim', 'c-forno', 'c-vini'] }]), 'il conteggio doveva rispondere 7').toBe(7);
    expect(testo(), 'le file sono cadute e la categoria è rimasta bianca').toMatch(/Non riesco a caricare i prodotti di questa categoria/);
    expect(riprova(), 'manca il «Riprova»').toBeTruthy();
    schermo.smonta();
  }, 60000);

  it('«Riprova» riuscito toglie il messaggio e mostra i prodotti', async () => {
    mondo = { fileCadute: true, conteggioCaduto: false, fileFerme: false };
    const { schermo, testo, riprova } = await apriLaCategoria();
    expect(testo()).toMatch(/Non riesco a caricare i prodotti di questa categoria/);
    mondo.fileCadute = false;
    await act(async () => {
      clicca(riprova()!);
    });
    await lascia();
    expect(testo()).not.toMatch(/Non riesco a caricare i prodotti di questa categoria/);
    expect(testo()).toContain('Focaccia genovese');
    schermo.smonta();
  }, 60000);

  it('file piene: nessun messaggio d’errore', async () => {
    mondo = { fileCadute: false, conteggioCaduto: false, fileFerme: false };
    const { schermo, testo } = await apriLaCategoria();
    expect(testo()).toContain('Focaccia genovese');
    expect(testo()).not.toMatch(/Non riesco a caricare/);
    schermo.smonta();
  }, 60000);

  it('cade il conteggio mentre le file arrivano: niente messaggio sotto le file in caricamento, né dopo se arrivano piene', async () => {
    mondo = { fileCadute: false, conteggioCaduto: true, fileFerme: true };
    const { schermo, testo } = await apriLaCategoria();
    expect(testo(), 'il messaggio d’errore compare sotto le file che stanno ancora arrivando').not.toMatch(/Non riesco a caricare/);
    mondo.fileFerme = false;
    await act(async () => {
      sbloccaLeFile();
    });
    await lascia();
    expect(testo()).toContain('Focaccia genovese');
    expect(testo()).not.toMatch(/Non riesco a caricare/);
    schermo.smonta();
  }, 60000);
});
