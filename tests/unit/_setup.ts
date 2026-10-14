/**
 * 8/9/2026 — QUELLO CHE SEMBRAVA UN PROBLEMA DI ORDINE ERA LA RETE.
 *
 * Cinque prove della cassa sono diventate rosse su un computer di GitHub e verdi su un
 * altro, sullo stesso identico commit. Non era l'ordine dei file: era che
 * `lib/geocodifica.ts` chiama davvero `nominatim.openstreetmap.org`, e nessuna di quelle
 * prove lo mockava. Dove la rete rispondeva, l'indirizzo del cliente finiva a Palermo
 * mentre il negozio finto stava a Milano, la rotta diceva «fuori zona» e rispondeva 400.
 * Dove la rete non rispondeva, le coordinate restavano vuote e la rotta rispondeva 200.
 *
 * Cioè: il verdetto della prova lo decideva un servizio di altri, e il momento in cui
 * girava. Riprodotto facendo rispondere quella chiamata con coordinate lontane: gli
 * stessi cinque rossi, con lo stesso messaggio della corsa vera.
 *
 * Qui si chiude alla radice, per tutte le prove insieme e non una per una.
 */
import { afterEach, beforeEach } from 'vitest';

/**
 * ① LA RETE NON SI TOCCA.
 *
 * Non la si finge silenziosamente: si FERMA, con un messaggio che dice cosa fare. Una
 * prova che va in rete non è una prova unitaria, e un finto silenzioso avrebbe lasciato
 * credere di aver provato una cosa che non è stata provata.
 */
const reteVietata = (async (input: unknown) => {
  const dove = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input).slice(0, 120);
  throw new Error(
    `Prova unitaria che va in rete: ${dove}\n` +
      `Non si fa: il verdetto dipenderebbe da un servizio di altri e dal momento in cui gira.\n` +
      `Mocka il modulo che chiama (per esempio vi.mock('@/lib/geocodifica')), non la rete.`,
  );
}) as unknown as typeof fetch;

/**
 * Il divieto si installa UNA VOLTA, quando questo file viene caricato — cioè all'inizio di
 * ogni file di prova. Non si tocca `fetch` a ogni prova, e la ragione l'ho imparata
 * sbagliando: il primo tentativo lo riassegnava in `beforeEach`, e cancellava gli stub
 * legittimi che quattro file installano con `vi.stubGlobal` a inizio file (il captcha, il
 * copilot, il dettato). Nove prove sane diventate rosse per colpa del guardiano.
 *
 * Installandolo qui e basta: chi ha bisogno di una risposta finta se la mette e vince,
 * chi non fa niente trova la porta chiusa. E siccome questo file gira per OGNI file di
 * prova, quello che un file lascia su `globalThis` non arriva al file dopo.
 */
globalThis.fetch = reteVietata;

/**
 * ② LE VARIABILI D'AMBIENTE TORNANO COME LE HO TROVATE.
 *
 * Quarantuno file di prova scrivono dentro `process.env` e almeno dieci non rimettono a
 * posto niente. `process.env` è di tutto il processo, non del file: quello che uno lascia
 * in giro lo trova il prossimo, e quale sia «il prossimo» cambia a ogni corsa. Qui la
 * pulizia si fa una volta per tutti, invece di ricordarsene in ogni file.
 */
let istantaneaEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  istantaneaEnv = { ...process.env };
});

afterEach(() => {
  for (const chiave of Object.keys(process.env)) {
    if (!(chiave in istantaneaEnv)) delete process.env[chiave];
  }
  for (const [chiave, valore] of Object.entries(istantaneaEnv)) {
    if (process.env[chiave] === valore) continue;
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
});
