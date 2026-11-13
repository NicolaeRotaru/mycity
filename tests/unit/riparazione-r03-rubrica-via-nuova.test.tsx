/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi, clicca } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * R03-014 — Cambiando la via di un indirizzo salvato, se la ricerca della posizione non
 * risponde non restano le coordinate della via vecchia.
 *
 * Anna aveva «Via Roma 1, Piacenza» con la sua posizione; trasloca in «Strada Agazzana 120» e
 * la ricerca non trova la via nuova. Prima si salvava la via nuova con le coordinate di Via
 * Roma: le rotte d'ordine le prendevano per buone e il fattorino andava alla casa vecchia.
 * Ora le coordinate si azzerano quando cambia il testo, e il cliente legge che la posizione
 * non è stata trovata. Banco preso da minori-s08-profilo.test.tsx (react-query vero).
 */

type Esito = { data: unknown; error: { message: string } | null };
type Op = { tabella: string; azione: string; valori?: unknown; filtri: Array<[string, unknown]> };
const stato: {
  esiti: Record<string, (op: Op) => Esito>;
  ops: Op[];
  toast: Array<{ tipo: string; testo: string }>;
  spinte: string[];
} = { esiti: {}, ops: [], toast: [], spinte: [] };

function costruttore(tabella: string) {
  const op: Op = { tabella, azione: 'select', filtri: [] };
  const esito = () => (stato.esiti[tabella] ?? (() => ({ data: [], error: null })))(op);
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'or']) q[m] = () => q;
  q.eq = (c: string, v: unknown) => { op.filtri.push([`eq:${c}`, v]); return q; };
  q.neq = (c: string, v: unknown) => { op.filtri.push([`neq:${c}`, v]); return q; };
  q.insert = (v: unknown) => { op.azione = 'insert'; op.valori = v; return q; };
  q.update = (v: unknown) => { op.azione = 'update'; op.valori = v; return q; };
  q.delete = () => { op.azione = 'delete'; return q; };
  q.single = async () => { stato.ops.push({ ...op }); return esito(); };
  q.maybeSingle = q.single;
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    stato.ops.push({ ...op });
    return Promise.resolve(esito()).then(ok, ko);
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
  const rotta = { push: (u: string) => { stato.spinte.push(u); }, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
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
vi.mock('sonner', () => {
  const r = (tipo: string) => (testo: string) => { stato.toast.push({ tipo, testo }); };
  return { toast: { success: r('success'), error: r('error'), info: r('info') } };
});
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {}, trackReferralSent: () => {} }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  INVITI_E_PUNTI_ACCESI: true,
  CLASSIFICA_INVITI_ACCESA: true,
}));


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

beforeEach(() => {
  stato.esiti = {};
  stato.ops = [];
  stato.toast = [];
  stato.spinte = [];
  (globalThis as Record<string, unknown>).fetch = async () => new Response(JSON.stringify({ lat: null, lng: null }), { status: 200 });
});

const VIA_ROMA = { id: 'a-1', label: 'Casa', full_name: 'Anna', phone: '3', address: 'Via Roma 1', city: 'Piacenza', zip: '29121', notes: null, lat: 45.0517, lng: 9.699, is_default: true };

async function modificaESalva(nuovaVia: string | null) {
  stato.esiti.user_addresses = (op) => (op.azione === 'select' ? { data: [VIA_ROMA], error: null } : { data: null, error: null });
  const { default: Pagina } = await import('@/app/profile/addresses/page');
  const s = accendi(conQuery(Pagina as ComponentType));
  await aspetta();
  const modifica = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('edit'))!;
  s.agisci(() => clicca(modifica));
  await aspetta();
  if (nuovaVia) {
    const via = Array.from(s.radice.querySelectorAll('input')).find((i) => (i as HTMLInputElement).value === 'Via Roma 1') as HTMLInputElement;
    s.agisci(() => {
      const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      imposta.call(via, nuovaVia);
      via.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await aspetta();
  }
  const form = s.radice.querySelector('form')!;
  s.agisci(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await aspetta();
  s.smonta();
  return stato.ops.find((o) => o.azione === 'update' && (o.valori as { address?: string })?.address)?.valori as Record<string, unknown>;
}

describe('R03-014 — la via nuova non tiene la posizione della vecchia', () => {
  it('via cambiata e posizione non trovata: si salvano coordinate vuote, non quelle di Via Roma', async () => {
    const scritto = await modificaESalva('Strada Agazzana 120');
    expect(scritto.address).toBe('Strada Agazzana 120');
    expect(scritto.lat, 'restano le coordinate della via vecchia').toBeNull();
    expect(scritto.lng).toBeNull();
    expect(stato.toast.some((t) => /posizione/i.test(t.testo)), 'il cliente non sa che la posizione manca').toBe(true);
  });

  it('stesso indirizzo (cambia solo il resto): le coordinate restano', async () => {
    const scritto = await modificaESalva(null);
    expect(scritto.lat).toBe(45.0517);
    expect(scritto.lng).toBe(9.699);
  });
});
