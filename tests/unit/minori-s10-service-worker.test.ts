import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * S10 (5/11/2026, scheda 673) — il service worker conserva anche le foto di
 * Supabase che arrivano «opache» (img senza crossorigin): la seconda volta,
 * anche senza rete, la foto arriva dalla memoria del telefono.
 */
const SORGENTE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

function avvia() {
  const ascoltatori: Record<string, (e: unknown) => void> = {};
  const magazzino = new Map<string, Map<string, unknown>>();
  const stato = { reteViva: true };
  const apri = async (nome: string) => {
    if (!magazzino.has(nome)) magazzino.set(nome, new Map());
    const m = magazzino.get(nome)!;
    return {
      match: async (req: { url: string }) => m.get(req.url),
      put: async (req: { url: string }, res: unknown) => void m.set(req.url, res),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (req: { url: string }) => m.delete(req.url),
    };
  };
  const opaca = () => ({ ok: false, status: 0, type: 'opaque', headers: new Headers(), clone() { return opaca(); } });
  const contesto: Record<string, unknown> = {
    caches: { open: apri, keys: async () => [...magazzino.keys()], delete: async (n: string) => magazzino.delete(n), match: async () => undefined },
    Response, Headers, URL, console,
    fetch: async () => {
      if (!stato.reteViva) throw new TypeError('Failed to fetch');
      return opaca();
    },
    self: {
      location: { origin: 'https://mycity.it' },
      addEventListener: (tipo: string, fn: (e: unknown) => void) => void (ascoltatori[tipo] = fn),
      skipWaiting: () => {},
      clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
      registration: { showNotification: async () => {} },
    },
  };
  vm.createContext(contesto);
  vm.runInContext(SORGENTE, contesto);
  const chiediFoto = async (url: string) => {
    let promessa: unknown;
    ascoltatori.fetch?.({ request: { method: 'GET', mode: 'no-cors', url }, respondWith: (p: unknown) => void (promessa = p) });
    return (await promessa) as { type?: string } | undefined;
  };
  return { chiediFoto, stato, magazzino };
}

describe('le foto opache di Supabase restano nel telefono (673)', () => {
  it('vista una volta, senza rete arriva dalla memoria', async () => {
    const sw = avvia();
    const foto = 'https://abcdefgh.supabase.co/storage/v1/object/public/products/pane.jpg';
    await sw.chiediFoto(foto);
    await new Promise((r) => setTimeout(r, 5));
    sw.stato.reteViva = false;
    const seconda = await sw.chiediFoto(foto);
    expect(seconda?.type).toBe('opaque');
  });
});
