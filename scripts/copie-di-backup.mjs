#!/usr/bin/env node
/**
 * QUALE COPIA SI RIAPRE, QUANDO SE NE PROVA IL RIPRISTINO.
 *
 * Radiografia del 27/8/2026 (R179). Ogni notte `scripts/backup-db.sh` scrive
 * DUE file cifrati nella stessa cartella e nello stesso secondo:
 *
 *   mycity_<data>.dump.gpg          ← il database: prodotti, ordini, negozi
 *   mycity_<data>_utenti.dump.gpg   ← la sola tabella degli utenti (auth.users)
 *
 * La prova mensile di ripristino li sceglieva con `ls -t | head -1`, cioe' «il
 * piu' recente». Ma i due nascono a un secondo di distanza o meno, e quale dei
 * due vinca quel confronto non lo decide nessuno: dipende da come il sistema
 * ordina due file di pari data. La prova che deve dirci «la copia si riapre»
 * poteva quindi riaprire la tabella degli utenti — trecento righe — e
 * dichiararsi soddisfatta senza aver mai toccato il database vero.
 *
 * Una copia di sicurezza non provata non e' una copia di sicurezza: e' una
 * speranza. Qui la scelta si fa per NOME, che e' l'unica cosa che distingue i
 * due file per davvero, e si restituiscono tutti e due — perche' un ripristino
 * completo li vuole entrambi, nell'ordine giusto.
 */


/**
 * Il nome dice tutto: `mycity_<data>[_utenti].dump[.gpg]`. Una regola sola,
 * invece di una catena di sostituzioni che su un caso o sull'altro lasciava
 * pezzi attaccati alla data e faceva sfuggire la coppia.
 */
const NOME = /^mycity_(.+?)(_utenti)?\.dump(\.gpg)?$/;

/**
 * Sceglie la coppia piu' recente fra i file di una cartella di backup.
 *
 * @param {string[]} file elenco di percorsi o nomi
 * @returns {{principale: string|null, utenti: string|null, data: string|null}}
 */
export function scegliCopie(file) {
  // Si raggruppa per istante di backup, cosi' principale e utenti restano una
  // coppia coerente: riaprire il database di ieri con gli utenti di oggi
  // darebbe un risultato che non e' mai esistito.
  const perData = new Map();
  for (const f of file) {
    const pezzi = NOME.exec(f.replace(/^.*\//, ''));
    if (!pezzi) continue;
    const [, data, eUtenti] = pezzi;
    if (!perData.has(data)) perData.set(data, { principale: null, utenti: null });
    if (eUtenti) perData.get(data).utenti = f;
    else perData.get(data).principale = f;
  }

  if (perData.size === 0) return { principale: null, utenti: null, data: null };

  const piuRecente = [...perData.keys()].sort().pop();
  const gruppo = perData.get(piuRecente);
  return { principale: gruppo.principale, utenti: gruppo.utenti, data: piuRecente };
}

// Avviato dal lavoro di backup: stampa il file richiesto, o esce con errore.
// `node scripts/copie-di-backup.mjs principale <cartella-elencata-su-stdin>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const quale = process.argv[2] === 'utenti' ? 'utenti' : 'principale';
  const elenco = (await new Promise((r) => {
    let dati = '';
    process.stdin.on('data', (c) => { dati += c; });
    process.stdin.on('end', () => r(dati));
  }))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const scelte = scegliCopie(elenco);
  if (!scelte[quale]) {
    console.error(
      `Nessuna copia «${quale}» nella cartella. ` +
        'Se manca la principale, la prova di ripristino non ha niente da provare.',
    );
    process.exit(1);
  }
  console.log(scelte[quale]);
}
