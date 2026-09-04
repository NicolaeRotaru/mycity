import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 3/9/2026 — LE COLONNE CHE SI LEGGONO ERANO CONTROLLATE. QUELLE CHE SI
 * SCRIVONO NO.
 *
 * `nessuna-colonna-che-non-esiste.test.ts` (22/8) confronta con i tipi generati
 * i nomi di colonna dentro le `.select(...)` e dentro i filtri. Restava fuori
 * metà del lavoro: i nomi dentro `.insert({…})`, `.update({…})` e
 * `.upsert({…})` — cioè le SCRITTURE, che è dove ci sono i soldi.
 *
 * PERCHÉ È LA METÀ CHE FA PIÙ MALE. Il database non scarta la colonna che non
 * conosce: rifiuta la scrittura INTERA. E non lancia — restituisce l'errore
 * dentro la risposta, che in questo progetto quasi nessuno legge. Il risultato
 * è la peggiore combinazione possibile: la riga non viene scritta, e chi ha
 * scritto il codice non lo sa. Un caso vero, trovato il 3/9: la copia del
 * carrello sul server nominava `recovered_at`, e per mesi ogni salvataggio è
 * caduto per intero senza una riga nei log.
 *
 * Questo controllo prende le chiavi scritte a mano in ogni insert/update/upsert
 * e le confronta con le colonne dei tipi generati. Diventa rosso il giorno in
 * cui una scrittura nomina una colonna che sulla tabella non c'è — sia perché
 * è stata scritta male, sia perché una migrazione l'ha tolta o rinominata.
 *
 * Se i campi sono in una variabile (`.update(CAMPI_DA_AZZERARE)`) il controllo
 * la segue, ma solo quando nel file c'è UNA sola dichiarazione con quel nome:
 * meglio guardare in meno posti che dire una cosa sbagliata. Sono 14 punti in
 * più, e uno di quei 14 nascondeva un guasto vero (vedi la lista qui sotto).
 *
 * COSA NON COPRE, DETTO CHIARO:
 *  · le variabili che arrivano da un altro file, o costruite pezzo per pezzo;
 *  · le chiavi calcolate (`{ [campo]: valore }`) e quelle sparse (`...altro`);
 *  · le funzioni chiamate via `.rpc()` e le tabelle scelte a runtime;
 *  · e soprattutto: i tipi sono generati da `migrations/`, NON dal database
 *    vero. Questo controllo vede «il codice nomina una colonna che nelle
 *    migrazioni non esiste». NON vede «la migrazione esiste ma nessuno l'ha
 *    ancora applicata in produzione»: quello è un altro guasto, e si difende
 *    nel codice (vedi `lib/cart-sync.ts`), non qui.
 */

/**
 * QUELLO CHE ERA GIÀ ROTTO IL GIORNO IN CUI QUESTO CONTROLLO È NATO.
 *
 * `lib/account/cancellazione.ts` azzera `profiles.avatar_url`, ma su `profiles`
 * quella colonna non c'è: si chiama `public_avatar_url` (migrazione 033, e la
 * 110 lo scrive nero su bianco). Il database rifiuta l'intera riga, quindi lo
 * svuotamento del profilo di chi chiede la cancellazione non avviene MAI.
 * È grave e non è di questa squadra: sta nel territorio di chi lavora su quel
 * file, segnalato all'AD il 3/9/2026. Sta qui perché il controllo nuovo non
 * deve nascere rosso per un guasto che non ha creato lui.
 *
 * Questa lista può solo accorciarsi: quando quella riga è riparata, la voce si
 * toglie e non torna.
 */
const GIA_ROTTE_IL_3_9_2026 = new Set<string>([]); // riparata il 3/9/2026: la lista si e' svuotata e non torna

