/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { conNegozioApprovato } from '@/lib/queries/seller-public-profiles';
import { chiaveVetrinaNegozio, lettoreNegoziConMemoria, MEMORIA_VETRINA_MS } from '@/lib/queries/vetrina-con-memoria';
import { leggiNegozioDelMese } from '@/lib/queries/negozio-del-mese';
import { leggiTendenze } from '@/lib/queries/fasce-prodotti';

/**
 * R09-008 — In home ogni sezione chiedeva di nuovo alla vetrina lo stesso negozio.
 *
 * Le domande nello stesso istante si univano già (R06-009); ma la sezione che arriva DOPO che la
 * prima domanda è atterrata rifaceva il giro di rete prima di mostrarsi. Ora le sezioni della home
 * passano un lettore con la memoria di React Query della pagina (lib/queries/vetrina-con-memoria.ts):
 * voce per negozio e colonne, fresca per tre minuti.
 */

const PANE = { id: 'pane', store_name: 'Pane Quotidiano', store_logo: null, is_approved: true };
const LATTE = { id: 'latte', store_name: 'Latteria', store_logo: null, is_approved: true };

/** Una vetrina finta che conta le domande (una per chiamata a `.in`). */
function vetrina(righe: Array<Record<string, unknown>>) {
  const domande: string[][] = [];
  const client = {
    from: () => ({
      select: () => ({
        in: (_c: string, ids: string[]) => {
          domande.push([...ids]);
          return Promise.resolve({ data: righe.filter((r) => ids.includes(r.id as string)), error: null });
        },
      }),
    }),
  };
  return { client, domande };
}

afterEach(() => vi.useRealTimers());

describe('R09-008 — la vetrina si ricorda fra le sezioni della home', () => {
  it('la seconda sezione, arrivata dopo, trova i negozi in memoria: nessuna domanda nuova', async () => {
    const qc = new QueryClient();
    const { client, domande } = vetrina([PANE, LATTE]);
    const leggi = lettoreNegoziConMemoria(qc, client);

    const prima = await conNegozioApprovato(client, [{ seller_id: 'pane' }, { seller_id: 'latte' }], 'id, store_name', leggi);
    expect(prima).toHaveLength(2);
    // Stesse colonne in un altro ordine: è la stessa voce.
    const dopo = await conNegozioApprovato(client, [{ seller_id: 'pane' }], 'store_name, id', leggi);
    expect(dopo[0]?.profiles.store_name).toBe('Pane Quotidiano');
    expect(domande, 'la sezione arrivata dopo rifà il giro di rete').toEqual([['pane', 'latte']]);
  });

  it('chiede solo i negozi che mancano, e ricorda anche quelli che la vetrina non dà (non approvati)', async () => {
    const qc = new QueryClient();
    const { client, domande } = vetrina([PANE]);
    const leggi = lettoreNegoziConMemoria(qc, client);
    await leggi(['pane'], 'id, store_name');
    await leggi(['pane', 'sospeso'], 'id, store_name');
    await leggi(['sospeso', 'pane'], 'id, store_name');
    expect(domande).toEqual([['pane'], ['sospeso']]);
    expect(qc.getQueryData(chiaveVetrinaNegozio('id, store_name', 'sospeso'))).toBeNull();
  });

  it('dopo tre minuti la voce è vecchia e si richiede', async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const { client, domande } = vetrina([PANE]);
    const leggi = lettoreNegoziConMemoria(qc, client);
    await leggi(['pane'], 'id, store_name');
    vi.advanceTimersByTime(MEMORIA_VETRINA_MS + 1);
    await leggi(['pane'], 'id, store_name');
    expect(domande).toEqual([['pane'], ['pane']]);
  });

  it('una lettura caduta risale a chi chiama e non lascia niente in memoria', async () => {
    const qc = new QueryClient();
    const client = { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'giù' } }) }) }) };
    await expect(lettoreNegoziConMemoria(qc, client)(['pane'], 'id, store_name')).rejects.toBeTruthy();
    expect(qc.getQueryState(chiaveVetrinaNegozio('id, store_name', 'pane'))).toBeUndefined();
  });

  it('il negozio del mese e le tendenze usano il lettore passato dalla home', async () => {
    const qc = new QueryClient();
    const { client, domande } = vetrina([PANE, LATTE]);
    const leggi = lettoreNegoziConMemoria(qc, client);
    await leggi(['pane', 'latte'], 'id, store_name, store_logo');
    await leggi(['pane', 'latte'], 'id, store_name, is_approved');
    const domandePrima = domande.length;

    const supa = {
      from: (tabella: string) => {
        if (tabella === 'shop_of_month') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's', month: 'm', seller_id: 'pane' }, error: null }) }) }) };
        }
        if (tabella === 'products') {
          return { select: () => ({ in: () => ({ eq: async () => ({ data: [{ id: 'p1', name: 'Pane', price: 3, images: null, seller_id: 'latte' }], error: null }) }) }) };
        }
        return client.from();
      },
      rpc: async () => ({ data: [{ product_id: 'p1', view_count: 9 }], error: null }),
    };
    const delMese = await leggiNegozioDelMese(supa as never, 'm', leggi);
    expect(delMese?.seller?.store_name).toBe('Pane Quotidiano');
    const tendenze = await leggiTendenze(supa as never, leggi);
    expect(tendenze.map((t) => t.product.profiles?.store_name)).toEqual(['Latteria']);
    expect(domande.length, 'le due sezioni hanno richiesto negozi già in memoria').toBe(domandePrima);
  });

  it.each([
    ['components/home/DropOfDay.tsx', /conNegozioApprovato\(supabase, \[letto\.product\], 'id, store_name', leggiNegozi\)/],
    ['components/home/StoriesCarousel.tsx', /conNegozioApprovato\(supabase, storie, 'id, store_name, store_logo', leggiNegozi\)/],
    ['components/home/TrendingNow.tsx', /leggiTendenze\(supabase, leggiNegozi\)/],
    ['components/home/ShopOfMonthHero.tsx', /leggiNegozioDelMese\(supabase, primoDelMesePiacenza\(\), leggiNegozi\)/],
  ])('%s legge i negozi col lettore con memoria', (f, chiamata) => {
    const src = readFileSync(join(__dirname, '..', '..', f), 'utf8');
    expect(src).toMatch(/const leggiNegozi = lettoreNegoziConMemoria\(useQueryClient\(\), supabase\);/);
    expect(src).toMatch(chiamata);
  });
});
