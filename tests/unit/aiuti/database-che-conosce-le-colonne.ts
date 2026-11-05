/**
 * 26/10/2026 — UN DATABASE FINTO CHE CONOSCE LE COLONNE VERE DI OGNI TABELLA.
 *
 * Le colonne le prende da `lib/database.types.ts`, che è generato dalle migrazioni. Una domanda
 * che chiede una colonna che nessuna migrazione ha creato fallisce TUTTA col codice 42703, come
 * fa PostgREST vero — anche quando la colonna sbagliata sta dentro un aggancio
 * (`opener:profiles!disputes_opener_id_fkey ( full_name, email )`). È esattamente la forma che
 * ha nascosto `profiles.email` in tre posti: il controllo esistente guarda solo le colonne di
 * primo livello, e l'email sta in `auth.users`, non in `profiles`.
 *
 * Con `cade: true` ogni lettura risponde come un database che scade (57014): serve a provare che
 * una pagina non trasforma la caduta in un elenco vuoto.
 *
 * Limite dichiarato: i filtri si applicano solo a `.single()` / `.maybeSingle()`. Le prove che lo
 * usano guardano QUALI colonne si chiedono e SE l'errore arriva, non quali righe si filtrano.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const TIPI = readFileSync(path.resolve(__dirname, '../../../lib/database.types.ts'), 'utf8');

/**
 * 5/11/2026 (S04, schede 1807 e 1808) — LE CHIAVI ESTERNE, LETTE DALLE MIGRAZIONI.
 *
 * I tipi generati non portano i legami fra tabelle (`Relationships: []`): l'aiuto accettava
 * qualunque `!nome_fkey`, anche inventato, che PostgREST vero rifiuta con PGRST200; e non sapeva
 * risolvere un aggancio per colonna (`seller:seller_id ( … )`). Qui i legami si leggono dalle
 * migrazioni: il nome esplicito (`CONSTRAINT x FOREIGN KEY (col) REFERENCES t`) o quello che
 * Postgres dà da solo a un `col … REFERENCES t` scritto nella tabella (`<tabella>_<col>_fkey`).
 */
