/**
 * R18-002 — Il commento in cima al cron delle notifiche non deve dire che il nuovo ordine manda la
 * push subito finché nessuna rotta chiama l'aiutante che lo fa. Prova leggera sul sorgente: se un file
 * dell'app comincia a chiamare `mandaSubitoLaPushDelNuovoOrdine`, il commento potrà tornare a dirlo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const radice = process.cwd();
const leggi = (f: string) => readFileSync(join(radice, ...f.split('/')), 'utf8');

function sorgenti(dir: string, fuori: string[] = []): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(join(radice, dir))) {
    const rel = `${dir}/${nome}`;
    if (fuori.includes(rel)) continue;
    const st = statSync(join(radice, rel));
    if (st.isDirectory()) out.push(...sorgenti(rel, fuori));
    else if (/\.(ts|tsx)$/.test(nome)) out.push(rel);
  }
  return out;
}

describe('R18-002 il commento del cron delle notifiche dice il vero', () => {
  const testa = leggi('app/api/cron/send-push/route.ts').split('export const runtime')[0].replace(/\n\s*\*\s?/g, ' ');
  const chiamanti = ['app', 'lib']
    .flatMap((d) => sorgenti(d, ['lib/push/subito.ts']))
    .filter((f) => /mandaSubitoLaPushDelNuovoOrdine\s*\(/.test(leggi(f)));

  it('non dice che la push parte subito se nessuna rotta chiama l’aiutante', () => {
    if (chiamanti.length === 0) {
      expect(testa).not.toMatch(/la push al negozio parte subito/);
      expect(testa).toMatch(/nessuna rotta lo chiama ancora/);
    } else {
      expect(testa).not.toMatch(/nessuna rotta lo chiama ancora/);
    }
  });
});