// ---------------------------------------------------------------------------
// Le colonne di ogni tabella, lette dai tipi generati.
// ---------------------------------------------------------------------------
function colonnePerTabella(): Map<string, Set<string>> {
  const tipi = readFileSync('lib/database.types.ts', 'utf8');
  const mappa = new Map<string, Set<string>>();
  let tabella: string | null = null;
  let dentroRow = false;
  for (const riga of tipi.split('\n')) {
    const inizioTabella = /^ {6}(\w+): \{$/.exec(riga);
    if (inizioTabella) {
      tabella = inizioTabella[1];
      dentroRow = false;
      continue;
    }
    if (tabella && /^ {8}Row: \{$/.test(riga)) {
      dentroRow = true;
      mappa.set(tabella, new Set());
      continue;
    }
    if (dentroRow) {
      if (/^ {8}\}/.test(riga)) { dentroRow = false; continue; }
      const campo = /^ {10}(\w+)\??:/.exec(riga);
      if (campo) mappa.get(tabella as string)!.add(campo[1]);
    }
  }
  return mappa;
}

// ---------------------------------------------------------------------------
// Le colonne che il codice SCRIVE.
// ---------------------------------------------------------------------------

/**
 * Le chiavi di primo livello dell'oggetto passato a insert/update/upsert.
 *
 * Accetta `{ a: 1 }` e `[{ a: 1 }, { b: 2 }]`. NON scende negli oggetti
 * annidati: un campo JSON come `delivery: { city }` contiene chiavi che non
 * sono colonne. Restituisce `null` se l'argomento non è scritto lì (una
 * variabile), perché in quel caso non c'è niente da controllare.
 */
export function chiaviScritte(testo: string, da: number): string[] | null {
  let i = da;
  while (i < testo.length && /\s/.test(testo[i])) i++;
  if (testo[i] !== '{' && testo[i] !== '[') return null;

  const chiavi: string[] = [];
  const pila: string[] = [];
  let attesaChiave = false;

  for (let j = i; j < testo.length; j++) {
    const ch = testo[j];

    // Stringhe e commenti si saltano interi: dentro possono esserci graffe.
    if (ch === "'" || ch === '"' || ch === '`') {
      const apice = ch;
      j++;
      while (j < testo.length && testo[j] !== apice) {
        if (testo[j] === '\\') j++;
        j++;
      }
      continue;
    }
    if (ch === '/' && testo[j + 1] === '/') {
      while (j < testo.length && testo[j] !== '\n') j++;
      continue;
    }
    if (ch === '/' && testo[j + 1] === '*') {
      j += 2;
      while (j < testo.length && !(testo[j] === '*' && testo[j + 1] === '/')) j++;
      j++;
      continue;
    }

    if (ch === '{' || ch === '[' || ch === '(') {
      pila.push(ch);
      attesaChiave = ch === '{';
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      pila.pop();
      attesaChiave = false;
      if (pila.length === 0) break;
      continue;
    }
    if (ch === ',' && pila[pila.length - 1] === '{') {
      attesaChiave = true;
      continue;
    }
    if (!attesaChiave || /\s/.test(ch)) continue;

    // Qui comincia una proprietà.
    attesaChiave = false;
    // È una colonna solo se sopra questo oggetto ci sono al massimo array:
    // `{…}` e `[{…}]` sì, `{ dentro: { … } }` no.
    const dentroUnOggetto = pila[pila.length - 1] === '{';
    const soloArraySopra = pila.slice(0, -1).every((c) => c === '[');
    if (!dentroUnOggetto || !soloArraySopra) continue;

    const nome = /^([A-Za-z_$][\w$]*)\s*(:|,|\}|$)/.exec(testo.slice(j));
    if (nome) chiavi.push(nome[1]);
  }
  return chiavi;
}

/**
 * I campi passati per nome (`.update(CAMPI_DA_AZZERARE)`).
 *
 * Si segue solo se nel file c'è UNA sola dichiarazione con quel nome e se
 * quella dichiarazione è un oggetto scritto lì: due dichiarazioni omonime, o un
 * valore che arriva da fuori, vorrebbero dire indovinare — e un controllo che
 * indovina fa più danni di uno che tace.
 */
function chiaviDellaVariabile(fileIntero: string, dopoLaParentesi: string): string[] | null {
  const nome = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(dopoLaParentesi);
  if (!nome) return null;
  const dichiarazioni = [...fileIntero.matchAll(new RegExp(`\\bconst\\s+${nome[1]}\\b[^=]*=\\s*`, 'g'))];
  if (dichiarazioni.length !== 1) return null;
  const d = dichiarazioni[0];
  return chiaviScritte(fileIntero, (d.index ?? 0) + d[0].length);
}

