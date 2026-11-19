import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { RITENTATIVI_AI, TEMPO_TENTATIVO_AI_MS } from '@/lib/ai/client';

/**
 * R03-005 (giro 2) — Quando Anthropic non risponde, Vercel spegneva la funzione AI
 * prima che il negozio leggesse un errore chiaro. Dopo il primo giro il client sta
 * sotto i 120 s delle rotte app/api/ai/** e della lettura da foto, ma altre rotte
 * che chiamano il modello (lettura di piu' foto, ordine da foto, import da link,
 * aggiornamento dal marketplace) non avevano una durata in vercel.json: valeva
 * quella predefinita del progetto, che puo' essere piu' corta del client.
 *
 * Prova di configurazione: ogni rotta sotto app/api che arriva al modello (importa,
 * anche attraverso altri moduli, un file che chiama getAnthropic()) ha in
 * vercel.json una durata maggiore del tempo del client piu' un margine.
 */

const ROOT = process.cwd();
/** Il filtro che alcune rotte chiamano prima del modello, e il margine per rispondere l'errore. */
const FILTRO_MS = 10_000;
const MARGINE_MS = 10_000;

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
  functions: Record<string, { maxDuration?: number }>;
};

function fileTs(cartella: string): string[] {
  const fuori: string[] = [];
  for (const e of readdirSync(join(ROOT, cartella), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(cartella, e.name);
    if (e.isDirectory()) fuori.push(...fileTs(p));
    else if (/\.tsx?$/.test(e.name)) fuori.push(normalize(p));
  }
  return fuori;
}

function risolvi(spec: string, da: string): string | null {
  const base = spec.startsWith('@/') ? spec.slice(2) : spec.startsWith('.') ? join(dirname(da), spec) : null;
  if (base === null) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(join(ROOT, c))) return normalize(c);
  }
  return null;
}

/** Le rotte di app/api che arrivano a una chiamata al modello. */
function rotteCheChiamanoIlModello(): string[] {
  const tutti = [...fileTs('app'), ...fileTs('lib')];
  const chiPortaA = new Map<string, string[]>();
  const semi: string[] = [];
  for (const f of tutti) {
    const testo = readFileSync(join(ROOT, f), 'utf8');
    if (/\bgetAnthropic\(\)/.test(testo)) semi.push(f);
    for (const m of testo.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const dip = risolvi(m[1] ?? m[2], f);
      if (dip) chiPortaA.set(dip, [...(chiPortaA.get(dip) ?? []), f]);
    }
  }
  const raggiunti = new Set(semi);
  const coda = [...semi];
  while (coda.length) {
    for (const chi of chiPortaA.get(coda.pop()!) ?? []) {
      if (!raggiunti.has(chi)) {
        raggiunti.add(chi);
        coda.push(chi);
      }
    }
  }
  return [...raggiunti].filter((f) => /^app\/api\/.*\/route\.ts$/.test(f)).sort();
}

/** Lo schema dei glob di vercel.json: `**` attraversa le cartelle, `*` resta in una cartella. */
function corrisponde(schema: string, file: string): boolean {
  const re = schema
    .split('**/')
    .map((pezzo) => pezzo.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('(?:.*/)?');
  return new RegExp(`^${re}$`).test(file);
}

describe('R03-005 — ogni rotta che chiama il modello ha una durata in vercel.json sopra il tempo del client', () => {
  const rotte = rotteCheChiamanoIlModello();
  const tempoClientMs = (RITENTATIVI_AI + 1) * TEMPO_TENTATIVO_AI_MS + RITENTATIVI_AI * 500;

  it('la ricerca delle rotte trova quelle che chiamano il modello', () => {
    expect(rotte).toEqual(expect.arrayContaining([
      'app/api/ai/catalog-batch/start/route.ts',
      'app/api/vision/extract-product/route.ts',
      'app/api/vision/extract-products/route.ts',
      'app/api/vision/photo-order/route.ts',
      'app/api/marketplace/import-fetch/route.ts',
      'app/api/products/[id]/external-refresh/route.ts',
    ]));
  });

  it.each(rotteCheChiamanoIlModello())('%s', (rotta) => {
    const durate = Object.entries(vercel.functions)
      .filter(([schema]) => corrisponde(schema, rotta))
      .map(([, v]) => (v.maxDuration ?? 0) * 1000);
    expect(durate.length, `nessuna durata in vercel.json per ${rotta}`).toBeGreaterThan(0);
    for (const durataMs of durate) expect(durataMs).toBeGreaterThanOrEqual(tempoClientMs + FILTRO_MS + MARGINE_MS);
  });
});
