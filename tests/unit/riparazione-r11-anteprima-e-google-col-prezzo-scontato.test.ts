/**
 * R11-002 — Con una promozione attiva del negozio, la card che WhatsApp e Facebook mostrano quando si
 * incolla il link del prodotto (app/product/[id]/opengraph-image.tsx) e i dati strutturati per Google
 * (il JSON-LD dell'offerta in app/product/[id]/layout.tsx) pubblicavano il prezzo PIENO, mentre la
 * scheda e la cassa chiedono quello scontato. Per Google `price` di un'offerta è il prezzo che il
 * cliente paga adesso.
 *
 * Qui il guscio e l'anteprima si eseguono davvero, contro un database finto che risponde come quello
 * vero: la riga del prodotto, il negozio, e la funzione degli sconti attivi (`product_active_discounts`).
 * Si guarda il prezzo scritto nel JSON-LD e quello disegnato sulla card.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { formatPrice } from '@/lib/format';

const mondo = vi.hoisted(() => ({
  prezzo: 10 as number,
  sconto: 0,
  scontiRotti: false,
}));

function client() {
  return {
    from: (tabella: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
      const riga = async () => {
        if (tabella === 'products') {
          return {
            data: { id: 'p1', name: 'Coppa piacentina', description: null, price: mondo.prezzo, images: [], status: 'available', stock: 3, seller_id: 'n1' },
            error: null,
          };
        }
        if (tabella === 'seller_public_profiles') return { data: { store_name: 'Salumeria Rossi', is_approved: true }, error: null };
        return { data: null, error: { code: 'PGRST116', message: 'nessuna riga' } };
      };
      q.single = riga;
      q.maybeSingle = riga;
      return q;
    },
    rpc: async (nome: string, argomenti: { p_products?: string[]; p_product?: string }) => {
      if (mondo.scontiRotti) return { data: null, error: { message: 'funzione non raggiungibile' } };
      if (nome === 'product_active_discounts') {
        return { data: (argomenti.p_products ?? []).map((id) => ({ product_id: id, discount_percent: mondo.sconto })), error: null };
      }
      if (nome === 'product_active_discount') return { data: mondo.sconto, error: null };
      return { data: null, error: { message: `rpc non prevista: ${nome}` } };
    },
  };
}

vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => client() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => client() }));
// Il precarico è vuoto: il guscio rilegge il prodotto per i metadati, dal database finto.
vi.mock('@/lib/queries/precarico', () => ({ precaricaProdotto: async () => ({ mutations: [], queries: [] }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('next/og', () => import('./aiuti/finti/next-og.mjs'));
// Il carattere del marchio si scarica con `fetch`: qui la rete è chiusa, e alla prova serve il testo.
vi.mock('@/app/carattere-del-marchio', () => ({
  caratteriDelMarchio: async () => [],
  MARCHIO_FONT_FAMILY: 'Fraunces',
  MARCHIO_FONT_WEIGHT: 800,
}));

const { dimenticaLettureDeiMetadati } = await import('@/lib/supabase/lettura-per-metadati');
const guscio = await import('@/app/product/[id]/layout');
const anteprima = await import('@/app/product/[id]/opengraph-image');

beforeEach(() => {
  mondo.prezzo = 10;
  mondo.sconto = 0;
  mondo.scontiRotti = false;
  dimenticaLettureDeiMetadati();
});

type Elemento = { type?: unknown; props?: Record<string, unknown> } | string | number | null | undefined | boolean | Elemento[];

/** Tutti gli elementi dell'albero, in ordine. */
function elementi(nodo: Elemento): Array<{ type?: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(nodo)) return nodo.flatMap(elementi);
  if (!isValidElement(nodo)) return [];
  const el = nodo as unknown as { type?: unknown; props: Record<string, unknown> };
  return [el, ...elementi(el.props.children as Elemento)];
}

function testoDi(nodo: Elemento): string {
  if (nodo == null || typeof nodo === 'boolean') return '';
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(testoDi).join(' ');
  return testoDi(((nodo as { props?: Record<string, unknown> }).props ?? {}).children as Elemento);
}

/** Il JSON-LD che il guscio scrive nell'HTML della scheda. */
async function datiPerGoogle(): Promise<{ offers: { price: string; priceCurrency: string } }> {
  const albero = await guscio.default({ children: null as ReactNode, params: Promise.resolve({ id: 'p1' }) });
  const script = elementi(albero as Elemento).find((e) => e.type === 'script' && e.props.type === 'application/ld+json');
  expect(script, 'il guscio non scrive più i dati strutturati').toBeDefined();
  const html = (script!.props.dangerouslySetInnerHTML as { __html: string }).__html;
  return JSON.parse(html);
}

/** Il testo disegnato sulla card per WhatsApp. */
async function testoDellaCard(): Promise<string> {
  const immagine = (await anteprima.default({ params: { id: 'p1' } })) as unknown as { elemento: Elemento };
  return testoDi(immagine.elemento).replace(/\s/g, ' ');
}

const euro = (n: number) => formatPrice(n).replace(/\s/g, ' ');

describe('R11-002 · i dati per Google dicono il prezzo che si paga ora', () => {
  it('in promo al 20% l’offerta costa 8.00, non 10.00', async () => {
    mondo.sconto = 20;
    const ld = await datiPerGoogle();
    expect(ld.offers.price, 'Google riceve il prezzo pieno durante la promozione').toBe('8.00');
    expect(ld.offers.priceCurrency).toBe('EUR');
  });

  it('lo sconto è al centesimo come in cassa: 1,15 € al -10% è 1.03', async () => {
    mondo.prezzo = 1.15;
    mondo.sconto = 10;
    expect((await datiPerGoogle()).offers.price).toBe('1.03');
  });

  it('senza promozione il prezzo resta quello pieno', async () => {
    expect((await datiPerGoogle()).offers.price).toBe('10.00');
  });

  it('se lo sconto non si legge la scheda si apre lo stesso, col prezzo pieno', async () => {
    mondo.sconto = 20;
    mondo.scontiRotti = true;
    expect((await datiPerGoogle()).offers.price).toBe('10.00');
  });
});

describe('R11-002 · la card per WhatsApp mostra il prezzo che si paga ora', () => {
  it('in promo al 20% la card scrive 8,00 €, non 10,00 €', async () => {
    mondo.sconto = 20;
    const testo = await testoDellaCard();
    expect(testo).toContain('Coppa piacentina');
    expect(testo, `la card scrive «${testo}»`).toContain(euro(8));
    expect(testo, 'la card mostra il prezzo pieno durante la promozione').not.toContain(euro(10));
  });

  it('senza promozione la card scrive il prezzo pieno', async () => {
    expect(await testoDellaCard()).toContain(euro(10));
  });

  it('se lo sconto non si legge la card esce lo stesso, col prezzo pieno', async () => {
    mondo.sconto = 20;
    mondo.scontiRotti = true;
    expect(await testoDellaCard()).toContain(euro(10));
  });
});