type Uso = { file: string; tabella: string; colonna: string; verbo: string };

function fileSotto(cartella: string): string[] {
  const trovati: string[] = [];
  for (const voce of readdirSync(cartella)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const percorso = join(cartella, voce);
    if (statSync(percorso).isDirectory()) trovati.push(...fileSotto(percorso));
    else if (voce.endsWith('.ts') || voce.endsWith('.tsx')) trovati.push(percorso);
  }
  return trovati;
}

function scrittureNelCodice(tabelleNote: Map<string, Set<string>>): Uso[] {
  const usi: Uso[] = [];
  for (const f of [...fileSotto('app'), ...fileSotto('lib'), ...fileSotto('components')]) {
    const testo = readFileSync(f, 'utf8');
    const re = /\.from\(\s*'(\w+)'\s*\)([\s\S]{0,900})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(testo)) !== null) {
      const tabella = m[1];
      if (!tabelleNote.has(tabella)) continue; // vista o funzione: non la copriamo
      // Il blocco si ferma alla query successiva, altrimenti la scrittura di
      // quella dopo verrebbe attribuita a questa tabella.
      const grezza = m[2];
      const prossima = grezza.indexOf('.from(');
      const coda = prossima >= 0 ? grezza.slice(0, prossima) : grezza;

      for (const verbo of ['insert', 'update', 'upsert']) {
        const rv = new RegExp(`\\.${verbo}\\(`, 'g');
        let mv: RegExpExecArray | null;
        while ((mv = rv.exec(coda)) !== null) {
          const chiavi =
            chiaviScritte(coda, mv.index + mv[0].length) ??
            chiaviDellaVariabile(testo, coda.slice(mv.index + mv[0].length));
          if (!chiavi) continue;
          for (const colonna of chiavi) usi.push({ file: f, tabella, colonna, verbo });
        }
      }
    }
  }
  return usi;
}

describe('nessuna scrittura nomina una colonna che non esiste', () => {
  const tabelle = colonnePerTabella();
  const scritture = scrittureNelCodice(tabelle);

  it('le chiavi si leggono davvero (se no, questo controllo non prova niente)', () => {
    // Un parser che non trova niente passerebbe sempre. Il 3/9/2026 le
    // scritture lette erano 440 su 41 tabelle: qui si pretende che continui a
    // vederle. Se questo numero crolla, il controllo è diventato finto.
    expect(scritture.length).toBeGreaterThan(400);
    expect(new Set(scritture.map((u) => u.tabella)).size).toBeGreaterThan(30);
  });

  it('non scende dentro i campi JSON e non scambia i valori per colonne', () => {
    // `delivery` è una colonna; `city`, che sta dentro, non lo è. E `true`,
    // che è un valore, non deve finire fra le colonne.
    const chiavi = chiaviScritte('({ delivery: { city: "Piacenza" }, recovered: true })', 1);
    expect(chiavi).toEqual(['delivery', 'recovered']);
    // Un elenco di righe: le chiavi sono quelle di ogni oggetto.
    expect(chiaviScritte('([{ a: 1 }, { b: 2 }])', 1)).toEqual(['a', 'b']);
    // Una variabile non si può controllare, e infatti non si prova.
    expect(chiaviScritte('(righe)', 1)).toBeNull();
  });

  it('ogni colonna scritta esiste sulla sua tabella', () => {
    const sbagliate = scritture.filter(
      (u) =>
        !tabelle.get(u.tabella)!.has(u.colonna) &&
        !GIA_ROTTE_IL_3_9_2026.has(`${u.file}::${u.tabella}.${u.colonna}`),
    );
    const elenco = sbagliate.map((u) => `${u.file}: ${u.tabella}.${u.colonna} (${u.verbo})`);
    expect(
      elenco,
      `queste scritture nominano colonne che sulla tabella non esistono — il database rifiuta la riga INTERA e non se ne accorge nessuno:\n  ${elenco.join('\n  ')}`,
    ).toEqual([]);
  });
});
