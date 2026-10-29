/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';

/**
 * 28/10/2026 — CHI CORREGGE LA DESCRIZIONE RIMETTE IN MAGAZZINO LA MERCE VENDUTA.
 *
 * Il fornaio apre «Modifica prodotto» sulla focaccia: la scorta letta
 * all'apertura è 5. Mentre la scheda resta aperta, due clienti comprano e
 * `reserve_stock` porta la scorta a 3. Lui corregge una parola nella
 * descrizione e salva. Il modulo mandava sempre `stock: 5` — il numero visto
 * all'apertura, che lui non aveva toccato — e la porta di scrittura lo
 * scriveva: in vetrina tornavano 2 focacce che non esistono, e il registro
 * attribuiva il cambio di scorta a lui.
 *
 * La prova guarda il comportamento: cosa parte verso il database quando il
 * negoziante NON tocca la scorta (niente) e quando la tocca (il suo numero).
 * Per le varianti vale lo stesso, riga per riga.
 */

const CATEGORIE = [{ id: 'cat-1', name: 'Panetteria', slug: 'panetteria', parent_id: null }];

function valoriIniziali(extra: Record<string, unknown> = {}) {
  return {
    name: 'Focaccia genovese',
    description: 'Focaccia con olio extravergine, cotta nel forno a legna.',
    price: 4,
    compareAtPrice: null,
    unit: 'pezzo',
    condition: null,
    stock: 5,
    category_id: 'cat-1',
    images: ['https://mycity.test/focaccia.jpg'],
    attributes: {},
    tags: [],
    expressEnabled: true,
    status: 'available',
    variants: [],
    ...extra,
  };
}

type Schermo = ReturnType<typeof accendi>;
type Salvato = { payload: Record<string, unknown>; ctx: Record<string, unknown> };

