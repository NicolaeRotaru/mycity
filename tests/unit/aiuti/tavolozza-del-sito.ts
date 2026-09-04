import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * La tavolozza VERA del sito, letta da `tailwind.config.ts`.
 *
 * Serve alle prove che sorvegliano posti dove il colore non passa da Tailwind e
 * quindi si scrive a mano: le email (il server della posta non ha il CSS) e la
 * personalizzazione della vetrina (l'accent finisce inline nello `style`). In
 * quei posti nessuno accorge se un colore esce dal design system — è successo
 * con l'indigo della vecchia veste, rimasto nelle ricevute mesi dopo il
 * passaggio a terracotta.
 *
 * Leggere il file invece di ricopiare gli esadecimali è il punto: se domani la
 * tavolozza cambia, le prove seguono da sole, e i posti scritti a mano che non
 * hanno seguito diventano rossi.
 */

const CONFIG = readFileSync(join(process.cwd(), 'tailwind.config.ts'), 'utf8');

function leggi(): Map<string, string> {
  const apertura = 'colors: {';
  const inizio = CONFIG.indexOf(apertura);
  const fine = CONFIG.indexOf('zIndex: {');
  if (inizio < 0 || fine <= inizio) {
    throw new Error('tailwind.config.ts non ha più il blocco `colors`: questa prova non sa più cosa leggere');
  }
  // Si parte DOPO `colors: {`, altrimenti la prima famiglia trovata è «colors».
  const blocco = CONFIG.slice(inizio + apertura.length, fine);

  const colori = new Map<string, string>();
  for (const famiglia of blocco.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
    for (const tono of famiglia[2].matchAll(/(\d+):\s*'(#[0-9A-Fa-f]{6})'/g)) {
      colori.set(`${famiglia[1]}-${tono[1]}`, tono[2].toUpperCase());
    }
  }
  if (colori.size < 40) {
    throw new Error(`dalla tavolozza sono usciti solo ${colori.size} colori: il lettore si è rotto`);
  }
  return colori;
}

/** `primary-700` → `#A03B25`, per ognuno dei toni dichiarati nel design system. */
export const TAVOLOZZA: ReadonlyMap<string, string> = leggi();

/** Tutti gli esadecimali ammessi, in maiuscolo. */
export const COLORI_DEL_SITO: ReadonlySet<string> = new Set(TAVOLOZZA.values());

/** Il colore di un tono preciso; esplode se quel tono non esiste più. */
export function colore(nome: string): string {
  const hex = TAVOLOZZA.get(nome);
  if (!hex) throw new Error(`${nome} non esiste (più) nella tavolozza di tailwind.config.ts`);
  return hex;
}

/** Ogni esadecimale scritto dentro un testo (HTML di un'email, sorgente, …), in maiuscolo. */
export function esadecimaliIn(testo: string): string[] {
  return [...testo.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());
}
