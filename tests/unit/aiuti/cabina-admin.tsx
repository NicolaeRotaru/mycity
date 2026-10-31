/**
 * Attrezzi per le prove che APRONO le pagine della cabina admin in un browser finto (jsdom).
 *
 * ① `fake`: un client Supabase finto e incatenabile. Ogni domanda (tabella, filtri, scrittura)
 *    finisce in `fake.domande`, e la risposta la decide la prova con `fake.rispondi`.
 * ② `disegna`: monta una pagina dentro un vero QueryClientProvider (React Query vero, senza
 *    tentativi ripetuti) e aspetta che le letture finiscano.
 * ③ `paginaPer`: dato un indirizzo come `/admin/orders/<id>`, cerca nella cartella `app/` la
 *    pagina che Next.js aprirebbe — con le stesse regole: cartelle esatte, segmenti `[id]`,
 *    gruppi `(x)`. Se non c'è, torna `null`: è il «pagina non trovata» che vedeva l'admin.
 *
 * I `vi.mock` restano nei file di prova (lì vengono sollevati); qui c'è solo l'attrezzatura.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Domanda = {
  tabella: string;
  op: 'select' | 'update' | 'insert' | 'rpc';
  filtri: Record<string, unknown>;
  valori: unknown;
  una: boolean;
};
export type Risposta = { data: unknown; error: unknown };

function creaFake() {
  const stato = {
    domande: [] as Domanda[],
    rispondi: ((_q: Domanda): Risposta => ({ data: [], error: null })) as (q: Domanda) => Risposta,
  };
  const costruisci = (tabella: string) => {
    const q: Domanda = { tabella, op: 'select', filtri: {}, valori: null, una: false };
    const b: Record<string, unknown> = {};
    const catena = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return b; };
    Object.assign(b, {
      select: catena(),
      order: catena(),
      limit: catena(),
      range: catena(),
      gte: catena(),
      eq: catena((c, v) => { q.filtri[String(c)] = v; }),
      in: catena((c, v) => { q.filtri[String(c)] = v; }),
      update: catena((v) => { q.op = 'update'; q.valori = v; }),
      insert: catena((v) => { q.op = 'insert'; q.valori = v; }),
      maybeSingle: catena(() => { q.una = true; }),
      single: catena(() => { q.una = true; }),
      then: (ok: (r: Risposta) => unknown, ko: (e: unknown) => unknown) => {
        stato.domande.push(q);
        return Promise.resolve().then(() => stato.rispondi(q)).then(ok, ko);
      },
    });
    return b;
  };
  return Object.assign(stato, {
    from: (t: string) => costruisci(t),
    rpc: (nome: string) => {
      const q: Domanda = { tabella: nome, op: 'rpc', filtri: {}, valori: null, una: false };
      stato.domande.push(q);
      return Promise.resolve().then(() => stato.rispondi(q));
    },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-0000000000ad' } } }),
    },
    azzera() {
      stato.domande.length = 0;
      stato.rispondi = () => ({ data: [], error: null });
    },
  });
}

export const fake = creaFake();

export async function aspetta(giri = 6): Promise<void> {
  for (let i = 0; i < giri; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

export async function disegna(el: ReactElement): Promise<{ host: HTMLElement; chiudi: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, el));
  });
  await aspetta();
  return {
    host,
    chiudi: () => {
      act(() => root?.unmount());
      host.remove();
      client.clear();
    },
  };
}

/** Cambia il valore di un campo come lo cambia una persona, così React se ne accorge. */
export async function scrivi(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, valore: string): Promise<void> {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(el, valore);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export function paginaPer(indirizzo: string): { file: string; params: Record<string, string> } | null {
  const pezzi = new URL(indirizzo, 'http://cabina.test').pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const cerca = (dir: string, i: number, params: Record<string, string>): { file: string; params: Record<string, string> } | null => {
    const cartelle = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const gruppi = cartelle.filter((n) => /^\(.+\)$/.test(n));
    if (i === pezzi.length) {
      for (const f of ['page.tsx', 'page.ts', 'page.jsx', 'page.js']) {
        if (existsSync(join(dir, f))) return { file: join(dir, f), params };
      }
      for (const g of gruppi) { const r = cerca(join(dir, g), i, params); if (r) return r; }
      return null;
    }
    const pezzo = pezzi[i];
    if (cartelle.includes(pezzo)) { const r = cerca(join(dir, pezzo), i + 1, params); if (r) return r; }
    for (const n of cartelle) {
      const m = /^\[([^.\]]+)\]$/.exec(n);
      if (m) { const r = cerca(join(dir, n), i + 1, { ...params, [m[1]]: pezzo }); if (r) return r; }
    }
    for (const g of gruppi) { const r = cerca(join(dir, g), i, params); if (r) return r; }
    return null;
  };
  return cerca(join(process.cwd(), 'app'), 0, {});
}
