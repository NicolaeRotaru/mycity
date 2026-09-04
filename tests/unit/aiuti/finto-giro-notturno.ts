/**
 * Un finto database per far girare DAVVERO il giro notturno delle cancellazioni
 * (`app/api/cron/process-deletions`).
 *
 * Non finge il risultato: tiene le righe in memoria e APPLICA i filtri, così una
 * prova può chiedere «dopo la notte, questo buono regalo ha ancora l'email del
 * destinatario?» e ricevere la risposta vera. È la differenza che conta: una
 * prova che guarda solo «è stata chiamata la funzione di pulizia» resta verde
 * anche quando quella pulizia sceglie le righe sbagliate.
 *
 * Tiene anche il diario di tutto quello che è successo, in ordine — comprese le
 * scritture del battito (`cron_heartbeats`), perché su questo progetto il
 * battito si scrive solo se la notte è andata bene, e «la notte fallita non
 * scrive il battito» è a sua volta un comportamento da dimostrare.
 */

export type Riga = Record<string, unknown>;
export type Tabelle = Record<string, Riga[]>;

export type Voce =
  | { op: 'update'; tabella: string; valori: Riga; toccate: number }
  | { op: 'delete'; tabella: string; toccate: number }
  | { op: 'insert'; tabella: string; righe: Riga[] }
  | { op: 'upsert'; tabella: string; righe: Riga[] }
  | { op: 'rpc'; nome: string }
  | { op: 'file-rimossi'; secchio: string; percorsi: string[] };

type Filtro =
  | { tipo: 'eq' | 'lt' | 'gt'; colonna: string; valore: unknown }
  | { tipo: 'non-nullo'; colonna: string }
  | { tipo: 'nullo'; colonna: string }
  | { tipo: 'or'; espressione: string };

