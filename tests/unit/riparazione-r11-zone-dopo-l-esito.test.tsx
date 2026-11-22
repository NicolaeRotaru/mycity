/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

/**
 * R11-005 — Le zone preferite si spuntano dopo l'esito del salvataggio, e se la scrittura cade la
 * riga fissa in fondo non dice «salvate».
 *
 * saveZones() faceva setZones(next) prima dell'esito e non tornava indietro: il toast d'errore
 * spariva, la zona restava spuntata e la riga diceva «Le preferenze sono salvate sul tuo profilo».
 */

type Esito = { data: unknown; error: { message: string } | null };
type Op = { azione: string; valori?: unknown };
const stato: { scrittura: () => Promise<Esito>; ops: Op[]; toast: string[] } = {
  scrittura: async () => ({ data: null, error: null }),
  ops: [],
  toast: [],
};

function costruttore() {
  const op: Op = { azione: 'select' };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) q[m] = () => q;
  q.update = (v: unknown) => { op.azione = 'update'; op.valori = v; return q; };
  q.single = async () => ({ data: { rider_is_online: false, rider_schedule: null, rider_zones: [] }, error: null });
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    stato.ops.push({ ...op });
    return stato.scrittura().then(ok, ko);
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from: () => costruttore(),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => ({
  toast: {
    success: (t: string) => { stato.toast.push(`success:${t}`); },
    error: (t: string) => { stato.toast.push(`error:${t}`); },
  },
}));

async function aspetta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

beforeEach(() => {
  stato.scrittura = async () => ({ data: null, error: null });
  stato.ops = [];
  stato.toast = [];
});

async function monta() {
  const { default: Pagina } = await import('@/app/rider/availability/page');
  const s = accendi(() => createElement(Pagina as ComponentType));
  await aspetta();
  const zona = (nome: string) =>
    Array.from(s.radice.querySelectorAll('button[aria-pressed]')).find((b) => b.textContent?.includes(nome)) as HTMLElement;
  const tocca = (nome: string) => s.agisci(() => zona(nome).dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  return { s, zona, tocca };
}

describe('R11-005 — le zone dopo l esito', () => {
  it('con la scrittura in errore la zona non resta spuntata e la scritta non dice «salvate»', async () => {
    stato.scrittura = async () => ({ data: null, error: { message: 'rete giù' } });
    const { s, zona, tocca } = await monta();
    expect(zona('Stazione'), 'controprova: la zona si deve vedere').toBeTruthy();
    tocca('Stazione');
    await aspetta();
    expect(stato.toast.some((t) => t.startsWith('error:'))).toBe(true);
    expect(zona('Stazione').getAttribute('aria-pressed')).toBe('false');
    const testo = s.radice.textContent ?? '';
    expect(testo).not.toMatch(/sono salvate sul tuo profilo/);
    expect(testo).toMatch(/non (è|sono) stat[oie] salvat/i);
    expect(testo).toMatch(/riprova/i);
    s.smonta();
  });

  it('con la scrittura ok la zona è spuntata e la scritta dice «salvate»', async () => {
    const { s, zona, tocca } = await monta();
    tocca('Stazione');
    await aspetta();
    expect(zona('Stazione').getAttribute('aria-pressed')).toBe('true');
    expect(s.radice.textContent).toMatch(/sono salvate sul tuo profilo/);
    s.smonta();
  });

  it('dopo un errore si può riprovare e la scritta torna a «salvate»', async () => {
    stato.scrittura = async () => ({ data: null, error: { message: 'rete giù' } });
    const { s, zona, tocca } = await monta();
    tocca('Stazione');
    await aspetta();
    stato.scrittura = async () => ({ data: null, error: null });
    tocca('Stazione');
    await aspetta();
    expect(zona('Stazione').getAttribute('aria-pressed')).toBe('true');
    expect(s.radice.textContent).toMatch(/sono salvate sul tuo profilo/);
    s.smonta();
  });

  it('due zone toccate in fila non si perdono a vicenda', async () => {
    stato.scrittura = () => new Promise((r) => setTimeout(() => r({ data: null, error: null }), 5));
    const { s, zona, tocca } = await monta();
    tocca('Stazione');
    tocca('Centro storico');
    await aspetta();
    expect(zona('Stazione').getAttribute('aria-pressed')).toBe('true');
    expect(zona('Centro storico').getAttribute('aria-pressed')).toBe('true');
    const ultima = stato.ops.filter((o) => o.azione === 'update').pop()!.valori as { rider_zones: string[] };
    expect([...ultima.rider_zones].sort()).toEqual(['Centro storico', 'Stazione']);
    s.smonta();
  });
});
