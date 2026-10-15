/**
 * Un finto database per i gestori degli avvisi di Stripe: legge E scrive, e
 * applica davvero i filtri (eq, in, is, or) sulle righe.
 *
 * Serve una cosa che il finto PostgREST di sola lettura (`finto-postgrest.ts`)
 * non fa: far FALLIRE una scrittura precisa, come fa il database vero quando va
 * in timeout. La libreria di Supabase in quel caso non lancia: restituisce
 * `{ error }`. Qui succede lo stesso, e la prova guarda cosa ne fa il codice.
 *
 * Le righe si leggono e si scrivono per copia: una prova vede lo stato del
 * database, non oggetti condivisi col codice che sta provando.
 */

export type Riga = Record<string, unknown>;
export type ErroreDb = { message: string; code?: string };

/** Descrive una scrittura, per decidere se farla fallire. */
export type Scrittura = {
  tabella: string;
  operazione: 'insert' | 'update' | 'delete';
  valori: Riga | Riga[] | null;
};

type Filtro = (r: Riga) => boolean;

export interface FintoDatabase {
  tabelle: Record<string, Riga[]>;
  /** Ogni scrittura RIUSCITA, in ordine. */
  scritture: Array<Scrittura & { righe: number }>;
  /** Ogni RPC chiamata, in ordine. */
  rpc: Array<{ nome: string; argomenti: Record<string, unknown> }>;
  /** Se restituisce un errore, la scrittura non avviene e la libreria risponde `{ error }`. */
  guasto: (s: Scrittura) => ErroreDb | null;
  /** Se restituisce un errore, la lettura risponde `{ data: null, error }`. */
  guastoLettura: (tabella: string) => ErroreDb | null;
  /** Valori di partenza delle colonne, per tabella (i DEFAULT del database). */
  predefiniti: Record<string, Riga>;
  /** Chiavi uniche, per tabella: un doppione risponde 23505 come Postgres. */
  unici: Record<string, string[][]>;
  /** Risposta delle RPC: di base `{ data: null, error: null }`. */
  rispostaRpc: (nome: string, argomenti: Record<string, unknown>) => { data: unknown; error: ErroreDb | null };
  client: {
    from: (tabella: string) => FintaQuery;
    rpc: (nome: string, argomenti?: Record<string, unknown>) => Promise<{ data: unknown; error: ErroreDb | null }>;
  };
}

/** Una condizione di `.or()` nella forma PostgREST: «col.is.null», «col.eq.X», «col.lt.X». */
function condizioneOr(parte: string): Filtro {
  const [colonna, op, ...resto] = parte.split('.');
  const valore = resto.join('.');
  if (op === 'is' && valore === 'null') return (r) => (r[colonna] ?? null) === null;
  if (op === 'eq') return (r) => String(r[colonna]) === valore;
  if (op === 'neq') return (r) => r[colonna] != null && String(r[colonna]) !== valore;
  if (op === 'lt') return (r) => r[colonna] != null && String(r[colonna]) < valore;
  throw new Error(`finto database: condizione .or() non capita: ${parte}`);
}

class FintaQuery {
  private operazione: 'select' | Scrittura['operazione'] = 'select';
  private valori: Riga | Riga[] | null = null;
  private filtri: Filtro[] = [];
  private restituisce = false;
  private una: 'single' | 'maybe' | null = null;

  constructor(private readonly db: FintoDatabase, private readonly tabella: string) {}

