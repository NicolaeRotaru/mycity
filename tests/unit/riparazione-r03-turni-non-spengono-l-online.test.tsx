/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

/**
 * R03-015 — Salvando i turni il fattorino non torna offline senza saperlo, e «Preferenze
 * salvate» compare solo dopo un salvataggio riuscito.
 *
 * save() scriveva insieme rider_is_online (letto all'apertura della pagina) e rider_schedule, e
 * mostrava il successo subito. Anna apre i Turni alle 9 da offline, alle 9:05 va online dalla
 * bacheca, alle 9:10 cambia un turno nella scheda rimasta aperta: tornava offline. Banco preso
 * da minori-s08-profilo.test.tsx (Supabase finto).
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

const ANNA = { rider_is_online: false, rider_schedule: null, rider_zones: [] };

beforeEach(() => {
  stato.esiti = {};
  stato.ops = [];
  stato.toast = [];
});

async function cambiaUnTurno(esitoScrittura: Esito) {
  stato.esiti.profiles = (op) => (op.azione === 'select' ? { data: ANNA, error: null } : esitoScrittura);
  const { default: Pagina } = await import('@/app/rider/availability/page');
  const s = accendi(() => createElement(Pagina as ComponentType));
  await aspetta();
  const dalle = Array.from(s.radice.querySelectorAll('input[type="time"]')).find((i) => !(i as HTMLInputElement).disabled) as HTMLInputElement;
  expect(dalle, 'controprova: un orario modificabile si deve vedere').toBeTruthy();
  s.agisci(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(dalle, '10:00');
    dalle.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await aspetta();
  s.smonta();
  return stato.ops.filter((o) => o.tabella === 'profiles' && o.azione === 'update').map((o) => o.valori as Record<string, unknown>);
}

describe('R03-015 — i turni non toccano l interruttore online', () => {
  it('cambiare un turno scrive solo i turni, non rider_is_online (che la bacheca può aver acceso)', async () => {
    const scritte = await cambiaUnTurno({ data: null, error: null });
    expect(scritte.length).toBeGreaterThan(0);
    for (const v of scritte) {
      expect(v, 'il salvataggio dei turni rimette offline il fattorino').not.toHaveProperty('rider_is_online');
      expect(v).toHaveProperty('rider_schedule');
    }
  });

  it('se la scrittura cade non compare nessun «Preferenze salvate»', async () => {
    stato.esiti.profiles = () => ({ data: null, error: { message: 'rete giù' } });
    const { default: Pagina } = await import('@/app/rider/availability/page');
    stato.esiti.profiles = (op) => (op.azione === 'select' ? { data: ANNA, error: null } : { data: null, error: { message: 'rete giù' } });
    const s = accendi(() => createElement(Pagina as ComponentType));
    await aspetta();
    const interruttore = s.radice.querySelector('[role="switch"]') as HTMLElement;
    expect(interruttore, 'controprova: l interruttore online si deve vedere').toBeTruthy();
    s.agisci(() => interruttore.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await aspetta();
    expect(stato.toast.map((t) => t.tipo), 'il successo compare prima dell esito').not.toContain('success');
    expect(stato.toast.map((t) => t.tipo)).toContain('error');
    s.smonta();
  });
});
