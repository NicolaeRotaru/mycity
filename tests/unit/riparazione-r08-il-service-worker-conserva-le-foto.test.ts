import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * R08-018 — il service worker faceva passare da sé le foto dei prodotti ma non ne
 * conservava nessuna.
 *
 * Le foto arrivano da <progetto>.supabase.co tramite un <img> senza `crossorigin`:
 * il browser le chiede in modalità no-cors e la risposta è OPACA (ok=false, stato 0).
 * La rete finta qui sotto fa esattamente questo, a differenza di quella della prova
 * del 6/9 che rispondeva sempre 200 — ed è per questo che il difetto non si vedeva.
 * Una domanda in modalità cors, invece, riceve la risposta vera (lo storage pubblico
 * risponde con CORS): 200 per una foto che c'è, 403/404 per una che non c'è.
 */
const SORGENTE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

type Rete = 'viva' | 'senza-cors' | 'morta';

function avvia(rete: Rete = 'viva') {
  const ascoltatori: Record<string, (e: unknown) => void> = {};
  const magazzino = new Map<string, Map<string, unknown>>();
  const chiamate: Array<{ url: string; mode: string }> = [];
  const chiave = (r: { url?: string } | string) => (typeof r === 'string' ? r : String(r.url));

  const opaca = () => ({ ok: false, status: 0, type: 'opaque', headers: new Headers(), clone() { return this; } });

  const contesto: Record<string, unknown> = {
    Response, Headers, URL, console,
    caches: {
      open: async (nome: string) => {
        if (!magazzino.has(nome)) magazzino.set(nome, new Map());
        const m = magazzino.get(nome)!;
        return {
          match: async (r: never) => m.get(chiave(r)),
          put: async (r: never, res: unknown) => void m.set(chiave(r), res),
          keys: async () => [...m.keys()],
          delete: async (r: never) => m.delete(chiave(r)),
        };
      },
      keys: async () => [...magazzino.keys()],
      delete: async (n: string) => magazzino.delete(n),
      match: async () => undefined,
    },
    fetch: async (r: { url: string; mode?: string } | string, init?: { mode?: string }) => {
      const url = chiave(r);
      const mode = init?.mode ?? (typeof r === 'string' ? 'cors' : r.mode ?? 'cors');
      chiamate.push({ url, mode });
      if (rete === 'morta') throw new TypeError('Failed to fetch');
      if (mode === 'no-cors') return opaca();
      if (rete === 'senza-cors') throw new TypeError('CORS bloccato');
      if (url.includes('sparita')) return new Response('vietato', { status: 403 });
      return new Response('jpeg', { status: 200 });
    },
    self: {
      location: { origin: 'https://mycity.it' },
      addEventListener: (t: string, fn: (e: unknown) => void) => void (ascoltatori[t] = fn),
      skipWaiting: () => {},
      clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
      registration: { showNotification: async () => {} },
    },
  };
  vm.createContext(contesto);
  vm.runInContext(SORGENTE, contesto);

  const chiediFoto = async (url: string) => {
    let p: unknown;
    ascoltatori.fetch?.({ request: { method: 'GET', mode: 'no-cors', url }, respondWith: (x: unknown) => void (p = x) });
    const res = (await p) as { ok: boolean; status: number } | undefined;
    await new Promise((r) => setTimeout(r, 10)); // la cache si scrive in sottofondo
    return res;
  };
  const fotoSalvate = () => [...(magazzino.get('mycity-images-v2')?.keys() ?? [])];
  return { chiediFoto, fotoSalvate, chiamate };
}

const FOTO = 'https://abcdefgh.supabase.co/storage/v1/render/image/public/prodotti/focaccia.jpg?width=640&quality=75';
const SPARITA = 'https://abcdefgh.supabase.co/storage/v1/render/image/public/prodotti/sparita.jpg?width=640';

describe('R08-018 — le foto dello storage entrano nella cache del telefono', () => {
  it('una foto chiesta da un <img> senza crossorigin finisce in cache, e la seconda volta non va in rete', async () => {
    const sw = avvia();
    const res = await sw.chiediFoto(FOTO);
    expect(res?.ok).toBe(true);
    expect(sw.fotoSalvate()).toEqual([FOTO]);
    const prima = sw.chiamate.length;
    await sw.chiediFoto(FOTO);
    expect(sw.chiamate.length).toBe(prima);
  });

  it('una foto che risponde 403 arriva come 403 e non si salva', async () => {
    const sw = avvia();
    const res = await sw.chiediFoto(SPARITA);
    expect(res?.status).toBe(403);
    expect(sw.fotoSalvate()).toEqual([]);
  });

  it('se lo storage non risponde con CORS, la foto arriva lo stesso (domanda originale) e non si salva', async () => {
    const sw = avvia('senza-cors');
    const res = await sw.chiediFoto(FOTO);
    expect(res).toBeDefined();
    expect(sw.chiamate.map((c) => c.mode)).toEqual(['cors', 'no-cors']);
    expect(sw.fotoSalvate()).toEqual([]);
  });

  it('senza rete e senza copia la risposta resta una risposta d’errore, non undefined', async () => {
    const sw = avvia('morta');
    const res = await sw.chiediFoto(FOTO);
    expect(res).toBeDefined();
  });
});
