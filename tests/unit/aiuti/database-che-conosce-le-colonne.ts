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
import { readFileSync } from 'node:fs';
import path from 'node:path';

const TIPI = readFileSync(path.resolve(__dirname, '../../../lib/database.types.ts'), 'utf8');

export type Guasto = { code: string; message: string };
type Riga = Record<string, unknown>;
type Voce = { colonna: string } | { tabella: string; voci: Voce[] };

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
      return { colonna: nome.trim() };
    }
    const testa = pezzo.slice(0, aperta).trim();
    const dentro = pezzo.slice(aperta + 1, pezzo.lastIndexOf(')'));
    const tabella = (testa.includes(':') ? testa.split(':').pop() ?? '' : testa).split('!')[0].trim();
    return { tabella, voci: leggiSelect(dentro) };
  });
}

function mancanti(tabella: string, voci: Voce[]): string[] {
  const note = colonneDellaTabella(tabella);
  if (!note) return [`${tabella} (tabella che i tipi non conoscono)`];
  const fuori: string[] = [];
  for (const v of voci) {
    if ('colonna' in v) {
      if (v.colonna !== '*' && !note.includes(v.colonna)) fuori.push(`${tabella}.${v.colonna}`);
    } else {
      fuori.push(...mancanti(v.tabella, v.voci));
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
      const fuori = colonneMancanti(tabella, colonne);
      if (fuori.length > 0) {
        const e = { code: '42703', message: `column ${fuori[0]} does not exist` };
        errori.push(e);
        return { data: null, error: e };
      }
      return { data: [...(dati[tabella] ?? [])], error: null };
    };
    const b: Record<string, unknown> = {};
    const passa = () => b;
    for (const m of ['order', 'limit', 'range', 'in', 'neq', 'not', 'is', 'gte', 'lte', 'gt', 'lt', 'or', 'ilike', 'filter', 'match']) b[m] = passa;
    b.select = (c?: string) => {
      colonne = c ?? '*';
      return b;
    };
    b.eq = (c: string, v: unknown) => {
      filtri.push([c, v]);
      return b;
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
