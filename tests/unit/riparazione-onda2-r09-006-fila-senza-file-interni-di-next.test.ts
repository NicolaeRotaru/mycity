import { describe, it, expect, vi, afterEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

/**
 * R09-006 — La fila «una per richiesta» delle email non si appoggia più a un file interno di Next.
 *
 * lib/api/dopo-la-risposta.ts leggeva la chiave della fila da
 * `next/dist/server/app-render/work-async-storage.external`, un file interno che Next può spostare
 * a ogni versione. Ora la chiave la apre `conFilaPerRichiesta` (lib/api/fila-per-richiesta.ts), un
 * `AsyncLocalStorage` di Node aperto all'ingresso della rotta. Qui:
 *  ① nessun file del progetto importa `next/dist/…`;
 *  ② due richieste avvolte hanno due file; dentro una richiesta, i lavori registrati da rami
 *    diversi (un ciclo con await, `Promise.all`) stanno in una fila sola — anche quelli messi in
 *    fila con `nellaFila` dentro un callback di `after()`, che Next lega al contesto della richiesta;
 *  ③ ogni rotta che arriva (anche di riflesso) a lib/api/dopo-la-risposta.ts è avvolta.
 */

const stato = vi.hoisted(() => ({ registrati: [] as Array<() => unknown> }));

// Come Next 15 (after-context.js → bindSnapshot): il callback è legato al contesto in cui è registrato.
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => void stato.registrati.push(AsyncLocalStorage.bind(fn)),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { after } from 'next/server';
import { dopoLaRisposta, nellaFila } from '@/lib/api/dopo-la-risposta';
import { conFilaPerRichiesta } from '@/lib/api/fila-per-richiesta';

const radice = join(__dirname, '..', '..');
const leggi = (p: string) => readFileSync(join(radice, p), 'utf8');

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(join(radice, dir))) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const rel = join(dir, nome);
    if (statSync(join(radice, rel)).isDirectory()) sorgenti(rel, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(nome)) out.push(rel);
  }
  return out;
}

/** Fa girare i callback registrati con after(), FUORI dal contesto della richiesta (come Next). */
const giraIDopo = () => void Promise.all(stato.registrati.splice(0).map((fn) => fn()));
const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => {
  stato.registrati.length = 0;
  vi.useRealTimers();
});

