// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna, aspetta } from './aiuti/cabina-admin';

/**
 * R09-015 — Un link lungo incollato dal cliente faceva scorrere di lato la pagina sul telefono; oltre
 * 100 reclami il conteggio si fermava a 100 senza dirlo; le etichette mescolavano buyer e seller.
 * R09-005 — La pagina decide scheletro, errore e vuoto col presidio comune (vistaDaQuery).
 * (Banco di prova copiato da minori-s05-reclami-pagina.test.tsx.)
 */
import { readFileSync } from 'node:fs';

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

describe('R09-015 · la pagina dei reclami sul telefono e oltre i 100', () => {
  it('la descrizione va a capo anche dentro un link lungo', async () => {
    const link = 'https://esempio.it/' + 'a'.repeat(120);
    stato.reclami = [{ ...reclamo('a', 'cliente-1', 'Mario'), description: `Guardate qui ${link}` }];
    const host = await apri();
    const p = [...host.querySelectorAll('p')].find((x) => x.textContent?.includes(link));
    expect(p?.className).toMatch(/break-words/);
    expect(p?.className).toMatch(/\[overflow-wrap:anywhere\]/);
  });

  it('con 100 reclami caricati la pagina dice che ce ne sono altri', async () => {
    stato.reclami = Array.from({ length: 100 }, (_, i) => reclamo(`r${i}`, `cliente-${i}`, `Cliente ${i}`));
    const host = await apri();
    expect(host.textContent).toContain('Vedi i 100 reclami più recenti');
  });

  it('con meno di 100 reclami nessun avviso', async () => {
    stato.reclami = Array.from({ length: 3 }, (_, i) => reclamo(`r${i}`, `cliente-${i}`, `Cliente ${i}`));
    const host = await apri();
    expect(host.textContent).not.toContain('reclami più recenti');
  });

  it('le etichette sono in italiano: cliente e venditore, non buyer e seller', async () => {
    stato.reclami = [reclamo('a', 'cliente-1', 'Mario')];
    const host = await apri();
    expect(host.textContent).toContain('Risolto a favore del cliente');
    expect(host.textContent).not.toMatch(/\bbuyer\b|\bseller\b/i);
    const s = readFileSync('app/admin/disputes/page.tsx', 'utf8');
    expect(s).not.toMatch(/A favore (buyer|seller)/);
    expect(host.textContent).not.toMatch(/\bvs\b|\bauto\b/);
    expect(s).not.toContain('Min 10 caratteri');
    // La data del reclamo è quella di Piacenza, come le altre ore del sito.
    expect(s).toContain("toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })");
  });
});

describe('R09-005 · la pagina dei reclami usa il presidio comune', () => {
  it('scheletro, errore e vuoto vengono da vistaDaQuery', () => {
    const s = readFileSync('app/admin/disputes/page.tsx', 'utf8');
    expect(s).toMatch(/vistaDaQuery\(query\)/);
    expect(s).toMatch(/vista\.mostraScheletro/);
    expect(s).toMatch(/vista\.mostraVuoto/);
  });

  it('la lettura caduta mostra l’errore, non «nessun reclamo»', async () => {
    stato.reclami = null;
    const host = await apri();
    await aspetta(10);
    expect(host.textContent).toContain('Non riesco a leggere i reclami');
    expect(host.textContent).not.toContain('Nessun reclamo in questo stato');
  });
});
