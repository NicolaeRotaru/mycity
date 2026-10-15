/**
 * Un finto database per le prove dei rimborsi, che si comporta come quello vero nelle cose che
 * contano per i soldi:
 *
 *  ① le funzioni del database fanno quello che fanno le migrazioni: `accumula_rimborso` somma
 *    con il tetto del lordo dentro (124), `storna_rimborso` toglie (125), `wallet_credit` non
 *    accredita due volte la stessa chiave (098: risponde 23505; con `comeLa143` risponde senza
 *    errore e col saldo, come dopo la 143) e scrive la riga a diario in `wallet_ledger`;
 *  ② i filtri delle scritture si applicano DAVVERO (`eq`, `in`, `is`, `like`): una scrittura che
 *    non trova righe non scrive niente, e chi la fa lo vede da `select('id')`;
 *  ③ i guasti si accendono a comando: l'accredito che cade, l'accredito che riesce ma perde la
 *    risposta, lo storno al negozio che cade, una colonna che il database non ha ancora (una
 *    migrazione non applicata: 42703 in lettura, PGRST204 in scrittura, come PostgREST).
 *
 * Chi legge riceve una COPIA della riga: come il database vero, le scritture fatte dopo non
 * cambiano quello che il codice aveva gia' letto.
 */

export type Riga = Record<string, unknown>;

export interface Guasti {
  /** `wallet_credit` risponde con questo errore e non accredita. */
  walletCredit?: { code?: string; message: string } | null;
  /** `wallet_credit` accredita davvero, ma la risposta si perde: arriva un errore di rete. */
  walletCreditaPoiCade?: boolean;
  /**
   * Le prossime N letture del diario del credito (`wallet_ledger`) cadono con un timeout. Serve
   * al guasto doppio: l'accredito perde la risposta E il diario non si legge.
   */
  diarioIlleggibile?: number;
  /** `storna_rimborso` risponde con questo errore. */
  stornaRimborso?: { code?: string; message: string } | null;
  /** Colonne che il database non ha (una migrazione non ancora applicata). */
  colonneMancanti?: string[];
  /** Tabelle che il database non ha: ogni lettura o scrittura risponde PGRST205, come PostgREST. */
  tabelleMancanti?: string[];
}

export interface FintoDatabase {
  tabelle: Record<string, Riga[]>;
  /** Ogni RPC chiamata, in ordine. */
  rpc: Array<{ nome: string; args: Record<string, unknown> }>;
  /** Ogni scrittura riuscita, in ordine. */
  scritture: Array<{ tabella: string; tipo: 'update' | 'insert'; valori: Riga }>;
  /** Il diario del credito: una riga per accredito vero. */
  diarioCredito: Array<{ user: string; cents: number; reason: string; ref: string }>;
  guasti: Guasti;
  /** Comportamento di `wallet_credit` dopo la migrazione 143: doppione = nessun errore. */
  comeLa143: boolean;
  client: {
    from: (tabella: string) => FintaQuery;
    rpc: (nome: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email: string } | null } }> } };
  };
}

type Filtro = (r: Riga) => boolean;

function colonneDi(select: string): string[] {
  return select
    .split(',')
    .map((c) => c.trim().split(':').pop()!.split('(')[0].trim())
    .filter(Boolean);
}

class FintaQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private modo: 'select' | 'update' | 'insert' = 'select';
  private colonne = '*';
  private restituisce: string | null = null;
  private valori: Riga | Riga[] = {};
  private filtri: Filtro[] = [];
  private tetto: number | null = null;
  private unaSola: 'single' | 'maybe' | null = null;

  constructor(private readonly tabella: string, private readonly db: FintoDatabase) {}

  select(colonne = '*') {
    if (this.modo === 'select') this.colonne = colonne;
    else this.restituisce = colonne;
    return this;
  }
  update(valori: Riga) {
    this.modo = 'update';
    this.valori = valori;
    return this;
  }
  insert(valori: Riga | Riga[]) {
    this.modo = 'insert';
    this.valori = valori;
    return this;
  }
  eq(colonna: string, valore: unknown) {
    this.filtri.push((r) => r[colonna] === valore);
    return this;
  }
  neq(colonna: string, valore: unknown) {
    this.filtri.push((r) => r[colonna] !== valore);
    return this;
  }
  in(colonna: string, valori: readonly unknown[]) {
    this.filtri.push((r) => valori.includes(r[colonna]));
    return this;
  }
  gt(colonna: string, valore: number) {
    this.filtri.push((r) => typeof r[colonna] === 'number' && (r[colonna] as number) > valore);
    return this;
  }
  is(colonna: string, valore: unknown) {
    this.filtri.push((r) => (r[colonna] ?? null) === valore);
    return this;
  }
  like(colonna: string, schema: string) {
    const re = new RegExp(`^${schema.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`);
    this.filtri.push((r) => typeof r[colonna] === 'string' && re.test(r[colonna] as string));
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.tetto = n;
    return this;
  }
  single() {
    this.unaSola = 'single';
    return this;
  }
  maybeSingle() {
    this.unaSola = 'maybe';
    return this;
  }

  private mancante(nomi: string[]): string | undefined {
    const mancanti = this.db.guasti.colonneMancanti ?? [];
    return nomi.find((n) => mancanti.includes(n));
  }

  private esegui(): { data: unknown; error: unknown } {
    if ((this.db.guasti.tabelleMancanti ?? []).includes(this.tabella)) {
      return {
        data: null,
        error: { code: 'PGRST205', message: `Could not find the table 'public.${this.tabella}' in the schema cache` },
      };
    }
    const righe = (this.db.tabelle[this.tabella] ??= []);
    if (this.modo === 'select' && this.tabella === 'wallet_ledger' && (this.db.guasti.diarioIlleggibile ?? 0) > 0) {
      this.db.guasti.diarioIlleggibile = (this.db.guasti.diarioIlleggibile ?? 0) - 1;
      return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    }
    if (this.modo === 'select') {
      const chiesta = this.mancante(this.colonne === '*' ? [] : colonneDi(this.colonne));
      if (chiesta) return { data: null, error: { code: '42703', message: `column ${this.tabella}.${chiesta} does not exist` } };
      // Come PostgREST: tornano SOLO le colonne chieste. Una colonna che il codice non chiede, il
      // codice non la vede — ed e' cosi' che una lettura dimenticata diventa un rosso qui.
      const chieste = this.colonne === '*' ? null : colonneDi(this.colonne);
      const proietta = (r: Riga): Riga => (chieste ? Object.fromEntries(chieste.map((c) => [c, r[c]])) : { ...r });
      let trovate = righe.filter((r) => this.filtri.every((f) => f(r))).map(proietta);
      if (this.tetto != null) trovate = trovate.slice(0, this.tetto);
      if (this.unaSola === 'single') {
        return trovate.length === 1
          ? { data: trovate[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      if (this.unaSola === 'maybe') return { data: trovate[0] ?? null, error: null };
      return { data: trovate, error: null };
    }

    const nuove = Array.isArray(this.valori) ? this.valori : [this.valori];
    const chiesta = this.mancante(nuove.flatMap((v) => Object.keys(v)));
    if (chiesta) {
      return { data: null, error: { code: 'PGRST204', message: `Could not find the '${chiesta}' column of '${this.tabella}' in the schema cache` } };
    }

    let toccate: Riga[];
    if (this.modo === 'update') {
      toccate = righe.filter((r) => this.filtri.every((f) => f(r)));
      for (const r of toccate) Object.assign(r, this.valori);
      if (toccate.length > 0) this.db.scritture.push({ tabella: this.tabella, tipo: 'update', valori: { ...(this.valori as Riga) } });
    } else {
      toccate = nuove.map((v) => ({ id: v.id ?? `${this.tabella}-${righe.length + 1}`, ...v }));
      righe.push(...toccate);
      for (const v of toccate) this.db.scritture.push({ tabella: this.tabella, tipo: 'insert', valori: { ...v } });
    }
    if (this.restituisce == null) return { data: null, error: null };
    const restituite = this.restituisce === '*' ? null : colonneDi(this.restituisce);
    const copie = toccate.map((r) => (restituite ? Object.fromEntries(restituite.map((c) => [c, r[c]])) : { ...r }));
    if (this.unaSola === 'single') return { data: copie[0] ?? null, error: null };
    return { data: copie, error: null };
  }

  then<A = { data: unknown; error: unknown }, B = never>(
    ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.esegui()).then(ok, ko);
  }
}

export function creaFintoDatabase(tabelle: Record<string, Riga[]>, guasti: Guasti = {}): FintoDatabase {
  const db: FintoDatabase = {
    tabelle: Object.fromEntries(Object.entries(tabelle).map(([t, rr]) => [t, rr.map((r) => ({ ...r }))])),
    rpc: [],
    scritture: [],
    diarioCredito: [],
    guasti,
    comeLa143: false,
    client: undefined as unknown as FintoDatabase['client'],
  };

  const ordine = (id: unknown) => (db.tabelle.orders ?? []).find((o) => o.id === id);

  db.client = {
    from: (tabella: string) => new FintaQuery(tabella, db),
    rpc: async (nome: string, args: Record<string, unknown> = {}) => {
      db.rpc.push({ nome, args });
      if (nome === 'accumula_rimborso') {
        const o = ordine(args.p_order_id);
        if (!o) return { data: null, error: { code: 'P0002', message: 'accumula_rimborso: ordine inesistente' } };
        const tetto = (o.gross_total_cents as number | null) ?? Math.round(Number(o.total_price ?? 0) * 100);
        const nuovo = Number(o.refunded_amount_cents ?? 0) + Number(args.p_delta);
        if (nuovo > tetto) return { data: [], error: null };
        o.refunded_amount_cents = nuovo;
        return { data: [{ totale_rimborsato: nuovo, totale_ordine: tetto }], error: null };
      }
      if (nome === 'storna_rimborso') {
        if (db.guasti.stornaRimborso) return { data: null, error: db.guasti.stornaRimborso };
        const o = ordine(args.p_order_id);
        if (!o) return { data: null, error: { code: 'P0002', message: 'storna_rimborso: ordine inesistente' } };
        o.refunded_amount_cents = Math.max(0, Number(o.refunded_amount_cents ?? 0) - Number(args.p_delta));
        return { data: o.refunded_amount_cents, error: null };
      }
      if (nome === 'wallet_credit') {
        if (db.guasti.walletCredit) return { data: null, error: db.guasti.walletCredit };
        const reason = String(args.p_reason);
        const ref = String(args.p_ref);
        const saldo = () => creditoDi(db, String(args.p_user));
        if (db.diarioCredito.some((m) => m.reason === reason && m.ref === ref)) {
          return db.comeLa143
            ? { data: saldo(), error: null }
            : { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        db.diarioCredito.push({ user: String(args.p_user), cents: Number(args.p_cents), reason, ref });
        (db.tabelle.wallet_ledger ??= []).push({
          id: `wl-${db.diarioCredito.length}`, user_id: String(args.p_user), delta_cents: Number(args.p_cents), reason, ref,
        });
        if (db.guasti.walletCreditaPoiCade) {
          db.guasti.walletCreditaPoiCade = false;
          return { data: null, error: { message: 'FetchError: socket hang up' } };
        }
        return { data: saldo(), error: null };
      }
      return { data: null, error: null };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'cliente@test.it' } } }) } },
  };
  return db;
}

/** Il credito accreditato a un cliente, sommando il diario. */
export function creditoDi(db: FintoDatabase, utente: string): number {
  return db.diarioCredito.filter((m) => m.user === utente).reduce((s, m) => s + m.cents, 0);
}

/** Le notifiche scritte, per titolo. */
export function notificheConTitolo(db: FintoDatabase, titolo: string): Riga[] {
  return (db.tabelle.notifications ?? []).filter((n) => String(n.title).includes(titolo));
}
