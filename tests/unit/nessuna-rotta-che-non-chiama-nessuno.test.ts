import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 22/8/2026 — TRE ENDPOINT COSTRUITI E MAI COLLEGATI A NESSUN BOTTONE.
 *
 * Cercando i loro indirizzi in tutto il repo comparivano solo dentro il file
 * della rotta stessa e nei rispettivi test. Due usavano il modello AI a
 * pagamento; il terzo apriva il portale abbonamento del venditore — cioè un
 * negoziante che paga un canone e non aveva un modo di gestirlo.
 *
 * Codice non chiamato non è codice fermo: è codice che nessuno prova sul
 * campo, che invecchia insieme al resto e che un giorno qualcuno collega
 * credendolo funzionante.
 *
 * Questo guardiano non serve a chiudere quelle tre: serve a impedire la
 * QUARTA. Aggiungi una rotta e non collegarla, e questo diventa rosso.
 */

const RADICE = join(__dirname, '..', '..');
const API = join(RADICE, 'app', 'api');

/**
 * Rotte che nessuno chiama dal codice, e va bene così:
 *  - `cron/`   → le chiama uno scheduler esterno;
 *  - `webhook` → le chiama Stripe;
 *  - i link che arrivano da un'email (conferma, disiscrizione);
 *  - `health`  → la chiama chi sorveglia il sito.
 */
const CHIAMATE_DA_FUORI = [
  /^cron\//,
  /webhook/,
  /^newsletter\//,
  /^unsubscribe/,
  /^health/,
  /^og\//, // immagini di anteprima: le chiedono i social, non il nostro codice
];

/**
 * 22/8/2026 — Le due rotte AI che restano scollegate, dichiarate qui perché si
 * vedano invece di sparire. Non le ho cancellate e non le ho collegate: sono
 * due funzioni di prodotto (risposte alle domande sui prodotti, riassunto
 * delle recensioni) e decidere se servono è una scelta di Nicola, non mia.
 * Finché stanno in questa lista, costano: vanno decise.
 */
const DEBITO_DICHIARATO = new Set([
  'ai/answer-qa',
  'ai/reviews-summary',
]);

function rotte(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) rotte(percorso, dentro);
    else if (voce === 'route.ts' || voce === 'route.tsx') dentro.push(percorso);
  }
  return dentro;
}

function sorgenti(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) sorgenti(percorso, dentro);
    else if (/\.(ts|tsx)$/.test(voce)) dentro.push(percorso);
  }
  return dentro;
}

describe('nessuna rotta che non chiama nessuno', () => {
  const codice = ['app', 'components', 'lib'].flatMap((c) => sorgenti(join(RADICE, c)));

  it('ogni rotta sotto app/api è citata almeno una volta fuori da sé', () => {
    const orfane: string[] = [];

    for (const file of rotte(API)) {
      const indirizzo = relative(API, file).replace(/\\/g, '/').replace(/\/route\.tsx?$/, '');
      if (CHIAMATE_DA_FUORI.some((r) => r.test(indirizzo))) continue;
      if (DEBITO_DICHIARATO.has(indirizzo)) continue;

      // I pezzi dinamici (`[id]`) nel codice sono una variabile:
      // `/api/orders/${id}/cancel`. Cercare la stringa esatta non li trova, e
      // dichiararli orfani sarebbe un falso allarme — la specie di rosso che
      // insegna a ignorare il rosso.
      const cercato = new RegExp(
        '/api/' +
          indirizzo
            .split('/')
            .map((pezzo) =>
              /^\[.+\]$/.test(pezzo)
                ? '[^\'"`\\s]+' // qualunque cosa stia al posto dell'identificativo
                : pezzo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            )
            .join('/'),
      );
      const citata = codice.some((f) => {
        if (f === file) return false;
        return cercato.test(readFileSync(f, 'utf8'));
      });
      if (!citata) orfane.push(indirizzo);
    }

    expect(
      orfane,
      `Queste rotte non le chiama nessuno dal codice del sito. Collegale alla ` +
        `pagina che dovevano servire, oppure cancellale — o, se la decisione ` +
        `spetta a Nicola, mettile in DEBITO_DICHIARATO con scritto perché:\n  ` +
        orfane.join('\n  '),
    ).toEqual([]);
  });

  it('il controllo guarda davvero, non gira a vuoto', () => {
    // Se domani qualcuno rompe la scansione, il controllo sopra resterebbe
    // verde senza aver aperto un file.
    expect(rotte(API).length).toBeGreaterThan(50);
    expect(codice.length).toBeGreaterThan(200);
  });

  it('il portale abbonamento adesso è collegato per davvero', () => {
    // È la rotta che questo lotto ha chiuso: era orfana, ora la chiama il
    // bottone nel profilo del venditore. Se qualcuno toglie il bottone, questa
    // torna rossa prima che il negoziante se ne accorga.
    const citata = codice.some((f) =>
      readFileSync(f, 'utf8').includes('/api/seller/subscription/portal') &&
      !f.includes(join('app', 'api')),
    );
    expect(citata, 'nessuna pagina chiama /api/seller/subscription/portal').toBe(true);
  });
});
