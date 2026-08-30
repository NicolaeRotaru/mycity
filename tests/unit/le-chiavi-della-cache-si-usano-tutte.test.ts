import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

/** Chi cita `dominio.nome` in tutto il progetto, tolta la sua definizione. */
function chiLaUsa(dominio: string, nome: string): string[] {
  try {
    const uscita = execFileSync(
      'rg',
      ['-l', '--glob', '!node_modules', '--glob', '!.next', `\\b${dominio}\\.${nome}\\b`, '.'],
      { encoding: 'utf8' },
    );
    return uscita.split('\n').filter(Boolean);
  } catch {
    // rg esce con 1 quando non trova niente: e' proprio il caso che interessa.
    return [];
  }
}

describe('le chiavi della cache', () => {
  const chiavi = chiaviDefinite();

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
