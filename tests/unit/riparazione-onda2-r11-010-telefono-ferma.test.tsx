/**
 * @vitest-environment jsdom
 */
/**
 * R11-010 — Nessuna prova nel browser girava sullo schermo di un telefono, e sul telefono una era già
 * rossa.
 *
 * Il lavoro «e2e-telefono» (progetto mobile-safari) c'è dal 26/11 (lo controlla
 * riparazione-r01-prove-sul-telefono.test.ts), ma il suo passo aveva `continue-on-error: true` proprio
 * per la prova rossa: tests/e2e/03-cart-and-search.spec.ts, «search page renders with input», prendeva
 * con `.first()` il primo campo di ricerca della barra in alto, che sul telefono è quello nascosto del
 * computer. Un rosso sul telefono si vedeva ma non fermava niente.
 *
 * Adesso la prova cerca il campo per ruolo e nome (Playwright guarda solo gli elementi non nascosti,
 * quindi su ogni schermo trova quello che si vede), e il lavoro del telefono ferma «Main» come gli altri.
 * Qui: ① il lavoro non ha più `continue-on-error` e il riepilogo non dice più «non ferma»; ② la prova
 * della ricerca non prende più «il primo» campo; ③ i due campi della barra in alto sono davvero un
 * `searchbox` di nome «Cerca» (quello che la prova cerca), uno per schermo.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('next/link', async () => {
  const { createElement: crea } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ href, children }: { href: unknown; children?: unknown }) => crea('a', { href: String(href) }, children as never) };
});
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'or', 'ilike', 'order', 'limit', 'gt', 'gte', 'lte', 'is', 'not']) c[m] = () => c;
  c.then = (ok: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return { supabase: { from: () => c, rpc: async () => ({ data: [], error: null }) } };
});

const yaml = createRequire(import.meta.url)('js-yaml') as { load: (t: string) => unknown };
const RADICE = process.cwd();
const leggi = (f: string) => readFileSync(join(RADICE, f), 'utf8');

type Passo = { name?: string; run?: string; 'continue-on-error'?: unknown };
type Lavoro = { 'continue-on-error'?: unknown; steps: Passo[] };

describe('① il lavoro del telefono ferma la richiesta come gli altri', () => {
  const ci = yaml.load(leggi('.github/workflows/ci.yml')) as { jobs: Record<string, Lavoro> };
  const telefono = ci.jobs['e2e-telefono'];

  it('nessun continue-on-error, né sul lavoro né sui passi', () => {
    expect(telefono, 'manca il lavoro e2e-telefono').toBeTruthy();
    expect(telefono['continue-on-error'], 'il lavoro del telefono non ferma niente').toBeUndefined();
    for (const p of telefono.steps) {
      expect(p['continue-on-error'], `il passo «${p.name}» ha continue-on-error: un rosso sul telefono non ferma «Main»`).toBeUndefined();
    }
  });

  it('il riepilogo non dice più che il lavoro «non ferma la richiesta»', () => {
    const lancio = telefono.steps.find((p) => /--project=mobile-safari/.test(p.run ?? ''));
    expect(lancio?.run ?? '').not.toMatch(/non ferma la richiesta/);
  });
});

describe('② la prova della ricerca trova il campo che si vede, su ogni schermo', () => {
  const spec = leggi('tests/e2e/03-cart-and-search.spec.ts');
  const corpo = spec.match(/test\('search page renders with input'[\s\S]*?\n {2}\}\);/)?.[0] ?? '';

  it('non prende «il primo» campo di ricerca (sul telefono è quello nascosto del computer)', () => {
    expect(corpo, 'non trovo la prova «search page renders with input»').not.toBe('');
    const codice = corpo.replace(/\/\/[^\n]*/g, '');
    expect(codice).not.toMatch(/\.first\(\)|\.nth\(|input\[type="search"\]/);
    expect(codice).toMatch(/getByRole\('searchbox', \{ name: 'Cerca', exact: true \}\)/);
    expect(codice).toMatch(/toBeVisible\(\)/);
  });
});

describe('③ la barra in alto ha un campo «Cerca» per schermo, e la prova lo trova per ruolo e nome', () => {
  it('Navbar: un SearchBar nel blocco del computer (hidden md:block) e uno in quello del telefono (md:hidden)', () => {
    const navbar = leggi('components/Navbar.tsx');
    const computer = navbar.indexOf('<div className="hidden md:block">');
    const telefono = navbar.indexOf('<div className="md:hidden">');
    expect(computer).toBeGreaterThan(-1);
    expect(telefono).toBeGreaterThan(computer);
    const barre = [...navbar.matchAll(/<SearchBar\b/g)].map((m) => m.index ?? -1);
    expect(barre).toHaveLength(2);
    expect(barre[0]).toBeGreaterThan(computer);
    expect(barre[0]).toBeLessThan(telefono);
    expect(barre[1]).toBeGreaterThan(telefono);
  });

  it('SearchBar disegna un campo di ruolo searchbox (input search, senza list) di nome esatto «Cerca»', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const { default: SearchBar } = await import('@/components/SearchBar');
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(SearchBar, { placeholder: 'Cerca a Piacenza…' }))); });
    const campi = div.querySelectorAll('input');
    expect(campi).toHaveLength(1);
    const campo = campi[0];
    expect(campo.type).toBe('search');
    expect(campo.hasAttribute('list'), 'con «list» il ruolo diventa combobox e la prova non lo trova').toBe(false);
    expect(campo.getAttribute('role')).toBeNull();
    expect(campo.getAttribute('aria-label')).toBe('Cerca');
    await act(async () => { root.unmount(); });
    div.remove();
  });
});
