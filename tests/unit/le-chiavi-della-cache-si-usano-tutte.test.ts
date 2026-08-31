import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryKeys } from '@/lib/queries/keys';

/**
 * 30/8/2026 (R012) — CINQUANTADUE CHIAVI DELLA CACHE SU CENTOTTANTASEI NON LE
 * USAVA NESSUNO, E TRE COPPIE ERANO DOPPIONI.
 *
 * Il costo non era la memoria — sono stringhe. Era che chi apriva
 * `lib/queries/keys.ts` per capire quale chiave usare ne trovava due
 * plausibili: `health` accanto a `healthV2`, `public` accanto a `publicV2`,
 * `onboardingChecklist` accanto alla sua copia. Sceglieva, e aveva il 50% di
 * probabilita' di scegliere quella che non usa nessun altro.
 *
 * Cosa succede quando si sbaglia: il negoziante cambia qualcosa, la pagina fa
 * rileggere una chiave che non e' quella con cui il dato era stato letto, e lui
 * continua a vedere il valore vecchio. Nessun errore, nessun rosso da nessuna
 * parte: solo un dato che non si aggiorna. E' cosi' che erano nate quattro
 * richieste di aggiornamento della cache andate a vuoto.
 *
 * QUESTA PROVA NON CERCA UNA PAROLA IN UN FILE: legge le chiavi DAL MODULO
 * (l'oggetto vero, come lo vede chi lo importa) e poi va a vedere, nel
 * repository intero, se qualcuno le usa. Una chiave nuova che nessuno chiama la
 * fa diventare rossa.
 */

/** I nomi delle chiavi, presi dall'oggetto vero e non dal testo del file. */
function chiaviDefinite(): Array<{ dominio: string; nome: string }> {
  const fuori: Array<{ dominio: string; nome: string }> = [];
  for (const [dominio, voci] of Object.entries(queryKeys)) {
    for (const nome of Object.keys(voci as Record<string, unknown>)) {
      fuori.push({ dominio, nome });
    }
  }
  return fuori;
}

/**
 * 31/8/2026 — LA RICERCA NON SI APPOGGIA PIU' A UN PROGRAMMA ESTERNO.
 *
 * Prima questa prova chiamava `rg` (ripgrep) e aveva un `catch` solo: quando il
 * comando falliva rispondeva «nessuno la usa». Ma `rg` fallisce in DUE modi
 * diversi — «ho cercato e non ho trovato niente» (uscita 1) e «non esisto su
 * questa macchina» (ENOENT) — e il catch li trattava uguali.
 *
 * Sul computer di chi ha scritto la prova `rg` c'era, e la prova era verde. Sul
 * server della CI `rg` NON c'e': tutte e 130 le chiavi risultavano non usate da
 * nessuno, e la prova bocciava il lotto intero. Ha bloccato sette giri di CI di
 * fila mentre in casa risultava tutto a posto.
 *
 * Adesso i file li legge Node, che c'e' sempre. E soprattutto: se la lettura non
 * raccoglie niente, la prova lo DICE invece di concludere che nessuno usa
 * niente. Un verde che non ha guardato nessun file non e' un verde.
 */
const SORGENTI = leggiSorgenti();

function leggiSorgenti(): Array<{ percorso: string; testo: string }> {
  const fuori: Array<{ percorso: string; testo: string }> = [];
  const salta = new Set(['node_modules', '.next', '.git', 'coverage', 'test-results', 'playwright-report']);
  const giro = (cartella: string) => {
    for (const voce of readdirSync(cartella, { withFileTypes: true })) {
      if (voce.name.startsWith('.') && voce.name !== '.') continue;
      const percorso = join(cartella, voce.name);
      if (voce.isDirectory()) {
        if (!salta.has(voce.name)) giro(percorso);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(voce.name)) continue;
      fuori.push({ percorso, testo: readFileSync(percorso, 'utf8') });
    }
  };
  giro('.');
  return fuori;
}

/** Chi cita `dominio.nome` in tutto il progetto, tolta la sua definizione. */
function chiLaUsa(dominio: string, nome: string): string[] {
  const cerca = new RegExp(`\\b${dominio}\\.${nome}\\b`);
  return SORGENTI.filter((f) => cerca.test(f.testo)).map((f) => f.percorso);
}

describe('le chiavi della cache', () => {
  const chiavi = chiaviDefinite();

  /*
   * 31/8/2026 — LA SENTINELLA CHE MANCAVA. Senza questa, una ricerca che non
   * legge nessun file conclude «nessuno usa niente» ed e' rossa per il motivo
   * sbagliato — oppure, se il verso della prova fosse l'opposto, verde senza
   * aver guardato. Il numero non e' tondo apposta: e' il piano del progetto.
   */
  it('ha davvero letto i file del progetto, altrimenti non sta misurando niente', () => {
    expect(
      SORGENTI.length,
      'la lettura dei sorgenti non ha raccolto quasi niente: qualunque cosa dica dopo, non ha guardato il progetto',
    ).toBeGreaterThan(200);
    expect(
      SORGENTI.some((f) => f.percorso.includes('lib/queries/keys')),
      'fra i file letti manca proprio quello che definisce le chiavi',
    ).toBe(true);
  });

  it('ce ne sono, e sono lette dal modulo vero', () => {
    expect(chiavi.length).toBeGreaterThan(50);
  });

  it('non ce n e nessuna che non usa nessuno', () => {
    const orfane = chiavi
      .filter(({ dominio, nome }) => chiLaUsa(dominio, nome).length === 0)
      .map(({ dominio, nome }) => `${dominio}.${nome}`);

    expect(
      orfane,
      `Queste chiavi della cache non le chiama nessuno: ${orfane.join(', ')}. `
        + 'Una chiave in piu non costa memoria, costa che il prossimo che apre il file ne trova due '
        + 'plausibili e sceglie quella sbagliata: la pagina fa rileggere un dato diverso da quello che '
        + 'sta mostrando, e chi guarda continua a vedere il valore vecchio.',
    ).toEqual([]);
  });

  it('non sono tornati i doppioni «e la sua copia numero due»', () => {
    const nomi = chiavi.map(({ dominio, nome }) => `${dominio}.${nome}`);
    const sospette = nomi.filter((n) => /(V2|2)$/.test(n));
    expect(
      sospette,
      `Una chiave e la sua copia numero due sono due modi di dire la stessa cosa: ${sospette.join(', ')}`,
    ).toEqual([]);
  });

  it('e nessuna coppia porta allo stesso identico posto', () => {
    // Due nomi diversi che producono la stessa chiave sono un doppione
    // travestito: chi ne invalida uno crede di aver toccato l'altro.
    const perValore = new Map<string, string[]>();
    for (const { dominio, nome } of chiavi) {
      const voce = (queryKeys as unknown as Record<string, Record<string, unknown>>)[dominio][nome];
      const valore = typeof voce === 'function' ? null : JSON.stringify(voce);
      if (!valore) continue;
      perValore.set(valore, [...(perValore.get(valore) ?? []), `${dominio}.${nome}`]);
    }
    const gemelle = [...perValore.values()].filter((n) => n.length > 1);
    expect(gemelle, `chiavi diverse che puntano allo stesso posto: ${JSON.stringify(gemelle)}`).toEqual([]);
  });

  it('il file non e tornato un archivio', () => {
    const righe = readFileSync('lib/queries/keys.ts', 'utf8').split('\n').length;
    expect(righe, 'lib/queries/keys.ts sta ricrescendo').toBeLessThan(300);
  });
});
