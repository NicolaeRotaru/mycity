/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R19-016 — Un carrello condiviso con più di cinquanta righe perdeva le ultime
 * in silenzio, anche quelle disponibili, e non le contava fra le escluse.
 *
 * Due lati: chi apre il link (/shared-cart) deve sapere che mancano righe; chi
 * condivide (ShareCartButton) non deve far nascere un link già tagliato.
 */

vi.mock('@/lib/analytics/events', () => ({ trackShareCart: async () => undefined }));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined, info: () => undefined } }));

const globali = globalThis as Record<string, unknown>;
const STRUDEL = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILONE = 'ffffffff-6666-4666-8666-ffffffffffff';
const finto = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prodotto = (id: string, nome: string) => ({
  id, name: nome, price: 3, images: null, status: 'available', stock: null, seller_id: 'neg', has_variants: false,
});

/** Il database finto: dei prodotti chiesti risponde solo quelli che esistono. */
function database(esistenti: ReturnType<typeof prodotto>[]) {
  const catena = (tavola: string) => {
    let chiesti: string[] | null = null;
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'order', 'limit']) c[k] = () => c;
    c.in = (_col: string, ids: string[]) => { chiesti = ids; return c; };
    c.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve({
        data:
          tavola === 'seller_public_profiles'
            ? [{ id: 'neg', store_name: 'Forno', is_approved: true }]
            : esistenti.filter((p) => !chiesti || chiesti.includes(p.id)),
        error: null,
      }).then(ok);
    return c;
  };
  return { from: catena, rpc: async () => ({ data: [], error: null }) };
}

describe('R19-016 · chi apre una lista di più di cinquanta righe sa che ne mancano', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    globali.__CLIENT_SUPABASE__ = undefined;
    globali.__QUERY_FINTA__ = undefined;
    localStorage.clear();
  });

  it('60 righe (prima e ultima vere, in mezzo 58 inesistenti): o compare il Filone o si dice «60 righe, le prime 50»', async () => {
    globali.__CLIENT_SUPABASE__ = database([prodotto(STRUDEL, 'Strudel'), prodotto(FILONE, 'Filone')]);
    const voci = [`${STRUDEL}:1`, ...Array.from({ length: 58 }, (_, n) => `${finto(n + 1)}:1`), `${FILONE}:1`];
    globali.__QUERY_FINTA__ = `cart=${voci.join(',')}`;
    const mod = await monta('app/shared-cart/page.tsx');
    const s = accendi(mod.default, {});
    for (let i = 0; i < 5; i++) await attendi();
    const t = s.radice.textContent ?? '';
    expect(t).toContain('Strudel');
    const filoneVisto = t.includes('Filone');
    const detto = /60 righe/.test(t) && /prime 50/.test(t);
    expect(filoneVisto || detto, 'le righe dopo la cinquantesima spariscono senza una parola').toBe(true);
    s.smonta();
  }, 60000);

  it('50 righe esatte: nessun avviso di righe mancanti', async () => {
    globali.__CLIENT_SUPABASE__ = database([prodotto(STRUDEL, 'Strudel')]);
    const voci = [`${STRUDEL}:1`, ...Array.from({ length: 49 }, (_, n) => `${finto(n + 1)}:1`)];
    globali.__QUERY_FINTA__ = `cart=${voci.join(',')}`;
    const mod = await monta('app/shared-cart/page.tsx');
    const s = accendi(mod.default, {});
    for (let i = 0; i < 5; i++) await attendi();
    expect(s.radice.textContent ?? '').not.toMatch(/ne mostro solo/);
    s.smonta();
  }, 60000);
});

describe('R19-016 · il link condiviso non nasce tagliato', () => {
  let radice: HTMLElement;
  let root: Root;
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    radice.remove();
    document.body.innerHTML = '';
  });

  /** Apre la finestra di condivisione e restituisce i link /shared-cart scritti nel messaggio. */
  async function linkDelMessaggio(righe: number) {
    const { default: ShareCartButton } = await import('@/components/ShareCartButton');
    const items = Array.from({ length: righe }, (_, n) => ({
      id: finto(n + 1), name: `Prodotto ${n + 1}`, price: 1, quantity: 1, sellerId: 'neg', storeName: 'Forno',
    }));
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    radice = document.createElement('div');
    document.body.appendChild(radice);
    await act(async () => {
      root = createRoot(radice);
      root.render(createElement(ShareCartButton as never, { items }));
    });
    const apri = [...radice.querySelectorAll('button')].find((b) => /Condividi la lista/.test(b.textContent ?? ''));
    expect(apri).toBeDefined();
    await act(async () => { apri!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    const wa = document.querySelector('a[href^="https://wa.me/"]') as HTMLAnchorElement | null;
    expect(wa, 'manca il pulsante WhatsApp').not.toBeNull();
    const testo = decodeURIComponent(new URL(wa!.href).searchParams.get('text') ?? '');
    const link = testo.match(/https?:\/\/\S+\/shared-cart\?cart=\S+/g) ?? [];
    return { items, link };
  }

  it('60 righe: ogni link ne porta al massimo 50, e insieme le portano tutte', async () => {
    const { items, link } = await linkDelMessaggio(60);
    expect(link.length).toBeGreaterThan(0);
    const viste: string[] = [];
    for (const l of link) {
      const voci = (new URL(l).searchParams.get('cart') ?? '').split(',').filter(Boolean);
      expect(voci.length, 'un link con più di 50 righe arriva già tagliato').toBeLessThanOrEqual(50);
      viste.push(...voci.map((v) => v.split(':')[0]));
    }
    expect(viste.sort()).toEqual(items.map((i) => i.id).sort());
  });

  it('una lista corta resta un link solo, come prima', async () => {
    const { link } = await linkDelMessaggio(3);
    expect(link).toHaveLength(1);
  });
});
