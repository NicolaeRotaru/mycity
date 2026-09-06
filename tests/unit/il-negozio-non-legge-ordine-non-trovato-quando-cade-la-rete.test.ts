import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 6/9/2026 — IL NEGOZIO LEGGEVA «ORDINE NON TROVATO» SU UN ORDINE CHE AVEVA APPENA INCASSATO.
 *
 * La pagina con cui il negoziante apre un ordine e lo accetta decideva cosa mostrare con due sole
 * righe: se sta caricando lo scheletro, altrimenti — se non ha il dato — «Ordine non trovato».
 * Il lettore globale riprova una volta sola e non alza l'errore (components/providers/
 * QueryProvider.tsx): quando la lettura fallisce davvero, il caricamento finisce, il dato resta
 * vuoto, e al negoziante compare un messaggio che dice una cosa falsa e senza rimedio.
 *
 * Esempio concreto: ordine pagato alle 19:40, il negoziante apre la pagina con la linea che balla,
 * legge che l'ordine non esiste, non ha nessun pulsante per riprovare. Se non accetta in tempo
 * l'ordine scade: soldi persi per lui, cliente deluso.
 *
 * La pagina gemella del cliente (app/orders/[id]/page.tsx) era gia' stata riparata mesi fa. Questa
 * prova tiene insieme i due lati, cosi' la correzione non torna a essere fatta da una parte sola.
 */

const RADICE = process.cwd();
/** I commenti spiegano il difetto: citarlo non e' commetterlo. */
const senzaCommenti = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

const PAGINE: [string, string][] = [
  ['la pagina ordine del negoziante', 'app/seller/orders/[id]/page.tsx'],
  ['la pagina ordine del cliente', 'app/orders/[id]/page.tsx'],
];

describe('la pagina di un ordine distingue «non trovato» da «non ci arrivo»', () => {
  for (const [nome, file] of PAGINE) {
    const src = senzaCommenti(readFileSync(join(RADICE, file), 'utf8'));

    it(`${nome} chiede alla lettura se e' fallita`, () => {
      expect(src, 'senza `isError` la lettura fallita si confonde con l’ordine inesistente').toMatch(/\bisError\b/);
      expect(src, 'e deve avere un ramo suo, che esce prima di dire «non trovato»').toMatch(/if\s*\(\s*isError/);
    });

    it(`${nome} offre di riprovare`, () => {
      expect(src, 'un guasto di rete senza «Riprova» lascia il negoziante fermo').toMatch(/\brefetch\b/);
    });

    it(`${nome} non tratta «nessuna riga» come un guasto`, () => {
      // `.single()` alza un errore anche quando l'ordine semplicemente non c'e': cosi' un ordine
      // inesistente finirebbe nel ramo del guasto, con un «Riprova» che non potra' mai funzionare.
      expect(src, 'la lettura dell’ordine deve usare `.maybeSingle()`').not.toMatch(/\.single\(\)/);
    });
  }
});