/** Scrive in un campo come ci scrive una persona, e lo fa sapere a React. */
function scrivi(campo: HTMLInputElement | HTMLTextAreaElement, valore: string): void {
  const proto = campo instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function campo(s: Schermo, nome: string): HTMLInputElement | HTMLTextAreaElement {
  const el = s.radice.querySelector(`[name="${nome}"]`);
  expect(el, `il campo «${nome}» non è a video: la prova girerebbe a vuoto`).not.toBeNull();
  return el as HTMLInputElement | HTMLTextAreaElement;
}

async function apriModifica(iniziali = valoriIniziali()): Promise<{ s: Schermo; salvati: Salvato[] }> {
  const salvati: Salvato[] = [];
  const mod = await monta('components/seller/ProductForm.tsx');
  const s = accendi(mod.default, {
    mode: 'edit',
    categories: CATEGORIE,
    initialValues: iniziali,
    onSubmit: (payload: Record<string, unknown>, ctx: Record<string, unknown>) => salvati.push({ payload, ctx }),
    sellerOffersExpress: true,
    consegnaDelNegozioNonLetta: false,
  });
  expect((s.radice.textContent ?? '').replace(/\s+/g, ' '), 'il modulo non è a video').toContain('Salva modifiche');
  return { s, salvati };
}

async function salva(s: Schermo): Promise<void> {
  const b = Array.from(s.radice.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('Salva modifiche'));
  expect(b, 'il pulsante «Salva modifiche» non è a video').toBeTruthy();
  s.agisci(() => clicca(b as HTMLButtonElement));
  await attendi();
  await attendi();
}

describe('la scorta parte verso il database solo se l\'ha cambiata il negoziante', () => {
  it('IL CASO CHE ROMPEVA — corregge la descrizione: la scorta letta all\'apertura non viene riscritta', async () => {
    const { s, salvati } = await apriModifica();
    s.agisci(() => scrivi(campo(s, 'description'), 'Focaccia con olio extravergine ligure, cotta nel forno a legna.'));
    await salva(s);
    expect(salvati, 'il salvataggio non è partito: la prova girerebbe a vuoto').toHaveLength(1);
    expect(salvati[0].payload.description).toContain('ligure');
    expect('stock' in salvati[0].payload, 'la scorta vista all\'apertura riscrive quella vera').toBe(false);
    s.smonta();
  });

  it('cambia la scorta: il suo numero si scrive (il campo non è rotto)', async () => {
    const { s, salvati } = await apriModifica();
    s.agisci(() => scrivi(campo(s, 'stock'), '8'));
    await salva(s);
    expect(salvati).toHaveLength(1);
    expect(Number(salvati[0].payload.stock)).toBe(8);
    s.smonta();
  });

  it('scorta illimitata non toccata: non parte neanche il null', async () => {
    const { s, salvati } = await apriModifica(valoriIniziali({ stock: null }));
    s.agisci(() => scrivi(campo(s, 'price'), '5'));
    await salva(s);
    expect(salvati).toHaveLength(1);
    expect('stock' in salvati[0].payload).toBe(false);
    s.smonta();
  });

  it('con varianti non toccate: niente scorta del prodotto, e le scorte viste arrivano a chi salva le varianti', async () => {
    const varianti = [
      { id: 'v-s', options: { Taglia: 'S' }, label: 'S', stock: 2 },
      { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3 },
    ];
    const { s, salvati } = await apriModifica(valoriIniziali({ variants: varianti }));
    s.agisci(() => scrivi(campo(s, 'price'), '5'));
    await salva(s);
    expect(salvati).toHaveLength(1);
    expect('stock' in salvati[0].payload).toBe(false);
    expect(salvati[0].ctx.scorteViste).toEqual({ 'v-s': 2, 'v-m': 3 });
    s.smonta();
  });
});

describe('le varianti: si riscrive solo la scorta che il negoziante ha cambiato', () => {
  function clientFinto(esistenti: string[]) {
    const aggiornamenti: Array<{ id: string; riga: Record<string, unknown> }> = [];
    const client = {
      from: () => ({
        select: () => ({ eq: async () => ({ data: esistenti.map((id) => ({ id })), error: null }) }),
        update: (riga: Record<string, unknown>) => ({
          eq: async (_c: string, id: string) => {
            aggiornamenti.push({ id, riga });
            return { error: null };
          },
        }),
        delete: () => ({ in: async () => ({ error: null }) }),
        insert: async () => ({ error: null }),
      }),
    };
    return { client, aggiornamenti };
  }

  it('la variante venduta nel frattempo non torna in magazzino; quella cambiata a mano sì', async () => {
    const { client, aggiornamenti } = clientFinto(['v-s', 'v-m']);
    await saveProductVariantsServer(
      client as never,
      'prod-1',
      [
        { id: 'v-s', options: { Taglia: 'S' }, label: 'S', stock: 2 },
        { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 9 },
      ],
      { 'v-s': 2, 'v-m': 3 },
    );
    const s = aggiornamenti.find((a) => a.id === 'v-s');
    const m = aggiornamenti.find((a) => a.id === 'v-m');
    expect(s && 'stock' in s.riga, 'la scorta della S, non toccata, viene riscritta').toBe(false);
    expect(s?.riga.label).toBe('S');
    expect(m?.riga.stock).toBe(9);
  });

  it('senza le scorte viste (chiamate dell\'amministrazione) resta tutto come prima', async () => {
    const { client, aggiornamenti } = clientFinto(['v-s']);
    await saveProductVariantsServer(client as never, 'prod-1', [
      { id: 'v-s', options: { Taglia: 'S' }, label: 'S', stock: 2 },
    ]);
    expect(aggiornamenti[0].riga.stock).toBe(2);
  });
});

/**
 * La pagina «Modifica prodotto» collega il modulo a chi salva le varianti. Se la
 * pagina lascia cadere le scorte viste all'apertura, modulo e porta di scrittura
 * possono essere giusti quanto vogliono: la variante venduta mentre la scheda
 * era aperta torna comunque in magazzino. Qui si monta la pagina vera e si
 * guarda cosa chiede di salvare quando il negoziante tocca solo il prezzo.
 */
describe('la pagina di modifica passa le scorte viste a chi salva le varianti', () => {
  const globali = globalThis as Record<string, unknown>;
  const ID = 'prod-focaccia';
  const VARIANTI = [
    { id: 'v-s', options: { Taglia: 'S' }, label: 'S', stock: 2 },
    { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3 },
  ];
  const PRODOTTO = {
    id: ID,
    seller_id: 'seller-1',
    name: 'Focaccia genovese',
    description: 'Focaccia con olio extravergine, cotta nel forno a legna.',
    price: 4,
    compare_at_price: null,
    unit: 'pezzo',
    condition: null,
    stock: 5,
    category_id: 'cat-1',
    images: ['https://mycity.test/focaccia.jpg'],
    attributes: {},
    tags: [],
    express_enabled: true,
    status: 'available',
  };

  beforeEach(() => {
    globali.__MUTAZIONI__ = [];
    globali.__DATI_QUERY__ = (opzioni: { queryKey?: readonly unknown[] }) => {
      const chiave = (opzioni?.queryKey ?? []) as unknown[];
      if (chiave.some((p) => p === 'offers-express')) return true;
      if (chiave.includes('variants')) return VARIANTI;
      if (chiave.some((p) => p === 'form')) return CATEGORIE;
      return PRODOTTO;
    };
  });

  afterEach(() => {
    delete globali.__MUTAZIONI__;
    delete globali.__DATI_QUERY__;
  });

  it('IL CASO CHE ROMPEVA — tocca solo il prezzo: le scorte viste delle varianti arrivano al salvataggio', async () => {
    const mod = await monta('app/seller/products/[id]/edit/page.tsx');
    const s = accendi(mod.default, { params: { id: ID } });
    expect((s.radice.textContent ?? '').replace(/\s+/g, ' '), 'la pagina non è a video').toContain('Salva modifiche');
    s.agisci(() => scrivi(campo(s, 'price'), '5'));
    await salva(s);
    const mutazioni = globali.__MUTAZIONI__ as Array<Record<string, unknown>>;
    expect(mutazioni, 'il salvataggio non è partito: la prova girerebbe a vuoto').toHaveLength(1);
    const payload = mutazioni[0].payload as Record<string, unknown>;
    expect(Number(payload.price)).toBe(5);
    expect('stock' in payload, 'la pagina rimanda la scorta vista all\'apertura').toBe(false);
    expect(
      mutazioni[0].scorteViste,
      'la pagina lascia cadere le scorte viste: ogni variante venduta nel frattempo torna in magazzino',
    ).toEqual({ 'v-s': 2, 'v-m': 3 });
    s.smonta();
  });
});
