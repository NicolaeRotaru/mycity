/**
 * Un finto PostgREST che si comporta come quello vero nelle due cose che qui contano:
 *
 *  ① i filtri li applica DAVVERO sulle righe (eq, in, ilike, lte, gte, or su stock), così una prova
 *    può chiedere «cerca una parola che sta solo nella descrizione» e ricevere la risposta vera —
 *    zero risultati — invece di una risposta di comodo;
 *  ② l'elenco di `.in()` finisce nell'INDIRIZZO, non nel corpo. È il difetto #93 di questa casa:
 *    circa 37 caratteri per identificativo contro un limite pratico intorno agli ottomila. Sopra
 *    quel limite il server vero risponde 414 e la libreria lo consegna come errore.
 *
 * Serve perché in questa repo i componenti React non si possono montare in una prova (`jsx:
 * preserve` nel tsconfig e nessun plugin react nella configurazione di vitest, che è di un altro
 * lotto): la lettura vera vive quindi in un modulo, e la prova esegue quel modulo.
 */

export const LIMITE_INDIRIZZO = 8000;

export type Riga = Record<string, unknown>;
export type Tabelle = Record<string, Riga[]>;

type Filtro =
  | { tipo: 'eq' | 'lte' | 'gte'; colonna: string; valore: unknown }
  | { tipo: 'ilike'; colonna: string; valore: string }
  | { tipo: 'in'; colonna: string; valori: readonly unknown[] }
  | { tipo: 'or'; espressione: string }
  | { tipo: 'is'; colonna: string; valore: unknown };

export interface Chiamata {
  tabella: string;
  colonne: string;
  /** Lunghezza dell'indirizzo simulato: è quella che fa 414 sul server vero. */
  lunghezzaIndirizzo: number;
  /** Il conteggio esatto chiesto a PostgREST: obbliga il database a contare TUTTE le righe. */
  conteggioEsatto: boolean;
  /** Il tetto di righe chiesto, se dichiarato. */
  tetto: number | null;
  /** Le colonne su cui è stato chiesto l'ordinamento: senza, l'ordine lo decide il database. */
  ordinamenti: string[];
}

