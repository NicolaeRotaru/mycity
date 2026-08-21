import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CAMPI_124, COLONNE_124 } from '@/lib/db/migrazione-124';

/**
 * IL FRENO: nessun campo nuovo di schema entra in un'istruzione senza ripiego.
 *
 * La lezione costa un mattino. Il lotto del 21 agosto e' stato unito, l'unione
 * ha pubblicato il codice, e applicare la migrazione al database e' una firma
 * a parte: per tutta la finestra fra le due non e' nato nessun ordine, perche'
 * PostgreSQL non ignora una colonna che non conosce — fa fallire l'istruzione
 * intera.
 *
 * Una lezione scritta in un documento non ferma niente. Questo controllo si':
 * ogni file che nomina una colonna della 124 deve anche importare il ripiego.
 * Chi aggiunge un settimo punto di chiamata senza copertura trova rosso qui,
 * prima dell'unione, invece di scoprirlo dal sito fermo.
 *
 * Quando la 124 e' applicata dappertutto, questo controllo se ne va insieme al
 * ripiego — non prima.
 */

const RADICE = join(__dirname, '..', '..');
const CARTELLE = ['app', 'lib'];
const RIPIEGO = '@/lib/db/migrazione-124';

/** I file che il ripiego lo definiscono o lo provano: non devono importarlo. */
const ESENTI = new Set([
  'lib/db/migrazione-124.ts',
  'lib/database.types.ts', // i tipi generati descrivono lo schema, non lo interrogano
]);

function sorgenti(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) sorgenti(percorso, dentro);
    else if (/\.(ts|tsx)$/.test(voce)) dentro.push(percorso);
  }
  return dentro;
}

/** Le istruzioni che il database rifiuta intere se una colonna non esiste. */
const ISTRUZIONE = /\.(insert|update|select|upsert)\(/;

// `.rpc(` sta fuori apposta, e non per dimenticanza. Una funzione che ancora
// non esiste non ha un «senza»: la strada e' nuova per intero, e chiamarla
// prima della migrazione da' un errore che l'utente vede e capisce («non e'
// stato possibile chiudere il ritiro»), non un ordine che sparisce in
// silenzio. Il danno che questo controllo previene e' l'altro: un'istruzione
// che funzionava ieri e oggi fallisce intera per una colonna di troppo.

describe('nessuna colonna della migrazione 124 viaggia senza ripiego', () => {
  const nuove = [...new Set([...CAMPI_124, ...COLONNE_124])];

  it('ogni file che le nomina dentro un istruzione importa il ripiego', () => {
    const scoperti: string[] = [];

    for (const cartella of CARTELLE) {
      for (const file of sorgenti(join(RADICE, cartella))) {
        const rel = relative(RADICE, file).replace(/\\/g, '/');
        if (ESENTI.has(rel)) continue;

        const testo = readFileSync(file, 'utf8');
        const nomina = nuove.some((c) => testo.includes(c));
        if (!nomina || !ISTRUZIONE.test(testo)) continue;
        if (testo.includes(RIPIEGO)) continue;

        scoperti.push(rel);
      }
    }

    // Il messaggio deve dire cosa fare, non solo che e' rosso: chi lo trova fra
    // sei mesi non ha in testa la mattina del 21 agosto.
    expect(
      scoperti,
      `Questi file usano una colonna che esiste solo dopo la migrazione 124, ` +
        `dentro un'istruzione al database, senza il ripiego di ${RIPIEGO}. ` +
        `Finche' la 124 non e' applicata ovunque, il database rifiuta l'istruzione ` +
        `INTERA e quella strada del sito si ferma. Avvolgi la chiamata in ` +
        `conRipiegoSchema(), come negli altri sei punti:\n  ${scoperti.join('\n  ')}`,
    ).toEqual([]);
  });

  it('il controllo guarda davvero dentro i file, non gira a vuoto', () => {
    // Se domani qualcuno svuota CAMPI_124 o rompe la scansione, il controllo
    // sopra resterebbe verde senza guardare niente. Questo lo impedisce.
    expect(nuove.length).toBeGreaterThan(0);
    const tutti = CARTELLE.flatMap((c) => sorgenti(join(RADICE, c)));
    expect(tutti.length).toBeGreaterThan(100);
    const coperti = tutti.filter((f) => readFileSync(f, 'utf8').includes(RIPIEGO));
    // I sei punti di chiamata piu' i loro file: se scendono a zero, il ripiego
    // e' stato tolto e questo controllo non ha piu' senso di esistere.
    expect(coperti.length).toBeGreaterThanOrEqual(6);
  });
});