type Legame = { tabella: string; colonna: string; verso: string };
const LEGAMI: Map<string, Legame> = (() => {
  const mappa = new Map<string, Legame>();
  const cartella = path.resolve(__dirname, '../../../migrations');
  const nomeTabella = (t: string) => t.replace(/^public\./, '').replace(/"/g, '');
  for (const file of readdirSync(cartella).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(path.join(cartella, file), 'utf8').replace(/--[^\n]*/g, '');
    // Colonne scritte con REFERENCES dentro CREATE TABLE.
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([\w."]+)\s*\(([\s\S]*?)\n\);/gi)) {
      const tabella = nomeTabella(m[1]);
      for (const r of m[2].matchAll(/^\s*"?([a-z_][a-z0-9_]*)"?\s+[^,\n]*?REFERENCES\s+([\w."]+)/gim)) {
        const verso = nomeTabella(r[2]).replace(/^auth\./, 'auth.');
        mappa.set(`${tabella}_${r[1]}_fkey`, { tabella, colonna: r[1], verso });
      }
    }
    // Colonne aggiunte dopo: ALTER TABLE t ADD COLUMN [IF NOT EXISTS] col … REFERENCES x.
    for (const m of sql.matchAll(/ALTER TABLE(?: IF EXISTS)?(?: ONLY)?\s+([\w."]+)([\s\S]*?);/gi)) {
      const tabella = nomeTabella(m[1]);
      for (const r of m[2].matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?\s+[^,]*?REFERENCES\s+([\w."]+)/gi)) {
        mappa.set(`${tabella}_${r[1]}_fkey`, { tabella, colonna: r[1], verso: nomeTabella(r[2]) });
      }
      for (const r of m[2].matchAll(/ADD CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?\s+FOREIGN KEY\s*\(\s*"?([a-z_][a-z0-9_]*)"?\s*\)\s*REFERENCES\s+([\w."]+)/gi)) {
        mappa.set(r[1], { tabella, colonna: r[2], verso: nomeTabella(r[3]) });
      }
    }
  }
  return mappa;
})();

/** Il legame con quel nome, se una migrazione l'ha creato. */
export function legame(nome: string): Legame | null {
  return LEGAMI.get(nome) ?? null;
}

export type Guasto = { code: string; message: string };
type Riga = Record<string, unknown>;
type Voce = { colonna: string } | { tabella: string; voci: Voce[]; suggerimento?: string };

/** Le colonne della riga di una tabella, lette dai tipi generati. `null` se la tabella non c'è. */
export function colonneDellaTabella(tabella: string): string[] | null {
  const inizio = TIPI.search(new RegExp(`\\n\\s+${tabella}: \\{\\s*\\n\\s+Row: \\{`));
  if (inizio < 0) return null;
  const daRow = TIPI.indexOf('Row: {', inizio) + 'Row: {'.length;
  const fine = TIPI.indexOf('};', daRow);
  return [...TIPI.slice(daRow, fine).matchAll(/^\s+([a-z_][a-z0-9_]*)\??:/gim)].map((m) => m[1]);
}

/** Divide una select alle virgole di primo livello: quelle dentro un aggancio restano insieme. */
function spezza(select: string): string[] {
  const pezzi: string[] = [];
  let profondita = 0;
  let corrente = '';
  for (const ch of select) {
    if (ch === '(') profondita++;
    if (ch === ')') profondita--;
    if (ch === ',' && profondita === 0) {
      pezzi.push(corrente);
      corrente = '';
    } else {
      corrente += ch;
    }
  }
  pezzi.push(corrente);
  return pezzi.map((p) => p.trim()).filter(Boolean);
}

export function leggiSelect(select: string): Voce[] {
  return spezza(select).map((pezzo) => {
    const aperta = pezzo.indexOf('(');
    if (aperta < 0) {
      const senzaCast = pezzo.split('::')[0];
      const nome = senzaCast.includes(':') ? senzaCast.split(':').pop() ?? '' : senzaCast;
      // Un percorso JSON (`metadata->>foo`, `dati->a->b`) legge la colonna prima della freccia.
      return { colonna: nome.split('->')[0].trim() };
    }
    const testa = pezzo.slice(0, aperta).trim();
    const dentro = pezzo.slice(aperta + 1, pezzo.lastIndexOf(')'));
    const [tabella, suggerimento] = (testa.includes(':') ? testa.split(':').pop() ?? '' : testa).split('!').map((x) => x.trim());
    return { tabella, voci: leggiSelect(dentro), ...(suggerimento ? { suggerimento } : {}) };
  });
}

function mancanti(tabella: string, voci: Voce[], dentroUnAggancio = false): string[] {
  const note = colonneDellaTabella(tabella);
  if (!note) return [`${tabella} (tabella che i tipi non conoscono)`];
  const fuori: string[] = [];
  for (const v of voci) {
    if ('colonna' in v) {
      // `count` dentro un aggancio è il conteggio di PostgREST (`items:order_items ( count )`).
      if (dentroUnAggancio && v.colonna === 'count') continue;
      if (v.colonna !== '*' && !note.includes(v.colonna)) fuori.push(`${tabella}.${v.colonna}`);
    } else {
      // Aggancio per colonna: `seller:seller_id ( … )` va alla tabella a cui punta la colonna.
      let figlia = v.tabella;
      if (note.includes(v.tabella)) {
        const perColonna = [...LEGAMI.values()].find((l) => l.tabella === tabella && l.colonna === v.tabella);
        if (!perColonna) {
          fuori.push(`${tabella}.${v.tabella} (colonna senza chiave esterna nelle migrazioni)`);
          continue;
        }
        figlia = perColonna.verso;
      }
      // Il suggerimento `!nome_fkey` deve esistere e legare proprio queste due tabelle.
      if (v.suggerimento && !/^(inner|left)$/.test(v.suggerimento)) {
        const l = legame(v.suggerimento);
        const lega = l && ((l.tabella === tabella && l.verso === figlia) || (l.tabella === figlia && l.verso === tabella));
        if (!lega) {
          fuori.push(`${tabella}→${figlia}!${v.suggerimento} (chiave esterna che non esiste fra le due tabelle)`);
          continue;
        }
      }
      fuori.push(...mancanti(figlia, v.voci, true));
    }
  }
  return fuori;
}

/** Le colonne chieste da una select che sulla tabella (o sui suoi agganci) non esistono. */
export function colonneMancanti(tabella: string, select: string): string[] {
  return mancanti(tabella, leggiSelect(select));
}

export function databaseCheConosceLeColonne(dati: Record<string, Riga[]>, opzioni: { cade?: boolean } = {}) {
  const errori: Guasto[] = [];
  const domande: Array<{ tabella: string; colonne: string }> = [];

  const from = (tabella: string) => {
    let colonne = '*';
    const filtri: Array<[string, unknown]> = [];
    const esito = (): { data: Riga[] | null; error: Guasto | null } => {
      domande.push({ tabella, colonne });
      if (opzioni.cade) {
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      }
      const note = colonneDellaTabella(tabella) ?? [];
      const fuori = [
        ...colonneMancanti(tabella, colonne),
        ...colonneDeiFiltri.filter((c) => !note.includes(c)).map((c) => `${tabella}.${c} (in un filtro)`),
      ];
      if (fuori.length > 0) {
        const e = { code: '42703', message: `column ${fuori[0]} does not exist` };
        errori.push(e);
        return { data: null, error: e };
      }
      return { data: [...(dati[tabella] ?? [])], error: null };
    };
    const b: Record<string, unknown> = {};
    const passa = () => b;
    // 5/11/2026 (S04, scheda 1795) — Anche i filtri e l'ordinamento nominano colonne: una colonna
    // sbagliata in `.eq()`, `.not()` o `.order()` fa rispondere 42703 al database vero, e qui
    // passava. Si controllano le colonne della tabella principale (un `a.b` punta a un aggancio).
    const colonneDeiFiltri: string[] = [];
    const filtra = (c: unknown) => {
      if (typeof c === 'string' && !c.includes('.')) colonneDeiFiltri.push(c.split('->')[0].trim());
      return b;
    };
    for (const m of ['limit', 'range', 'or', 'filter', 'match']) b[m] = passa;
    for (const m of ['order', 'in', 'neq', 'not', 'is', 'gte', 'lte', 'gt', 'lt', 'ilike', 'like']) b[m] = filtra;
    b.select = (c?: string) => {
      colonne = c ?? '*';
      return b;
    };
    b.eq = (c: string, v: unknown) => {
      filtri.push([c, v]);
      return filtra(c);
    };
    const una = () => {
      const r = esito();
      if (r.error) return { data: null, error: r.error };
      return { data: (r.data ?? []).find((riga) => filtri.every(([c, v]) => riga[c] === v)) ?? null, error: null };
    };
    b.single = async () => {
      const r = una();
      if (r.error || r.data) return r;
      return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    };
    b.maybeSingle = async () => una();
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esito()).then(ok, ko);
    return b;
  };

  return { from, errori, domande };
}