  select(_colonne?: string) {
    if (this.operazione === 'select') return this;
    this.restituisce = true;
    return this;
  }
  insert(valori: Riga | Riga[]) { this.operazione = 'insert'; this.valori = valori; return this; }
  update(valori: Riga) { this.operazione = 'update'; this.valori = valori; return this; }
  delete() { this.operazione = 'delete'; return this; }
  eq(colonna: string, valore: unknown) { this.filtri.push((r) => r[colonna] === valore); return this; }
  neq(colonna: string, valore: unknown) { this.filtri.push((r) => r[colonna] != null && r[colonna] !== valore); return this; }
  is(colonna: string, valore: unknown) { this.filtri.push((r) => (r[colonna] ?? null) === valore); return this; }
  in(colonna: string, valori: readonly unknown[]) { this.filtri.push((r) => valori.includes(r[colonna])); return this; }
  or(espressione: string) {
    const parti = espressione.split(',').map(condizioneOr);
    this.filtri.push((r) => parti.some((p) => p(r)));
    return this;
  }
  limit(_n: number) { return this; }
  single() { this.una = 'single'; return this; }
  maybeSingle() { this.una = 'maybe'; return this; }

  private esegui(): { data: unknown; error: ErroreDb | null } {
    const righe = (this.db.tabelle[this.tabella] ??= []);
    const scelte = () => righe.filter((r) => this.filtri.every((f) => f(r)));

    if (this.operazione === 'select') {
      const guasto = this.db.guastoLettura(this.tabella);
      if (guasto) return { data: null, error: guasto };
      const trovate = scelte().map((r) => ({ ...r }));
      if (this.una === 'single') {
        return trovate.length === 1
          ? { data: trovate[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      if (this.una === 'maybe') return { data: trovate[0] ?? null, error: null };
      return { data: trovate, error: null };
    }

    const scrittura: Scrittura = { tabella: this.tabella, operazione: this.operazione, valori: this.valori };
    const guasto = this.db.guasto(scrittura);
    if (guasto) return { data: null, error: guasto };

    let toccate: Riga[] = [];
    if (this.operazione === 'insert') {
      // Come `DEFAULT gen_random_uuid()`: chi non porta un id ne riceve uno.
      const nuove = (Array.isArray(this.valori) ? this.valori : [this.valori ?? {}]).map((v, i): Riga => ({
        id: `${this.tabella}_${righe.length + i + 1}`,
        ...(this.db.predefiniti[this.tabella] ?? {}),
        ...v,
      }));
      for (const chiave of this.db.unici[this.tabella] ?? []) {
        const doppione = nuove.some((n) => righe.some((r) => chiave.every((c) => r[c] === n[c])));
        if (doppione) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      righe.push(...nuove);
      toccate = nuove;
    } else if (this.operazione === 'update') {
      toccate = scelte();
      for (const r of toccate) Object.assign(r, this.valori);
    } else {
      toccate = scelte();
      this.db.tabelle[this.tabella] = righe.filter((r) => !toccate.includes(r));
    }
    this.db.scritture.push({ ...scrittura, righe: toccate.length });
    if (!this.restituisce) return { data: null, error: null };
    const copie = toccate.map((r) => ({ ...r }));
    return { data: this.una ? (copie[0] ?? null) : copie, error: null };
  }

  then<T, E = never>(
    risolvi?: ((v: { data: unknown; error: ErroreDb | null }) => T | PromiseLike<T>) | null,
    rifiuta?: ((e: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return Promise.resolve(this.esegui()).then(risolvi, rifiuta);
  }
}

export function fintoDatabase(tabelle: Record<string, Riga[]> = {}): FintoDatabase {
  const db: FintoDatabase = {
    tabelle,
    scritture: [],
    rpc: [],
    guasto: () => null,
    guastoLettura: () => null,
    predefiniti: {},
    unici: {},
    rispostaRpc: () => ({ data: null, error: null }),
    client: {
      from: (tabella: string) => new FintaQuery(db, tabella),
      rpc: async (nome: string, argomenti: Record<string, unknown> = {}) => {
        db.rpc.push({ nome, argomenti });
        return db.rispostaRpc(nome, argomenti);
      },
    },
  };
  return db;
}

/** Il guasto tipico: il database va in timeout su quella scrittura. */
export const TIMEOUT: ErroreDb = { code: '57014', message: 'canceling statement due to statement timeout' };
