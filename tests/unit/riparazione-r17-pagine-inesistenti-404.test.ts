/**
 * 22/11/2026 — UN PRODOTTO, UN NEGOZIO, UNA CATEGORIA O UN PROFILO CHE NON ESISTONO RISPONDONO 404.
 *
 * Chi decide «non trovato» c'è già: il guscio (layout) di prodotto, negozio e categoria, e la pagina
 * del profilo pubblico, chiamano notFound(). Ma un `loading.tsx` avvolge in un'attesa (Suspense) la
 * pagina della sua cartella e TUTTO quello che sta sotto, gusci compresi: per mostrare l'attesa la
 * risposta parte subito con «tutto ok», e un notFound() che arriva dopo non può più cambiare il
 * codice (a Google arriva un 200 con noindex, il «soft 404»). Quindi, per ogni pagina, fra la radice
 * e chi decide non ci deve essere nessun `loading.tsx`:
 *   - se decide il guscio della cartella S: nessun loading.tsx nelle cartelle SOPRA S (quello dentro
 *     S sta sotto il guscio e va bene: è lo scheletro della pagina);
 *   - se decide la pagina della cartella S: nessun loading.tsx neanche dentro S.
 *
 * La prova legge le cartelle vere di app/ come le legge Next (le regole sono quelle della
 * convenzione dei file di Next 15). Non avvia il sito: la 404 in rete è a parte.
 *
 * Non qui: la pagina su misura di un negozio che c'è (/store/<id>/<pagina che non c'è>). La decide
 * app/store/[id]/[slug]/layout.tsx, ma sopra ha app/store/[id]/loading.tsx, che non è di questa
 * riparazione: finché c'è, quella risponde ancora 200.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RADICE = process.cwd();
const ESTENSIONI = ['tsx', 'ts', 'jsx', 'js'];

/** I loading.tsx che avvolgono il file `chiDecide` (un layout o una pagina sotto app/). */
function attesaSopra(chiDecide: string): string[] {
  const cartella = dirname(chiDecide);
  const eUnaPagina = /\/page\.(tsx|ts|jsx|js)$/.test(chiDecide);
  // Le cartelle da guardare: dalla radice app/ fino a quella di chi decide (inclusa solo per una pagina).
  const parti = cartella.split('/');
  const cartelle: string[] = [];
  for (let i = 1; i <= parti.length; i++) cartelle.push(parti.slice(0, i).join('/'));
  const daGuardare = eUnaPagina ? cartelle : cartelle.slice(0, -1);
  const trovati: string[] = [];
  for (const c of daGuardare) {
    for (const e of ESTENSIONI) {
      const f = `${c}/loading.${e}`;
      if (existsSync(join(RADICE, f))) trovati.push(f);
    }
  }
  return trovati;
}

const PAGINE = [
  { indirizzo: '/product/<id che non c’è>', chiDecide: 'app/product/[id]/layout.tsx' },
  { indirizzo: '/store/<id che non c’è>', chiDecide: 'app/store/[id]/layout.tsx' },
  { indirizzo: '/category/<slug che non c’è>', chiDecide: 'app/category/[slug]/layout.tsx' },
  { indirizzo: '/u/<handle che non c’è>', chiDecide: 'app/u/[handle]/page.tsx' },
];

describe('la regola delle attese è letta come la legge Next', () => {
  it('un loading.tsx nella cartella del guscio non lo avvolge, uno nella cartella della pagina sì', () => {
    // app/product/[id]/loading.tsx esiste: sta SOTTO il guscio del prodotto (avvolge la pagina).
    expect(existsSync(join(RADICE, 'app/product/[id]/loading.tsx'))).toBe(true);
    expect(attesaSopra('app/product/[id]/layout.tsx')).not.toContain('app/product/[id]/loading.tsx');
    expect(attesaSopra('app/product/[id]/page.tsx')).toContain('app/product/[id]/loading.tsx');
  });
});

describe('chi non esiste riceve 404, non «tutto ok»', () => {
  for (const { indirizzo, chiDecide } of PAGINE) {
    it(`${indirizzo}: ${chiDecide} chiama notFound() e sopra non c’è nessuna attesa`, () => {
      const src = readFileSync(join(RADICE, chiDecide), 'utf8');
      expect(src, `${chiDecide} non decide più la 404`).toMatch(/\bnotFound\(\)/);
      expect(
        attesaSopra(chiDecide),
        `sopra ${chiDecide} c'è un'attesa: la risposta parte con 200 prima che notFound() possa dire 404`,
      ).toEqual([]);
    });
  }
});
