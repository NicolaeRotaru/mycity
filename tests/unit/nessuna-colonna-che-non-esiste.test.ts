import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 22/8/2026 — LA COLONNA CHE NON ESISTE, E CHE NESSUN CONTROLLO VEDEVA.
 *
 * Il pulsante «scarica i miei dati» chiedeva `orders.buyer_id`: una colonna che
 * su quella tabella non c'è — si chiama `user_id`, e `buyer_id` era stato
 * copiato da un'altra tabella dove esiste davvero. PostgREST rifiuta l'INTERA
 * lettura, il codice scartava l'errore, e l'esportazione usciva senza gli
 * ordini dicendo che era andato tutto bene.
 *
 * Il punto non è quella riga: è che `npm run verify` restava VERDE. I tipi del
 * database sono generati — 2894 righe in `lib/database.types.ts` — e nessun
 * client li usa: le stringhe delle query non le controlla nessuno, quindi un
 * errore di schema non si vede a compilazione. Si vede in produzione, sui
 * percorsi dei soldi.
 *
 * Tipizzare tutti i client in un colpo produce quasi duecento errori e non è un
 * lavoro da fare di fretta sul percorso dei pagamenti. Questo controllo prende
 * la stessa strada dall'altro capo: legge le query scritte nel codice, ne
 * estrae i nomi di colonna e li confronta con i tipi generati. Copre TUTTE le
 * chiamate, oggi, e diventa rosso il giorno in cui ne entra una sbagliata.
 *
 * Cosa NON copre, detto chiaro: le funzioni chiamate via `.rpc()`, le viste
 * costruite a runtime e le colonne dentro stringhe composte. Non è un
 * sostituto della tipizzazione: è il freno che regge finché quella arriva.
 */

// ---------------------------------------------------------------------------
// Le colonne di ogni tabella, lette dai tipi generati.
// ---------------------------------------------------------------------------
function colonnePerTabella(): Map<string, Set<string>> {
  const tipi = readFileSync('lib/database.types.ts', 'utf8');
  const mappa = new Map<string, Set<string>>();

  // Struttura del file: `      <tabella>: {` … `        Row: {` … `        }`
  const righe = tipi.split('\n');
  let tabella: string | null = null;
  let dentroRow = false;
  for (const riga of righe) {
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
// Le colonne che il codice chiede, lette dalle query.
// ---------------------------------------------------------------------------
type Uso = { file: string; tabella: string; colonna: string };

/** `.eq('colonna', …)` e simili: un solo nome di colonna, facile e sicuro. */
const FILTRI = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains'];

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

function usiNelCodice(tabelleNote: Map<string, Set<string>>): Uso[] {
  const usi: Uso[] = [];
  for (const f of [...fileSotto('app'), ...fileSotto('lib'), ...fileSotto('components')]) {
    const testo = readFileSync(f, 'utf8');
    // `.from('tabella')` seguito, entro poche righe, da `.select('a, b, c')`
    // e/o da filtri. Si guarda solo il blocco che segue immediatamente.
    const re = /\.from\(\s*'(\w+)'\s*\)([\s\S]{0,600})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(testo)) !== null) {
      const tabella = m[1];
      if (!tabelleNote.has(tabella)) continue; // vista o funzione: non la copriamo
      // Il blocco si ferma alla query successiva: senza questo taglio, la
      // `select` della query dopo verrebbe attribuita a questa tabella.
      const grezza = m[2];
      const prossima = grezza.indexOf('.from(');
      const coda = prossima >= 0 ? grezza.slice(0, prossima) : grezza;

      // La select, se è una stringa semplice (niente template, niente join).
      const sel = /\.select\(\s*'([^']*)'/.exec(coda);
      if (sel && !sel[1].includes('(') && !sel[1].includes('*')) {
        for (const pezzo of sel[1].split(',')) {
          const nome = pezzo.trim().split(':')[0].trim();
          if (/^\w+$/.test(nome)) usi.push({ file: f, tabella, colonna: nome });
        }
      }

      // I filtri.
      for (const filtro of FILTRI) {
        const rf = new RegExp(`\\.${filtro}\\(\\s*'(\\w+)'`, 'g');
        let mf: RegExpExecArray | null;
        while ((mf = rf.exec(coda)) !== null) {
          usi.push({ file: f, tabella, colonna: mf[1] });
        }
      }
    }
  }
  return usi;
}

describe('nessuna query chiede una colonna che non esiste', () => {
  const tabelle = colonnePerTabella();

  it('i tipi generati si leggono davvero (se no, questo controllo non prova niente)', () => {
    expect(tabelle.size).toBeGreaterThan(50);
    expect(tabelle.get('orders')?.has('user_id')).toBe(true);
    // La colonna del difetto: su `orders` NON c'è.
    expect(tabelle.get('orders')?.has('buyer_id')).toBe(false);
    // Ma su `returns` sì: è da lì che era stata copiata.
    expect(tabelle.get('returns')?.has('buyer_id')).toBe(true);
  });

  it('ogni colonna chiesta nel codice esiste sulla sua tabella', () => {
    const sbagliate = usiNelCodice(tabelle).filter(
      (u) => !tabelle.get(u.tabella)!.has(u.colonna),
    );
    const elenco = sbagliate.map((u) => `${u.file}: ${u.tabella}.${u.colonna}`);
    expect(
      elenco,
      `queste query chiedono colonne che sulla tabella non esistono:\n  ${elenco.join('\n  ')}`,
    ).toEqual([]);
  });
});
