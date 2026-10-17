/**
 * Un finto database per i gestori degli avvisi di Stripe: legge E scrive, e
 * applica davvero i filtri (eq, in, is, lt, or) sulle righe.
 *
 * 15/10/2026 (collaudo, giro 2) — SI COMPORTA COME POSTGREST, NON COME CI SI
 * ASPETTA CHE SI COMPORTI. La prima versione restituiva la riga intera a
 * qualunque `select` e applicava l'«oppure» solo prima di scrivere. Il
 * traduttore vero (PostgREST, misurato sulle versioni 12.2.3, 12.2.8, 13.0.5 e
 * 14.0) fa altre tre cose, e qui adesso le fa anche il finto:
 *
 *   ① restituisce SOLO le colonne chieste: un gestore che usa un campo che non
 *     ha chiesto lo trova vuoto (così si è visto che la contestazione vinta non
 *     leggeva il promemoria dello storno);
 *   ② su una scrittura con `select`, applica l'«oppure» anche alle righe che
 *     restituisce: se nomina una colonna che non è fra quelle chieste risponde
 *     42703 e non scrive niente; se la colonna c'è, scarta le righe che dopo la
 *     scrittura non lo soddisfano più (ma la scrittura resta fatta);
 *   ③ con `colonneMancanti` imita un database a cui manca una migrazione: una
 *     lettura o un filtro su quella colonna risponde 42703, una scrittura che
 *     la porta risponde PGRST204 (lo dice il traduttore, prima del database).
 *
 * Il contratto è provato in `il-finto-database-si-comporta-come-postgrest.test.ts`,
 * che con `POSTGREST_VERO_URL` gira le stesse domande anche contro PostgREST.
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
  /** Colonne che il database NON ha ancora (migrazione non applicata), per tabella. */
  colonneMancanti: Record<string, string[]>;
  /** Risposta delle RPC: di base `{ data: null, error: null }`. */
  rispostaRpc: (nome: string, argomenti: Record<string, unknown>) => { data: unknown; error: ErroreDb | null };
  client: {
    from: (tabella: string) => FintaQuery;
    rpc: (nome: string, argomenti?: Record<string, unknown>) => Promise<{ data: unknown; error: ErroreDb | null }>;
  };
}

/** Una condizione di `.or()` nella forma PostgREST: «col.is.null», «col.eq.X», «col.lt.X». */
function condizioneOr(parte: string): { colonna: string; f: Filtro } {
  const [colonna, op, ...resto] = parte.split('.');
  const valore = resto.join('.');
  if (op === 'is' && valore === 'null') return { colonna, f: (r) => (r[colonna] ?? null) === null };
  if (op === 'eq') return { colonna, f: (r) => String(r[colonna]) === valore };
  if (op === 'neq') return { colonna, f: (r) => r[colonna] != null && String(r[colonna]) !== valore };
  if (op === 'lt') return { colonna, f: (r) => r[colonna] != null && String(r[colonna]) < valore };
  if (op === 'in') {
    const lista = valore.replace(/^\(|\)$/g, '').split(',');
    return { colonna, f: (r) => r[colonna] != null && lista.includes(String(r[colonna])) };
  }
  throw new Error(`finto database: condizione .or() non capita: ${parte}`);
}

/** Divide «a, b, c(d, e)» al primo livello, rispettando le parentesi. */
function partiDellaSelect(colonne: string): string[] {
  const parti: string[] = [];
  let profondita = 0;
  let corrente = '';
  for (const ch of colonne) {
    if (ch === '(') profondita++;
    if (ch === ')') profondita--;
    if (ch === ',' && profondita === 0) {
      parti.push(corrente.trim());
      corrente = '';
    } else {
      corrente += ch;
    }
  }
  if (corrente.trim()) parti.push(corrente.trim());
  return parti.filter(Boolean);
}

/** Una voce della select: il nome con cui esce e la colonna da cui viene. */
type Voce = { comeEsce: string; colonna: string; tutte?: boolean };

function vociDellaSelect(colonne: string): Voce[] {
  return partiDellaSelect(colonne).map((parte): Voce => {
    if (parte === '*') return { comeEsce: '*', colonna: '*', tutte: true };
    // «alias:colonna», «colonna::tipo», «risorsa!indizio(…)»: conta il nome.
    const duePunti = parte.includes('::') ? -1 : parte.indexOf(':');
    const alias = duePunti > 0 ? parte.slice(0, duePunti).trim() : null;
    const resto = duePunti > 0 ? parte.slice(duePunti + 1) : parte;
    const nome = resto.split('(')[0].split('!')[0].split('::')[0].trim();
    return { comeEsce: alias ?? nome, colonna: nome };
  });
}

class FintaQuery {
  private operazione: 'select' | Scrittura['operazione'] = 'select';
  private valori: Riga | Riga[] | null = null;
  /** Filtri semplici: PostgREST li applica solo alla scrittura (o alla lettura). */
  private filtri: Array<{ colonna: string; f: Filtro }> = [];
  /** Filtri «oppure»: su una scrittura con `select`, PostgREST li riapplica alle righe restituite. */
  private logici: Array<{ colonne: string[]; f: Filtro }> = [];
  private colonne = '*';
  private restituisce = false;
  private una: 'single' | 'maybe' | null = null;

  constructor(private readonly db: FintoDatabase, private readonly tabella: string) {}

