/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';

/**
 * R18-012 (la parte della pagina) — Un doppio clic veloce su «Crea promo» creava due promozioni
 * uguali: il bottone si spegne solo quando create.isPending arriva al disegno successivo, cioè
 * dopo il secondo clic. Se il negoziante ne cancellava una, l'altra continuava a scontare.
 * La parte del database sta in tests/sql/rls/riparazione-r18-promo-doppia.test.sql.
 */

type Op = { tabella: string; azione: string; valori?: unknown };
const stato: { ops: Op[]; erroreAlPrimoInsert: boolean } = { ops: [], erroreAlPrimoInsert: false };

function costruttore(tabella: string) {
  const op: Op = { tabella, azione: 'select' };
  const esito = () => {
    if (op.azione === 'insert' && stato.erroreAlPrimoInsert) {
      stato.erroreAlPrimoInsert = false;
      return { data: null, error: { message: 'Connessione caduta' } };
    }
    return op.azione === 'select' ? { data: [], error: null } : { data: null, error: null };
  };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'or', 'in', 'eq', 'neq']) q[m] = () => q;
  q.insert = (v: unknown) => { op.azione = 'insert'; op.valori = v; return q; };
  q.update = (v: unknown) => { op.azione = 'update'; op.valori = v; return q; };
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    stato.ops.push({ ...op });
    // La risposta arriva dopo un giro: come la rete vera, non nello stesso istante del clic.
    return new Promise((r) => setTimeout(r, 0)).then(esito).then(ok, ko);
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'anna@example.com' } }, error: null }) },
    from: (t: string) => costruttore(t),
  },
}));
vi.mock('next/navigation', () => {
  const rotta = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return ce('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));

async function aspetta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function conQuery(Pagina: ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Avvolta() {
    return createElement(QueryClientProvider, { client }, createElement(Pagina));
  };
}

const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(testo)) as HTMLButtonElement | undefined;
const clic = (b: HTMLButtonElement) => b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const inserimenti = () => stato.ops.filter((o) => o.tabella === 'seller_promotions' && o.azione === 'insert').length;

beforeEach(() => {
  stato.ops = [];
  stato.erroreAlPrimoInsert = false;
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function apriLaNuovaPromo() {
  const { default: Pagina } = await import('@/app/seller/promotions/page');
  const s = accendi(conQuery(Pagina as ComponentType));
  await aspetta();
  s.agisci(() => clic(pulsante('Nuova promo')!));
  await aspetta();
  s.agisci(() => clic(pulsante('-25%')!));
  await aspetta();
  return s;
}

describe('R18-012 — un doppio clic su «Crea promo» crea una promo sola', () => {
  it('due clic nello stesso istante: un solo inserimento', async () => {
    const s = await apriLaNuovaPromo();
    const crea = pulsante('Crea promo')!;
    s.agisci(() => {
      clic(crea);
      clic(crea);
    });
    await aspetta();
    expect(inserimenti(), 'il secondo clic ha creato una seconda promo uguale').toBe(1);
    s.smonta();
  });

  it('se la prima volta non riesce, il bottone si può premere di nuovo', async () => {
    stato.erroreAlPrimoInsert = true;
    const s = await apriLaNuovaPromo();
    s.agisci(() => clic(pulsante('Crea promo')!));
    await aspetta();
    expect(inserimenti()).toBe(1);
    s.agisci(() => clic(pulsante('Crea promo')!));
    await aspetta();
    expect(inserimenti(), 'dopo un errore il freno resta tirato e la promo non si crea più').toBe(2);
    s.smonta();
  });
});