export interface FintoDb {
  /** Ogni lettura fatta, in ordine: serve per contare i viaggi di rete. */
  chiamate: Chiamata[];
  /** Ogni RPC chiamata, in ordine. */
  rpc: Array<{ nome: string; argomenti: Record<string, unknown> }>;
  client: {
    from: (tabella: string) => FintaQuery;
    rpc: (nome: string, argomenti?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
}

function confronta(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

class FintaQuery {
  private filtri: Filtro[] = [];
  private ordinamenti: Array<{ colonna: string; crescente: boolean }> = [];
  private tetto: number | null = null;
  private colonne = '*';
  private conteggio: string | null = null;

  constructor(
    private readonly tabella: string,
    private readonly db: Tabelle,
    private readonly chiamate: Chiamata[],
  ) {}

  select(colonne = '*', opzioni?: { count?: string; head?: boolean }) {
    this.colonne = colonne;
    this.conteggio = opzioni?.count ?? null;
    return this;
  }
  eq(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'eq', colonna, valore }); return this; }
  lte(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'lte', colonna, valore }); return this; }
  gte(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'gte', colonna, valore }); return this; }
  ilike(colonna: string, valore: string) { this.filtri.push({ tipo: 'ilike', colonna, valore }); return this; }
  is(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'is', colonna, valore }); return this; }
  in(colonna: string, valori: readonly unknown[]) { this.filtri.push({ tipo: 'in', colonna, valori }); return this; }
  or(espressione: string) { this.filtri.push({ tipo: 'or', espressione }); return this; }
  order(colonna: string, opzioni?: { ascending?: boolean }) {
    this.ordinamenti.push({ colonna, crescente: opzioni?.ascending !== false });
    return this;
  }
  limit(n: number) { this.tetto = n; return this; }

  /** L'indirizzo che PostgREST comporrebbe: è la sua lunghezza a decidere il 414. */
  private indirizzo(): string {
    const parti = this.filtri.map((f) => {
      if (f.tipo === 'in') return `${f.colonna}=in.(${f.valori.map(String).join(',')})`;
      if (f.tipo === 'or') return `or=(${f.espressione})`;
      return `${f.colonna}=${f.tipo}.${String((f as { valore: unknown }).valore)}`;
    });
    return `/rest/v1/${this.tabella}?select=${encodeURIComponent(this.colonne)}&${parti.join('&')}`;
  }

  private applica(): Riga[] {
    let righe = [...(this.db[this.tabella] ?? [])];
    for (const f of this.filtri) {
      if (f.tipo === 'eq') righe = righe.filter((r) => r[f.colonna] === f.valore);
      else if (f.tipo === 'is') righe = righe.filter((r) => (r[f.colonna] ?? null) === (f.valore ?? null));
      // I confronti di PostgREST valgono sia sui numeri sia sulle date: qui si sceglie il metro
      // giusto, altrimenti una data diventa NaN e il filtro butta via tutto in silenzio.
      else if (f.tipo === 'lte') righe = righe.filter((r) => confronta(r[f.colonna], f.valore) <= 0);
      else if (f.tipo === 'gte') righe = righe.filter((r) => confronta(r[f.colonna], f.valore) >= 0);
      else if (f.tipo === 'in') righe = righe.filter((r) => f.valori.includes(r[f.colonna]));
      else if (f.tipo === 'ilike') {
        const re = new RegExp(`^${f.valore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
        righe = righe.filter((r) => re.test(String(r[f.colonna] ?? '')));
      } else if (f.tipo === 'or') {
        // Una sola forma, la nostra: «stock.is.null,stock.gt.0».
        righe = righe.filter((r) => r.stock == null || Number(r.stock) > 0);
      }
    }
    for (const o of [...this.ordinamenti].reverse()) {
      righe.sort((a, b) => {
        const va = a[o.colonna] as string | number;
        const vb = b[o.colonna] as string | number;
        const cmp = va === vb ? 0 : va < vb ? -1 : 1;
        return o.crescente ? cmp : -cmp;
      });
    }
    return this.tetto == null ? righe : righe.slice(0, this.tetto);
  }

  then<T>(risolvi: (v: { data: Riga[] | null; error: { message: string; code?: string } | null; count?: number }) => T) {
    const indirizzo = this.indirizzo();
    this.chiamate.push({
      tabella: this.tabella,
      colonne: this.colonne,
      lunghezzaIndirizzo: indirizzo.length,
      conteggioEsatto: this.conteggio === 'exact',
      tetto: this.tetto,
      ordinamenti: this.ordinamenti.map((o) => o.colonna),
    });
    if (indirizzo.length > LIMITE_INDIRIZZO) {
      // È il modo peggiore di rompersi: il server risponde 414 e chi legge crede sia «vuoto».
      return Promise.resolve(risolvi({ data: null, error: { message: 'Request-URI Too Large', code: '414' } }));
    }
    const righe = this.applica();
    return Promise.resolve(risolvi({ data: righe, error: null, count: this.conteggio ? righe.length : undefined } as never));
  }
}

/** Costruisce il finto database. `rpcs` risponde alle chiamate a funzione. */
export function fintoDb(
  tabelle: Tabelle,
  rpcs: Record<string, (argomenti: Record<string, unknown>) => { data: unknown; error: unknown }> = {},
): FintoDb {
  const chiamate: Chiamata[] = [];
  const rpc: Array<{ nome: string; argomenti: Record<string, unknown> }> = [];
  return {
    chiamate,
    rpc,
    client: {
      from: (tabella: string) => new FintaQuery(tabella, tabelle, chiamate),
      rpc: async (nome: string, argomenti: Record<string, unknown> = {}) => {
        rpc.push({ nome, argomenti });
        const f = rpcs[nome];
        if (!f) return { data: null, error: { message: `funzione ${nome} inesistente` } };
        return f(argomenti);
      },
    },
  };
}
