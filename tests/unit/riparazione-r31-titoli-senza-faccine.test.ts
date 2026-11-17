import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R31-024 — Faccine nei titoli delle notifiche scritte dal codice del sito.
 *
 * Dalla migrazione 215 le campanelle scritte dal database («Ordine accettato», «Ordine pronto»…)
 * non hanno più faccine; quelle scritte dal codice sì: «🎉 Nuovo ordine!», «✅ Ordine ricevuto»,
 * «📦 Nuovo ordine ricevuto», «❌ Ordine rifiutato dal negozio», «✕ Ordine annullato». Nella stessa
 * lista il cliente o il negozio leggevano due voci diverse, e la push del telefono partiva con la
 * faccina davanti al testo.
 *
 * Qui si leggono le rotte e il modulo che scrivono le campanelle a clienti, negozi e fattorini, e
 * si guarda il testo di ogni titolo (`title:` della riga di notifications, `titolo:` del ripiego).
 */

const FILE = [
  'app/api/orders/cod/route.ts',
  'app/api/orders/[id]/cancel/route.ts',
  'app/api/admin/orders/[id]/cancel/route.ts',
  'app/api/seller/orders/[id]/reject/route.ts',
  'lib/stripe/webhook/comune.ts',
];

// Faccine e simboli pittografici (✕ ❌ ✅ 🎉 📦 ⚠️ …), più il selettore che li trasforma in faccina.
const FACCINA = /[\p{Extended_Pictographic}✀-➿️]/u;

function titoli(file: string): string[] {
  const testo = readFileSync(join(process.cwd(), file), 'utf8');
  const trovati: string[] = [];
  for (const m of testo.matchAll(/\b(?:title|titolo):\s*(['`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) trovati.push(m[2]);
  return trovati;
}

describe('R31-024 · i titoli delle campanelle scritte dal codice sono senza faccine', () => {
  it.each(FILE)('%s: nessun titolo comincia con una faccina o ne contiene una', (file) => {
    const elenco = titoli(file);
    // Controprova: nel file i titoli ci sono davvero, la prova non guarda il vuoto.
    expect(elenco.length, `${file}: nessun titolo trovato`).toBeGreaterThan(0);
    const conFaccina = elenco.filter((t) => FACCINA.test(t));
    expect(conFaccina, `${file}: titoli con la faccina`).toEqual([]);
  });

  it('la regola riconosce le faccine che c’erano', () => {
    for (const vecchio of ['🎉 Nuovo ordine!', '✅ Ordine ricevuto', '📦 Nuovo ordine ricevuto', '❌ Ordine annullato', '✕ Ordine annullato']) {
      expect(FACCINA.test(vecchio), vecchio).toBe(true);
    }
    expect(FACCINA.test('Nuovo ordine ricevuto')).toBe(false);
  });
});