describe('① niente file interni di Next', () => {
  it('lib/api/dopo-la-risposta.ts e lib/api/fila-per-richiesta.ts non importano next/dist', () => {
    expect(leggi('lib/api/dopo-la-risposta.ts')).not.toMatch(/['"]next\/dist\//);
    expect(leggi('lib/api/fila-per-richiesta.ts')).not.toMatch(/['"]next\/dist\//);
  });

  it('nessun file di app, lib, components o della radice importa next/dist', () => {
    const chi = [...['app', 'lib', 'components'].flatMap((d) => sorgenti(d)), 'middleware.ts', 'instrumentation.ts']
      .filter((f) => existsSync(join(radice, f)))
      .filter((f) => /(?:from|import|require)\s*\(?\s*['"]next\/dist\//.test(leggi(f)));
    expect(chi).toEqual([]);
  });
});

describe('② una fila per richiesta, con la chiave aperta all’ingresso', () => {
  it('due richieste: B non aspetta il lavoro lento di A', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];
    conFilaPerRichiesta(() => {
      dopoLaRisposta(async () => { await pausa(8_000); diario.push('A'); }, 'lento di A');
    })();
    conFilaPerRichiesta(() => {
      dopoLaRisposta(async () => { diario.push('B'); }, 'email di B');
    })();
    giraIDopo();
    await vi.advanceTimersByTimeAsync(0);
    expect(diario).toEqual(['B']);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(diario).toEqual(['B', 'A']);
  });

  it('una richiesta col giro degli scaduti (ciclo con await) e rami in parallelo: una fila sola', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];
    let inVolo = 0;
    let massimo = 0;
    const email = (nome: string) => async () => {
      inVolo++;
      massimo = Math.max(massimo, inVolo);
      await pausa(100);
      diario.push(nome);
      inVolo--;
    };
    // Un aiutante che prima aspetta (la lettura dell'ordine) e poi registra la sua email.
    const avvisa = async (nome: string) => { await Promise.resolve(); dopoLaRisposta(email(nome), nome); };

    const gestore = conFilaPerRichiesta(async () => {
      for (const o of ['o1', 'o2', 'o3']) await avvisa(o);
      await Promise.all([avvisa('p1'), avvisa('p2')]);
      // Chi registra da sé il suo after(): la chiave di default si legge DENTRO il callback.
      after(() => nellaFila(email('dopo')));
    });
    await gestore();
    giraIDopo();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(diario).toEqual(['o1', 'o2', 'o3', 'p1', 'p2', 'dopo']);
    expect(massimo, 'mai due email insieme nella stessa richiesta').toBe(1);
  });

  it('una rotta chiamata da un’altra rotta resta nella fila di chi l’ha chiamata', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];
    const interna = conFilaPerRichiesta(() => {
      dopoLaRisposta(async () => { diario.push('interna'); }, 'interna');
    });
    conFilaPerRichiesta(() => {
      dopoLaRisposta(async () => { await pausa(50); diario.push('esterna'); }, 'esterna');
      interna();
    })();
    giraIDopo();
    await vi.advanceTimersByTimeAsync(50);
    expect(diario).toEqual(['esterna', 'interna']);
  });
});

describe('③ ogni rotta che arriva ai lavori dopo la risposta è avvolta', () => {
  const IMPORT = /(?:from|import)\s*\(?\s*['"](@\/[^'"]+|\.{1,2}\/[^'"]+)['"]/g;
  function risolvi(da: string, spec: string): string | null {
    const base = spec.startsWith('@/') ? spec.slice(2) : normalize(join(dirname(da), spec));
    for (const c of [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`]) {
      const p = join(radice, c);
      if (existsSync(p) && statSync(p).isFile()) return relative(radice, p);
    }
    return null;
  }
  function arriva(file: string, meta: string, visti = new Set<string>()): boolean {
    if (file === meta) return true;
    if (visti.has(file)) return false;
    visti.add(file);
    for (const m of leggi(file).matchAll(IMPORT)) {
      const g = risolvi(file, m[1]!);
      if (g && arriva(g, meta, visti)) return true;
    }
    return false;
  }

  const rotte = sorgenti('app').filter((f) => /\/route\.tsx?$/.test(f));
  const toccate = rotte.filter((f) => arriva(f, 'lib/api/dopo-la-risposta.ts'));

  it('la scansione trova le rotte dei soldi e delle email', () => {
    expect(toccate).toEqual(expect.arrayContaining([
      'app/api/orders/cod/route.ts',
      'app/api/stripe/checkout/route.ts',
      'app/api/stripe/webhook/route.ts',
      'app/api/contact/route.ts',
      'app/api/account/delete/route.ts',
      'app/api/chat/messages/route.ts',
    ]));
  });

  it.each(toccate.map((f) => [f]))('%s esporta ogni metodo avvolto da conFilaPerRichiesta', (rotta) => {
    const src = leggi(rotta);
    expect(src).toMatch(/import\s*\{[^}]*\bconFilaPerRichiesta\b[^}]*\}\s*from\s*'@\/lib\/api\/fila-per-richiesta'/);
    expect(src, 'un metodo esportato come funzione non è avvolto').not.toMatch(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
    expect(src, 'un metodo riesportato non è avvolto').not.toMatch(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b[^}]*\}/);
    const metodi = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*([^\n]*)/g)];
    expect(metodi.length).toBeGreaterThan(0);
    for (const [, metodo, valore] of metodi) expect(valore, metodo).toMatch(/^conFilaPerRichiesta\(/);
  });
});
