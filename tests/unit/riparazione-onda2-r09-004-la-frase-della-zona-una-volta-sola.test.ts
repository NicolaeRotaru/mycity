import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';
import { CONFINE_DELLA_ZONA, FINO_AL_CONFINE, FINO_AL_CONFINE_IN_TESTA } from '@/lib/ordini/zona-di-consegna';

/**
 * R09-004 — La frase della zona («fino a 5 km dal negozio») si scrive una volta sola, in
 * lib/ordini/zona-di-consegna.ts.
 *
 * La prova di prima guardava un elenco di cinque file e cercava solo «fino a» minuscolo: le copie
 * scritte a mano nei metadati di app/near/layout.tsx e app/category/[slug]/layout.tsx, nella fascia
 * della home (HomeSectionRenderer, «Fino a…» maiuscolo), in «Chi siamo» e nella pagina delle
 * consegne dell'amministrazione non le vedeva. Qui si guarda tutto app, components e lib.
 */

const radice = join(__dirname, '..', '..');
const FONTE = 'lib/ordini/zona-di-consegna.ts';

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(join(radice, dir))) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const rel = join(dir, nome);
    if (statSync(join(radice, rel)).isDirectory()) sorgenti(rel, out);
    else if (/\.(ts|tsx)$/.test(nome)) out.push(rel);
  }
  return out;
}

/** Il confine scritto a mano: il numero della costante seguito da «km», o «km dal negozio». */
const COPIA_A_MANO = /\$\{\s*RAGGIO_CONSEGNA_KM\s*\}\s*(?:&nbsp;|\s)?km|km\}?\s+dal negozio/i;
const commento = (r: string) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(r);

describe('R09-004 — la frase della zona si scrive una volta sola', () => {
  it('nessun file di app, components o lib (fuori dalla fonte) riscrive il confine a mano', () => {
    const copie: string[] = [];
    for (const f of ['app', 'components', 'lib'].flatMap((d) => sorgenti(d))) {
      if (f === FONTE) continue;
      readFileSync(join(radice, f), 'utf8').split('\n').forEach((riga, i) => {
        if (!commento(riga) && COPIA_A_MANO.test(riga)) copie.push(`${f}:${i + 1}: ${riga.trim().slice(0, 120)}`);
      });
    }
    expect(copie).toEqual([]);
  });

  it.each([
    ['app/near/layout.tsx', 'FINO_AL_CONFINE'],
    ['app/category/[slug]/layout.tsx', 'FINO_AL_CONFINE'],
    ['components/home-sections/HomeSectionRenderer.tsx', 'FINO_AL_CONFINE_IN_TESTA'],
    ['app/about/page.tsx', 'CONFINE_DELLA_ZONA'],
    ['app/admin/delivery/page.tsx', 'CONFINE_DELLA_ZONA'],
  ])('%s importa %s dalla fonte', (f, nome) => {
    expect(readFileSync(join(radice, f), 'utf8')).toMatch(
      new RegExp(`import\\s*\\{[^}]*\\b${nome}\\b[^}]*\\}\\s*from\\s*'@/lib/ordini/zona-di-consegna'`),
    );
  });

  it('le frasi della fonte seguono la costante, anche a inizio frase', () => {
    expect(CONFINE_DELLA_ZONA).toBe(`${RAGGIO_CONSEGNA_KM} km`);
    expect(FINO_AL_CONFINE).toBe(`fino a ${RAGGIO_CONSEGNA_KM} km dal negozio`);
    expect(FINO_AL_CONFINE_IN_TESTA).toBe(`Fino a ${RAGGIO_CONSEGNA_KM} km dal negozio`);
  });

  it('i metadati di «Vicino a te» e della categoria Casa dicono il confine della fonte', async () => {
    const { metadata } = await import('@/app/near/layout');
    expect(String(metadata.description)).toContain(FINO_AL_CONFINE);
  });

  it('il commento della fonte non dice più che le copie restano', () => {
    const testa = readFileSync(join(radice, FONTE), 'utf8').split('export const CONFINE_DELLA_ZONA')[0];
    expect(testa).not.toMatch(/Non è ancora «una volta sola»/);
    expect(testa).toMatch(/UNA VOLTA SOLA/);
  });
});
