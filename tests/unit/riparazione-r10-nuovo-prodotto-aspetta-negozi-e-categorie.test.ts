// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

/**
 * R10-011 — Nel nuovo prodotto dell'amministrazione il modulo restava attivo anche quando
 * l'elenco dei negozi o quello delle categorie stava ancora arrivando, o non era arrivato: si
 * poteva premere «Pubblica» e l'invio partiva (o cadeva con un errore generico) senza che la
 * pagina dicesse perché. Ora, finché negozi e categorie non sono arrivati, il modulo non invia
 * e la pagina lo dice; se la lettura è caduta c'è «Riprova».
 *
 * Il modulo vero è grande (foto, varianti, AI): qui c'è un modulo finto con un solo pulsante
 * d'invio, spento quando la pagina dice `submitting` come quello vero. Si preme e si guarda se
 * parte la richiesta al server.
 */
type Stato = 'ok' | 'giu' | 'in-arrivo';
const mondo = vi.hoisted(() => ({ negozi: 'ok' as 'ok' | 'giu' | 'in-arrivo', categorie: 'ok' as 'ok' | 'giu' | 'in-arrivo' }));

vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/components/products/ImportFromUrlBox', () => ({ default: () => null }));
vi.mock('@/components/seller/ProductForm', () => ({
  default: (p: { submitting?: boolean; onSubmit: (payload: unknown, ctx: { variants: unknown[] }) => unknown }) =>
    createElement('form', {
      'data-modulo': '1',
      onSubmit: (e: Event) => { e.preventDefault(); void p.onSubmit({ name: 'Focaccia' }, { variants: [] }); },
    }, createElement('button', { type: 'submit', disabled: p.submitting }, 'Pubblica prodotto')),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (tavola: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) c[m] = () => c;
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const stato: Stato = tavola === 'profiles' ? mondo.negozi : mondo.categorie;
        if (stato === 'in-arrivo') return new Promise(() => {});
        if (stato === 'giu') return Promise.resolve({ data: null, error: { message: 'Failed to fetch', code: '' } }).then(ok, ko);
        const dati = tavola === 'profiles'
          ? [{ id: 'n1', store_name: 'Pane Quotidiano', offers_express: false }]
          : [{ id: 'c1', name: 'Pane', slug: 'pane', parent_id: null }];
        return Promise.resolve({ data: dati, error: null }).then(ok, ko);
      };
      return c;
    },
  },
}));

const { default: Pagina } = await import('@/app/admin/products/new/page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let qcAttuale: QueryClient;
let c: HTMLDivElement;
const invii: string[] = [];
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function monta(negozi: Stato, categorie: Stato) {
  mondo.negozi = negozi;
  mondo.categorie = categorie;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qcAttuale = qc;
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))));
  for (let i = 0; i < 6; i++) await pausa();
}

/** Sceglie il negozio (se la tendina c'è e lo offre) e preme «Pubblica prodotto». */
async function scegliEPubblica() {
  const tendina = c.querySelector('select') as HTMLSelectElement | null;
  if (tendina && tendina.querySelector('option[value="n1"]')) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(tendina, 'n1');
      tendina.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  const pubblica = [...c.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Pubblica prodotto')) as HTMLButtonElement;
  expect(pubblica, 'il pulsante «Pubblica prodotto» non c’è').toBeTruthy();
  await act(async () => { pubblica.click(); });
  for (let i = 0; i < 4; i++) await pausa();
}

beforeEach(() => {
  invii.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    invii.push(String(url));
    return { ok: true, json: async () => ({ data: { id: 'p-nuovo' } }) };
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

describe('R10-011 · nuovo prodotto: il modulo aspetta negozi e categorie', () => {
  it('con negozi e categorie arrivati, «Pubblica» invia (la prova guarda qualcosa)', async () => {
    await monta('ok', 'ok');
    await scegliEPubblica();
    expect(invii).toEqual(['/api/admin/products']);
  });

  it('mentre i negozi stanno arrivando il modulo non invia, e la pagina lo dice', async () => {
    await monta('in-arrivo', 'ok');
    await scegliEPubblica();
    expect(invii, 'il modulo ha inviato prima che arrivassero i negozi').toEqual([]);
    expect(c.textContent).toMatch(/si potrà salvare|non si può salvare/);
  });

  it('mentre le categorie stanno arrivando il modulo non invia, e la pagina lo dice', async () => {
    await monta('ok', 'in-arrivo');
    await scegliEPubblica();
    expect(invii, 'il modulo ha inviato prima che arrivassero le categorie').toEqual([]);
    expect(c.textContent).toMatch(/si potrà salvare|non si può salvare/);
  });

  it('se le categorie non arrivano il modulo non invia, lo dice e offre «Riprova»', async () => {
    await monta('ok', 'giu');
    await scegliEPubblica();
    expect(invii, 'il modulo ha inviato senza le categorie').toEqual([]);
    expect(c.textContent).toMatch(/non si può salvare/);
    expect([...c.querySelectorAll('button')].some((b) => /riprova/i.test(b.textContent ?? ''))).toBe(true);
  });

  it('se i negozi non arrivano il modulo non invia, lo dice e offre «Riprova»', async () => {
    await monta('giu', 'ok');
    await scegliEPubblica();
    expect(invii, 'il modulo ha inviato senza i negozi').toEqual([]);
    expect(c.textContent).toMatch(/non si può salvare/);
    expect([...c.querySelectorAll('button')].some((b) => /riprova/i.test(b.textContent ?? ''))).toBe(true);
  });
  it('senza rete (letture in pausa, senza dati) il modulo resta spento e la pagina dice che aspetta', async () => {
    onlineManager.setOnline(false);
    try {
      await monta('ok', 'ok');
      const fieldset = c.querySelector('fieldset') as HTMLFieldSetElement;
      expect(fieldset, 'il modulo non è dentro il fieldset').toBeTruthy();
      expect(fieldset.disabled, 'senza rete il modulo si è acceso senza negozi né categorie').toBe(true);
      expect(c.textContent).toMatch(/si potrà salvare/);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('se una rilettura in sottofondo cade con i dati già in mano, il modulo resta acceso e invia', async () => {
    await monta('ok', 'ok');
    const fieldset = c.querySelector('fieldset') as HTMLFieldSetElement;
    expect(fieldset.disabled, 'con i dati arrivati il modulo dovrebbe essere acceso').toBe(false);
    // A metà compilazione negozi e categorie si rileggono e la rilettura cade.
    mondo.negozi = 'giu';
    mondo.categorie = 'giu';
    await act(async () => { await qcAttuale.refetchQueries(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect((c.querySelector('fieldset') as HTMLFieldSetElement).disabled, 'una rilettura caduta ha spento il modulo con i dati in mano').toBe(false);
    expect(c.textContent).not.toMatch(/non si può salvare/);
    await scegliEPubblica();
    expect(invii).toEqual(['/api/admin/products']);
  });
});
