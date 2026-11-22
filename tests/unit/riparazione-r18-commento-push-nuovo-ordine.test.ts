/**
 * R18-002 — I commenti in cima al cron delle notifiche non devono dire che il nuovo ordine manda la
 * push subito finché nessuna rotta chiama l'aiutante che lo fa. Due posti ne parlano: la nota sopra
 * le categorie (quanto vale un avviso, chi lo usa) e il commento della rotta (la cadenza).
 *
 * Prova leggera sul sorgente, legata al senso e non alle frasi: finché nessun file dell'app chiama
 * `mandaSubitoLaPushDelNuovoOrdine`, ogni frase dei commenti che parla dell'invio «subito» deve dire
 * anche che oggi nessuno lo chiama. Se un file comincia a chiamarlo, i commenti potranno tornare a
 * dirlo, e non dovranno più dire che nessuno lo chiama.
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

/** Il testo di un commento, senza i segni del commento, i nomi fra apici inversi e i percorsi dei file. */
const pulisci = (t: string) =>
  t
    .replace(/^\s*(\/\/|\/\*\*?|\*\/?)\s?/gm, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\S+\.(tsx?|json)\b/g, ' ')
    .replace(/\s+/g, ' ');

describe('R18-002 i commenti del cron delle notifiche dicono il vero', () => {
  const testa = leggi('app/api/cron/send-push/route.ts').split('export const runtime')[0];
  const commenti = [...testa.matchAll(/(?:^\/\/.*\n?)+|\/\*[\s\S]*?\*\//gm)].map((m) => pulisci(m[0]));
  const parlanoDiSubito = commenti.filter((c) => /\bsubito\b/i.test(c));
  const frasi = parlanoDiSubito.flatMap((c) => c.split(/\.\s+/)).filter((f) => /\bsubito\b/i.test(f));
  const diceCheNessunoLoChiama = /\b(nessun[oa]?|non)\b.*\bchiam/i;
  const chiamanti = ['app', 'lib']
    .flatMap((d) => sorgenti(d, ['lib/push/subito.ts']))
    .filter((f) => /mandaSubitoLaPushDelNuovoOrdine\s*\(/.test(leggi(f)));

  it('tutti e due i posti parlano ancora dell’invio subito', () => {
    expect(parlanoDiSubito.length).toBeGreaterThanOrEqual(2);
  });

  it('ogni frase sull’invio subito dice se oggi qualcuno lo chiama', () => {
    if (chiamanti.length === 0) {
      for (const f of frasi) expect(f, `questa frase promette l'invio subito: «${f.trim()}»`).toMatch(diceCheNessunoLoChiama);
    } else {
      for (const f of frasi) expect(f).not.toMatch(/\bnessun[oa]? rotta\b.*\bchiam/i);
    }
  });
});
