/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';

/**
 * R03-017 — Se il fattorino cambia solo il nome nel profilo, il telefono non si cancella (e
 * viceversa).
 *
 * I campi a video si riempivano dal profilo (defaultValue) ma gli stati salvati partivano vuoti
 * e il salvataggio scriveva sempre { full_name, phone }: chi correggeva il telefono mandava il
 * nome vuoto, e la consolle SOS mostrava un fattorino senza nome. Banco preso da
 * minori-s08-profilo.test.tsx (react-query vero, Supabase finto).
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
  return { toast: { success: r('success'), error: r('error'), info: r('info'), warning: r('warning') } };
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

vi.mock('@/components/PushNotificationOptIn', () => ({ default: () => null }));

const MARIO = { id: 'u-1', full_name: 'Mario Rossi', phone: '3331234567', email: 'mario@example.com', rider_vehicle_type: 'BIKE' };

beforeEach(() => {
  stato.esiti = {};
  stato.ops = [];
  stato.toast = [];
  stato.esiti.profiles = (op) => (op.azione === 'select' ? { data: MARIO, error: null } : { data: null, error: null });
});

async function apri() {
  const { default: Pagina } = await import('@/app/rider/profile/page');
  const s = accendi(conQuery(Pagina as ComponentType));
  await aspetta();
  const campo = (etichetta: string) => {
    const l = Array.from(s.radice.querySelectorAll('label')).find((x) => (x.textContent ?? '').startsWith(etichetta))!;
    return (l.getAttribute('for') ? document.getElementById(l.getAttribute('for')!) : l.querySelector('input')) as HTMLInputElement;
  };
  const scrivi = (el: HTMLInputElement, valore: string) => s.agisci(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, valore);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const salva = async () => {
    const b = Array.from(s.radice.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === 'save')!;
    s.agisci(() => b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await aspetta();
  };
  return { s, campo, scrivi, salva };
}

const scritture = () => stato.ops.filter((o) => o.tabella === 'profiles' && o.azione === 'update').map((o) => o.valori as Record<string, unknown>);

describe('R03-017 — il profilo del fattorino scrive solo quello che cambia', () => {
  it('cambio solo il telefono: il nome non parte vuoto', async () => {
    const { s, campo, scrivi, salva } = await apri();
    expect(campo('Nome e cognome').value).toBe('Mario Rossi');
    scrivi(campo('Telefono'), '3339999999');
    await salva();
    expect(scritture()).toHaveLength(1);
    expect(scritture()[0], 'il nome si cancella').not.toHaveProperty('full_name');
    expect(scritture()[0].phone).toBe('3339999999');
    s.smonta();
  });

  it('«Salva» senza toccare niente non svuota nome e telefono', async () => {
    const { s, salva } = await apri();
    await salva();
    expect(scritture(), 'i due campi partono vuoti').toHaveLength(0);
    s.smonta();
  });

  it('il nome cancellato non si salva vuoto', async () => {
    const { s, campo, scrivi, salva } = await apri();
    scrivi(campo('Nome e cognome'), '   ');
    await salva();
    expect(scritture()).toHaveLength(0);
    expect(stato.toast.map((t) => t.tipo)).toContain('error');
    s.smonta();
  });
});
