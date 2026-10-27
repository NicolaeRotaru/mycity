import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * 27/10/2026 — L'ETICHETTA COL NOME, L'INDIRIZZO E IL TELEFONO DEL CLIENTE
 * RESTAVA NELLA CACHE DEL DISPOSITIVO DEL NEGOZIO.
 *
 * «Stampa etichetta» apre /api/seller/orders/<id>/label in una scheda nuova:
 * e' una navigazione. Il service worker mette in cache ogni navigazione che
 * risponde 200 tranne i percorsi privati, e /api/seller non comincia con
 * /seller: il PDF finiva in mycity-html-v2, leggibile da chi usa il tablet del
 * bancone dopo, anche senza sessione e senza rete.
 *
 * Il service worker gira qui davvero, in una sandbox con una cache finta: si
 * guarda cosa resta in cache dopo la navigazione, non cosa c'e' scritto nel file.
 */

const SORGENTE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

type Ascoltatore = (e: Record<string, unknown>) => void;

function avvia(rete: () => Response) {
  const ascoltatori: Record<string, Ascoltatore> = {};
  const magazzino = new Map<string, Map<string, Response>>();
  const chiave = (r: unknown) => (typeof r === 'string' ? r : String((r as { url: string }).url));
  const apri = async (nome: string) => {
    if (!magazzino.has(nome)) magazzino.set(nome, new Map());
    const m = magazzino.get(nome)!;
    return {
      match: async (r: unknown) => m.get(chiave(r)),
      put: async (r: unknown, res: Response) => void m.set(chiave(r), res),
      keys: async () => [...m.keys()],
      delete: async (r: unknown) => m.delete(chiave(r)),
      addAll: async () => {},
    };
  };
  const caches = {
    open: apri,
    keys: async () => [...magazzino.keys()],
    delete: async (n: string) => magazzino.delete(n),
    match: async (r: unknown) => {
      for (const m of magazzino.values()) {
        const t = m.get(chiave(r));
        if (t) return t;
      }
      return undefined;
    },
  };
  const contesto: Record<string, unknown> = {
    caches, Response, Headers, URL, console,
    fetch: async () => rete(),
    self: {
      location: { origin: 'https://mycity.it' },
      addEventListener: (t: string, fn: Ascoltatore) => void (ascoltatori[t] = fn),
      skipWaiting: () => {},
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
      registration: { showNotification: async () => {} },
    },
  };
  vm.createContext(contesto);
  vm.runInContext(SORGENTE, contesto);
  return {
    magazzino,
    naviga: async (url: string) => {
      let p: unknown;
      ascoltatori.fetch({ request: { method: 'GET', mode: 'navigate', url }, respondWith: (x: unknown) => void (p = x) });
      return (await p) as Response;
    },
    attiva: async () => {
      let p: unknown;
      ascoltatori.activate({ waitUntil: (x: unknown) => void (p = x) });
      await p;
    },
  };
}

const vociPagine = (m: Map<string, Map<string, Response>>) =>
  [...m.entries()].filter(([n]) => n.startsWith('mycity-html-')).reduce((s, [, v]) => s + v.size, 0);

const pdf = () => new Response('%PDF-1.4 Maria Rossi, via Roma 1, 333 1234567', {
  status: 200, headers: { 'content-type': 'application/pdf' },
});
const html = () => new Response('<html><body>pagina</body></html>', {
  status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
});

describe('le etichette dei clienti non restano sul dispositivo del negozio', () => {
  it('il PDF dell etichetta aperto in una scheda nuova non finisce nella cache delle pagine', async () => {
    const sw = avvia(pdf);
    const res = await sw.naviga('https://mycity.it/api/seller/orders/abc/label');
    expect(res.status).toBe(200);
    expect(vociPagine(sw.magazzino), 'etichetta con nome, indirizzo e telefono salvata in cache').toBe(0);
  });

  it('nessuna navigazione verso /api resta in cache, anche se risponde una pagina', async () => {
    const sw = avvia(html);
    await sw.naviga('https://mycity.it/api/qualcosa');
    expect(vociPagine(sw.magazzino)).toBe(0);
  });

  it('una risposta che non e una pagina non si tiene, qualunque sia il percorso', async () => {
    const sw = avvia(pdf);
    await sw.naviga('https://mycity.it/scarica/scontrino');
    expect(vociPagine(sw.magazzino)).toBe(0);
  });

  it('controprova: una pagina pubblica si tiene ancora per quando manca la rete', async () => {
    const sw = avvia(html);
    await sw.naviga('https://mycity.it/negozi');
    expect(vociPagine(sw.magazzino)).toBe(1);
  });

  it('all aggiornamento si butta la cache delle pagine di prima, dove le etichette ci sono gia', async () => {
    const sw = avvia(html);
    sw.magazzino.set('mycity-html-v2', new Map([['https://mycity.it/api/seller/orders/abc/label', pdf()]]));
    sw.magazzino.set('mycity-images-v2', new Map([['https://x.supabase.co/storage/foto.jpg', new Response('foto')]]));
    await sw.attiva();
    expect(sw.magazzino.has('mycity-html-v2'), 'le etichette gia in cache restano sui tablet').toBe(false);
    expect(sw.magazzino.has('mycity-images-v2'), 'le foto non c entrano: non vanno riscaricate').toBe(true);
  });
});
