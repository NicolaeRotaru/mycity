// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, aspetta } from './aiuti/cabina-admin';

/**
 * S05 · schede 1812, 1815, 1820, 1819, 337, 1823 — pagina Reclami dell'admin.
 */

const stato = vi.hoisted(() => ({
  reclami: [] as unknown[] | null,
  ordiniErrore: false,
}));
function catena(tabella: string): unknown {
  const risposta = () =>
    tabella === 'disputes'
      ? (stato.reclami === null ? { data: null, error: { message: 'giù' } } : { data: stato.reclami, error: null })
      : stato.ordiniErrore ? { data: null, error: { message: 'giù', code: 'PGRST000' } } : { data: [], error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => catena(t), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

function reclamo(id: string, opener: string, nome: string | null, status = 'open') {
  return {
    id, order_id: `ord-${id}-0000`, opener_id: opener, reason: 'altro', description: 'x', status,
    resolution_notes: null, refund_cents: null, created_at: '2026-11-01T10:00:00Z',
    opener: { full_name: nome }, against: { store_name: 'Forno', full_name: null },
  };
}

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; stato.ordiniErrore = false; });

async function apri() {
  const mod = (await import('@/app/admin/disputes/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('pagina Reclami', () => {
  it('1815: due clienti omonimi non diventano un solo «possibile abuso»', async () => {
    stato.reclami = [reclamo('a', 'cliente-1', 'Mario Rossi'), reclamo('b', 'cliente-2', 'Mario Rossi')];
    const host = await apri();
    expect(host.textContent).not.toMatch(/possibili abusi/);
  });

  it('1820: il segnale conta solo i reclami ancora aperti', async () => {
    stato.reclami = [reclamo('a', 'cliente-1', 'Mario', 'open'), reclamo('b', 'cliente-1', 'Mario', 'resolved_buyer')];
    const host = await apri();
    expect(host.textContent).not.toMatch(/2 reclami ancora aperti|2 reclami aperti/);
  });

  it('1815: chi non ha nome non è «Cliente» per tutti', async () => {
    stato.reclami = [reclamo('a', 'abcdef12-0000', null)];
    const host = await apri();
    expect(host.textContent).toContain('Cliente senza nome (abcdef12…)');
  });

  it('337: «Contatta le parti» non porta più alla casella vuota dell’admin', async () => {
    stato.reclami = [reclamo('a', 'cliente-1', 'Mario')];
    const host = await apri();
    expect(host.querySelector('a[href="/messages"]')).toBeNull();
    expect(host.querySelector('a[href="/admin/orders/ord-a-0000"]')).not.toBeNull();
  });

  it('1812: dopo una rilettura caduta i «Segnali di rischio» vecchi non restano sopra l’avviso', async () => {
    stato.reclami = [reclamo('a', 'cliente-1', 'Mario'), reclamo('b', 'cliente-1', 'Mario'), reclamo('c', 'cliente-2', 'Ugo')];
    const host = await apri();
    expect(host.textContent).toContain('Segnali di rischio');
    // La rilettura cade: React Query tiene i dati vecchi e alza isError.
    stato.reclami = null;
    const { focusManager } = await import('@tanstack/react-query');
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await aspetta();
    expect(host.textContent).toContain('Non riesco a leggere i reclami');
    expect(host.textContent).not.toContain('Segnali di rischio');
    focusManager.setFocused(undefined);
  });

  it('1823: i filtri dicono quale è attivo', async () => {
    stato.reclami = [];
    const host = await apri();
    const premuti = [...host.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);
    expect(premuti).toEqual(['Aperto']);
  });

  it('1819: se cade la lettura dei pagamenti, il riquadro lo dice invece di sparire', async () => {
    stato.reclami = [reclamo('a', 'cliente-1', 'Mario')];
    stato.ordiniErrore = true;
    const host = await apri();
    const decidi = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Decidi');
    await act(async () => { decidi?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    expect(document.body.textContent).toContain('Non riesco a leggere come ha pagato il cliente');
  });
});

describe('1823: assistenza e reclami, filtri e pulsanti spenti leggibili', () => {
  it('nessun disabled:opacity-50 (1,62:1) e filtri con aria-pressed nelle due pagine', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['app/admin/support/page.tsx', 'app/admin/disputes/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('disabled:opacity-50');
      expect(src, f).toContain('aria-pressed={filter === f}');
    }
  });
});
