import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * LA PROMESSA DI CONSEGNA È UNA SOLA, E NON PUÒ TORNARE INDIETRO DA SOLA.
 *
 * Il 21/8/2026 la radiografia ha trovato che la home prometteva la consegna in
 * 30-60 minuti mentre ogni altra pagina del sito prometteva 24-48 ore: 36 punti
 * in 28 file. Chi arrivava leggeva un'ora, chi ordinava scopriva due giorni.
 * Il checkout mostrava perfino le due promesse una sopra l'altra, «Express
 * ~30-60 min per questi negozi, altrimenti standard 24-48h», e il cliente non
 * poteva sapere quale valesse per lui.
 *
 * Nicola ha deciso: una promessa sola, 30-60 minuti.
 *
 * Questa prova è il freno. Non controlla che una frase esista — controlla che
 * la promessa VECCHIA non sia tornata in nessuno dei posti che il cliente
 * legge. Diventa rossa al primo «24-48» rimesso in circolo, ed è l'unico modo
 * per cui una riscrittura di 28 file resta riscritta.
 */

const RADICE = resolve(__dirname, '..', '..');

/** Le cartelle che il cliente legge. Non i test, non le migrazioni, non i referti. */
// 22/8/2026 — `design-system` è diventata `docs/mockup`: il nome prometteva
// codice e conteneva copie ferme dei componenti veri.
const GUARDATE = ['app', 'components', 'lib', 'docs/mockup', 'public'];

/** Il vecchio modo di dire il tempo di consegna, in tutte le grafie viste nel repo. */
const PROMESSA_VECCHIA = /24\s*[-–/]\s*48/;

const ESTENSIONI = ['.ts', '.tsx', '.json', '.md'];

function file(dir: string, dentro: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) file(p, dentro);
    else if (ESTENSIONI.some((e) => nome.endsWith(e))) dentro.push(p);
  }
  return dentro;
}

describe('la promessa di consegna', () => {
  it('non dice più 24-48 in nessuna pagina che il cliente legge', () => {
    const colpevoli: string[] = [];
    for (const cartella of GUARDATE) {
      for (const f of file(join(RADICE, cartella))) {
        const righe = readFileSync(f, 'utf8').split('\n');
        righe.forEach((riga, i) => {
          // I commenti non li legge il cliente, e questa storia va potuta raccontare
          // nel codice: il commento in app/checkout/page.tsx cita la vecchia frase
          // proprio per spiegare perché non c'è più.
          const commento = /^\s*(\/\/|\*|\/\*)/.test(riga);
          if (!commento && PROMESSA_VECCHIA.test(riga)) {
            colpevoli.push(`${f.slice(RADICE.length + 1)}:${i + 1} → ${riga.trim().slice(0, 100)}`);
          }
        });
      }
    }
    expect(colpevoli, 'la promessa vecchia è tornata in queste righe').toEqual([]);
  });

  it('la promessa nuova c\'è davvero dove il cliente la cerca', () => {
    const spedizioni = readFileSync(join(RADICE, 'app/shipping/page.tsx'), 'utf8');
    expect(spedizioni).toMatch(/30-60 min/);
    const faq = readFileSync(join(RADICE, 'app/faq/page.tsx'), 'utf8');
    expect(faq).toMatch(/30-60 minuti/);
  });
});
