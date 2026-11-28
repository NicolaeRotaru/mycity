import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * R10-001 (onda 2, 28/11/2026) — OMBRE NERE FREDDE ACCANTO ALLE OMBRE CALDE DEL BRAND.
 *
 * tailwind.config.ts ha le ombre del marchio, tinte di terracotta (`shadow-warm-sm`, `shadow-warm`,
 * `shadow-warm-lg`, `shadow-warm-xl`) e due neutre per il bianco puro (`shadow-sm-neutral`,
 * `shadow-card`). Ma 35 classi in 24 file usavano ancora le ombre di serie di Tailwind
 * (`shadow`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`), nere e fredde:
 * il bottone «accent», il dialogo di conferma, il banner dei cookie, la barra di ricerca, i
 * bottoni delle pagine aiuto e contatti stavano accanto a schede con l'ombra calda. Corrispondenza
 * usata: sm → warm-sm, (nessuna)/md → warm, lg → warm-lg, xl/2xl → warm-xl.
 *
 * Questa prova scorre tutti i .tsx di app/ e components/: nessuna ombra di serie torna.
 */
const RADICE = process.cwd();
const OMBRA_DI_SERIE = /(^|[^-a-z0-9_/])((?:[a-z0-9-]+:)*)shadow(-sm|-md|-lg|-xl|-2xl)?(?=[ "'`}]|$)/gm;

function tsx(cartella: string): string[] {
  const fuori: string[] = [];
  for (const nome of readdirSync(cartella)) {
    const p = join(cartella, nome);
    if (statSync(p).isDirectory()) fuori.push(...tsx(p));
    else if (p.endsWith('.tsx')) fuori.push(p);
  }
  return fuori;
}

describe('R10-001 · solo le ombre del marchio, niente ombre nere di serie', () => {
  const file = [...tsx(join(RADICE, 'app')), ...tsx(join(RADICE, 'components'))];

  it('IL CASO DELLA VOCE — nessun .tsx di app/ e components/ usa shadow, shadow-sm/md/lg/xl/2xl', () => {
    const trovate: string[] = [];
    for (const f of file) {
      const righe = readFileSync(f, 'utf8').split('\n');
      righe.forEach((riga, i) => {
        for (const m of riga.matchAll(OMBRA_DI_SERIE)) trovate.push(`${relative(RADICE, f)}:${i + 1} ${m[2]}shadow${m[3] ?? ''}`);
      });
    }
    expect(trovate, 'ombre nere di serie accanto a quelle calde del marchio').toEqual([]);
  });

  it('la prova non passa a vuoto: le ombre del marchio ci sono e la regola le riconosce', () => {
    const tutto = file.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(tutto).toMatch(/\bshadow-warm-xl\b/);
    expect(tutto).toMatch(/\bshadow-sm-neutral\b/);
    expect('className="p-4 shadow-md"'.match(OMBRA_DI_SERIE)).not.toBeNull();
    expect('className="hover:shadow-lg"'.match(OMBRA_DI_SERIE)).not.toBeNull();
    expect('className="p-4 shadow-warm drop-shadow-sm shadow-sm-neutral shadow-inner"'.match(OMBRA_DI_SERIE)).toBeNull();
  });
});