function confronta(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

/** Una riga con la colonna a NULL non passa nessun confronto, come in SQL. */
function passa(riga: Riga, f: Filtro): boolean {
  if (f.tipo === 'or') {
    // La sola forma che usiamo: «metadata.not.is.null,summary.not.is.null».
    return f.espressione.split(',').some((pezzo) => {
      const negato = pezzo.includes('.not.is.null');
      const colonna = pezzo.split('.')[0];
      return negato ? riga[colonna] != null : riga[colonna] == null;
    });
  }
  if (f.tipo === 'non-nullo') return riga[f.colonna] != null;
  if (f.tipo === 'nullo') return riga[f.colonna] == null;
  const v = riga[f.colonna];
  if (v == null) return false;
  if (f.tipo === 'eq') return v === f.valore;
  if (f.tipo === 'lt') return confronta(v, f.valore) < 0;
  return confronta(v, f.valore) > 0;
}

class FintaQuery {
  private filtri: Filtro[] = [];
  private azione: 'select' | 'update' | 'delete' | 'insert' | 'upsert' = 'select';
  private valori: Riga = {};
  private daScrivere: Riga[] = [];
  private tetto: number | null = null;

  constructor(
    private readonly tabella: string,
    private readonly db: Tabelle,
    private readonly diario: Voce[],
    private readonly errori: Record<string, string>,
  ) {}

  select(_colonne?: string) { this.azione = 'select'; return this; }
  update(valori: Riga) { this.azione = 'update'; this.valori = valori; return this; }
  delete() { this.azione = 'delete'; return this; }
  insert(righe: Riga | Riga[]) {
    this.azione = 'insert';
    this.daScrivere = Array.isArray(righe) ? righe : [righe];
    return this;
  }
  upsert(righe: Riga | Riga[], _opzioni?: unknown) {
    this.azione = 'upsert';
    this.daScrivere = Array.isArray(righe) ? righe : [righe];
    return this;
  }
  eq(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'eq', colonna, valore }); return this; }
  lt(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'lt', colonna, valore }); return this; }
  gt(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'gt', colonna, valore }); return this; }
  is(colonna: string, valore: unknown) {
    this.filtri.push(valore === null ? { tipo: 'nullo', colonna } : { tipo: 'eq', colonna, valore });
    return this;
  }
  /** `.not('recipient_email', 'is', null)` — l'unica forma usata nel giro. */
  not(colonna: string, operatore: string, valore: unknown) {
    if (operatore === 'is' && valore === null) this.filtri.push({ tipo: 'non-nullo', colonna });
    else this.filtri.push({ tipo: 'or', espressione: `${colonna}.not.is.null` });
    return this;
  }
  or(espressione: string) { this.filtri.push({ tipo: 'or', espressione }); return this; }
  order(_colonna: string, _opzioni?: unknown) { return this; }
  limit(n: number) { this.tetto = n; return this; }
  ilike(colonna: string, _valore: string) { this.filtri.push({ tipo: 'non-nullo', colonna }); return this; }

  private righe(): Riga[] {
    const tutte = this.db[this.tabella] ?? [];
    const scelte = tutte.filter((r) => this.filtri.every((f) => passa(r, f)));
    return this.tetto == null ? scelte : scelte.slice(0, this.tetto);
  }

  then<T>(risolvi: (v: { data: Riga[] | null; error: { message: string } | null }) => T): Promise<T> {
    const guasto = this.errori[this.tabella];
    if (guasto) return Promise.resolve(risolvi({ data: null, error: { message: guasto } }));

    if (this.azione === 'select') {
      return Promise.resolve(risolvi({ data: this.righe(), error: null }));
    }
    if (this.azione === 'insert' || this.azione === 'upsert') {
      this.db[this.tabella] = [...(this.db[this.tabella] ?? []), ...this.daScrivere];
      this.diario.push({ op: this.azione, tabella: this.tabella, righe: this.daScrivere });
      return Promise.resolve(risolvi({ data: this.daScrivere, error: null }));
    }
    const scelte = this.righe();
    if (this.azione === 'update') {
      for (const r of scelte) Object.assign(r, this.valori);
      this.diario.push({ op: 'update', tabella: this.tabella, valori: this.valori, toccate: scelte.length });
    } else {
      this.db[this.tabella] = (this.db[this.tabella] ?? []).filter((r) => !scelte.includes(r));
      this.diario.push({ op: 'delete', tabella: this.tabella, toccate: scelte.length });
    }
    return Promise.resolve(risolvi({ data: scelte, error: null }));
  }
}

export type Scenario = {
  /** Le righe di partenza, tabella per tabella. */
  tabelle?: Tabelle;
  /** Cosa risponde ogni funzione del database chiamata dal giro. */
  rpc?: Record<string, { data: unknown; error: { message: string } | null }>;
  /** Tabelle che rispondono con un errore invece che con le righe. */
  errori?: Record<string, string>;
};

export function fintoGiroNotturno(scenario: Scenario = {}) {
  const db: Tabelle = scenario.tabelle ?? {};
  const diario: Voce[] = [];
  const errori = scenario.errori ?? {};

  const admin = {
    from: (tabella: string) => new FintaQuery(tabella, db, diario, errori),
    rpc: async (nome: string, _argomenti?: Record<string, unknown>) => {
      diario.push({ op: 'rpc', nome });
      return scenario.rpc?.[nome] ?? { data: [], error: null };
    },
    storage: {
      from: (secchio: string) => ({
        remove: async (percorsi: string[]) => {
          diario.push({ op: 'file-rimossi', secchio, percorsi });
          return { error: null };
        },
      }),
    },
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  };

  return {
    db,
    diario,
    admin,
    /** Le righe di una tabella, come stanno DOPO il giro. */
    righe: (tabella: string) => db[tabella] ?? [],
    /** Vero se il battito del lavoro è stato scritto: il freno anti-silenzio. */
    battitoScritto: () =>
      diario.some((v) => (v.op === 'upsert' || v.op === 'insert') && v.tabella === 'cron_heartbeats'),
    /** Le notifiche finite nel pannello degli amministratori. */
    notifiche: () =>
      diario.flatMap((v) => (v.op === 'insert' && v.tabella === 'notifications' ? v.righe : [])),
  };
}