  select(colonne?: string) {
    this.colonne = colonne ?? '*';
    if (this.operazione === 'select') return this;
    this.restituisce = true;
    return this;
  }
  insert(valori: Riga | Riga[]) { this.operazione = 'insert'; this.valori = valori; return this; }
  update(valori: Riga) { this.operazione = 'update'; this.valori = valori; return this; }
  delete() { this.operazione = 'delete'; return this; }
  eq(colonna: string, valore: unknown) { this.filtri.push({ colonna, f: (r) => r[colonna] === valore }); return this; }
  neq(colonna: string, valore: unknown) { this.filtri.push({ colonna, f: (r) => r[colonna] != null && r[colonna] !== valore }); return this; }
  is(colonna: string, valore: unknown) { this.filtri.push({ colonna, f: (r) => (r[colonna] ?? null) === valore }); return this; }
  in(colonna: string, valori: readonly unknown[]) { this.filtri.push({ colonna, f: (r) => valori.includes(r[colonna]) }); return this; }
  lt(colonna: string, valore: unknown) {
    this.filtri.push({ colonna, f: (r) => r[colonna] != null && String(r[colonna]) < String(valore) });
    return this;
  }
  or(espressione: string) {
    const parti = espressione.split(/,(?![^(]*\))/).map(condizioneOr);
    this.logici.push({ colonne: parti.map((p) => p.colonna), f: (r) => parti.some((p) => p.f(r)) });
    return this;
  }
  limit(_n: number) { return this; }
  single() { this.una = 'single'; return this; }
  maybeSingle() { this.una = 'maybe'; return this; }

  private mancanti(): Set<string> {
    return new Set(this.db.colonneMancanti[this.tabella] ?? []);
  }

  /** Le righe come le restituisce PostgREST: solo le colonne chieste. */
  private proietta(r: Riga): Riga {
    const fuori: Riga = {};
    const mancanti = this.mancanti();
    for (const voce of vociDellaSelect(this.colonne)) {
      if (voce.tutte) {
        for (const [k, v] of Object.entries(r)) if (!mancanti.has(k)) fuori[k] = v;
      } else {
        fuori[voce.comeEsce] = r[voce.colonna] ?? null;
      }
    }
    return fuori;
  }

  /** 42703 come il database: una colonna chiesta, o filtrata, che non esiste. */
  private colonnaInesistente(): ErroreDb | null {
    const mancanti = this.mancanti();
    const nominate = [
      ...vociDellaSelect(this.colonne).filter((v) => !v.tutte).map((v) => v.colonna),
      ...this.filtri.map((f) => f.colonna),
      ...this.logici.flatMap((l) => l.colonne),
    ];
    const assente = nominate.find((c) => mancanti.has(c));
    return assente ? { code: '42703', message: `column ${this.tabella}.${assente} does not exist` } : null;
  }

  private esegui(): { data: unknown; error: ErroreDb | null } {
    const righe = (this.db.tabelle[this.tabella] ??= []);
    const scelte = () =>
      righe.filter((r) => this.filtri.every((x) => x.f(r)) && this.logici.every((x) => x.f(r)));

    if (this.operazione === 'select') {
      const guasto = this.db.guastoLettura(this.tabella);
      if (guasto) return { data: null, error: guasto };
      const inesistente = this.colonnaInesistente();
      if (inesistente) return { data: null, error: inesistente };
      const trovate = scelte().map((r) => this.proietta(r));
      if (this.una === 'single') {
        return trovate.length === 1
          ? { data: trovate[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      if (this.una === 'maybe') return { data: trovate[0] ?? null, error: null };
      return { data: trovate, error: null };
    }

    // Il traduttore confronta i campi della scrittura con lo schema che conosce:
    // un campo che non c'è lo rifiuta lui, prima ancora del database.
    const mancanti = this.mancanti();
    const campi = (Array.isArray(this.valori) ? this.valori : [this.valori ?? {}]).flatMap((v) => Object.keys(v));
    const campoAssente = campi.find((c) => mancanti.has(c));
    if (campoAssente) {
      return {
        data: null,
        error: { code: 'PGRST204', message: `Could not find the '${campoAssente}' column of '${this.tabella}' in the schema cache` },
      };
    }
    const inesistente = this.colonnaInesistente();
    if (inesistente) return { data: null, error: inesistente };

    // ② L'«oppure» rientra nella lettura delle righe restituite: se nomina una
    // colonna che la select non porta, l'istruzione intera fallisce.
    if (this.restituisce && this.logici.length > 0) {
      const portate = new Set(vociDellaSelect(this.colonne).map((v) => v.colonna));
      const fuori = portate.has('*') ? undefined : this.logici.flatMap((l) => l.colonne).find((c) => !portate.has(c));
      if (fuori) return { data: null, error: { code: '42703', message: `column ${this.tabella}.${fuori} does not exist` } };
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
      // La chiave primaria: chi porta un id suo che c'è già riceve 23505, come
      // dal database vero (gli avvisi «una volta sola» contano su questo).
      // Gli id inventati qui sopra non si guardano: sono del finto, non di chi scrive.
      const idPortati = (Array.isArray(this.valori) ? this.valori : [this.valori ?? {}])
        .map((v) => v.id)
        .filter((id) => id !== undefined && id !== null);
      if (idPortati.some((id, i) => idPortati.indexOf(id) !== i || righe.some((r) => r.id === id))) {
        return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.tabella}_pkey"` } };
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
    // ② …e scarta le righe che, DOPO la scrittura, non lo soddisfano più.
    const restituite = toccate.filter((r) => this.logici.every((x) => x.f(r))).map((r) => this.proietta(r));
    return { data: this.una ? (restituite[0] ?? null) : restituite, error: null };
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
    colonneMancanti: {},
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
