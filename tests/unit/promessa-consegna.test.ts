import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { rispostaTempiDiConsegna } from '@/lib/promesse-pubbliche';

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

  /**
   * 23/8/2026 — QUESTA PROVA CERCAVA LA STRINGA «30-60 minuti» DENTRO I FILE, e diventava rossa
   * proprio nel momento in cui il difetto veniva curato.
   *
   * Il numero era scritto a mano in quattro punti mentre `EXPRESS_ETA_LABEL` esiste dal giorno in
   * cui qualcuno l'ha deciso. Portando le pagine a leggerlo da lì, la stringa letterale è sparita
   * dai file — e questa riga è diventata rossa su un lavoro giusto. Una prova che punisce chi cura
   * è una prova che insegna a non curare.
   *
   * Adesso guarda la stessa cosa dal verso che regge: quello che ARRIVA al cliente. La risposta
   * della FAQ e il riquadro della pagina Spedizioni devono contenere l'etichetta decisa, comunque
   * ci arrivino — a mano o derivata. Se domani il numero cambia in `lib/delivery`, questa prova
   * segue; se qualcuno riscrive un numero diverso a mano, diventa rossa.
   */
  it('la promessa nuova arriva davvero al cliente, comunque sia scritta', () => {
    expect(rispostaTempiDiConsegna().a).toContain(EXPRESS_ETA_LABEL);
    expect(EXPRESS_ETA_LABEL).toMatch(/30-60/);

    const spedizioni = readFileSync(join(RADICE, 'app/shipping/page.tsx'), 'utf8');
    expect(
      spedizioni.includes('EXPRESS_ETA_LABEL') || /30-60 min/.test(spedizioni),
      'la pagina Spedizioni deve dire il tempo: o lo legge da lib/delivery, o lo scrive',
    ).toBe(true);

    const faq = readFileSync(join(RADICE, 'app/faq/page.tsx'), 'utf8');
    expect(
      faq.includes('rispostaTempiDiConsegna') || /30-60 min/.test(faq),
      'la FAQ deve dire il tempo: o lo prende dalle promesse, o lo scrive',
    ).toBe(true);
  });
});
