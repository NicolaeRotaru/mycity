/**
 * Un Supabase finto, in memoria, per le prove dell'ordine di SDG (27/11/2026). Fa quello che fa il sito con quelle
 * tabelle: select con filtri (eq, in, not is null), ordine e limite, maybeSingle, upsert con la chiave unica
 * (ignoreDuplicates), update con filtri e select. Due cose del database vero, apposta:
 *  · la chiave unica di ordini_sdg su seller_id (migrazione 999c): un secondo ordine non nasce;
 *  · le colonne che possono mancare (999b/999c non applicate): chi le chiede riceve l'errore di Postgres.
 */
type Riga = Record<string, unknown>;

export type DbFinto = {
  tabelle: Record<string, Riga[]>;
  /** Colonne che «non esistono ancora», per tabella. */
  colonneMancanti: Record<string, string[]>;
  /** Tabelle che «non esistono ancora». */
  tabelleMancanti: string[];
  /** Chiavi uniche, per tabella. */
  uniche: Record<string, string>;
  scritture: { tabella: string; tipo: 'insert' | 'update'; valori: Riga }[];
  /** I valori predefiniti delle colonne (DEFAULT del database), per tabella: entrano nelle righe nuove. */
  predefiniti?: Record<string, Riga>;
  /** Scritture che falliscono anche se la colonna c'è (un guasto del momento), per tabella: le colonne che le fanno cadere. */
  scrittureGuaste?: Record<string, string[]>;
};

export function nuovoDb(): DbFinto {
  return { tabelle: {}, colonneMancanti: {}, tabelleMancanti: [], uniche: { ordini_sdg: 'seller_id' }, scritture: [] };
}

let contatore = 0;
const nuovoId = () => `00000000-0000-4000-8000-${String(++contatore).padStart(12, '0')}`;

export function supabaseFinto(db: DbFinto) {
  return {
    from(tabella: string) {
      const filtri: ((r: Riga) => boolean)[] = [];
      let colonne = '*';
      const ordini: { k: string; asc: boolean }[] = [];
      let limite: number | null = null;
      let inizio = 0;
      let azione: { tipo: 'select' } | { tipo: 'update'; valori: Riga } | { tipo: 'upsert'; righe: Riga[]; ignora: boolean; su: string } = { tipo: 'select' };
      let restituisci = false;

      const mancante = (cols: string) => {
        if (db.tabelleMancanti.includes(tabella)) return `relation "public.${tabella}" does not exist`;
        const assenti = db.colonneMancanti[tabella] ?? [];
        const chieste = cols.split(',').map((c) => c.trim().split('!')[0].split('(')[0]);
        const c = chieste.find((x) => assenti.includes(x));
        return c ? `column ${tabella}.${c} does not exist` : null;
      };
      const righe = () => (db.tabelle[tabella] ??= []);
      const proietta = (r: Riga): Riga => {
        const fuori: Riga = { ...r };
        if (colonne.includes('profiles!inner(store_name)')) {
          const p = (db.tabelle.profiles ?? []).find((x) => x.id === r.seller_id);
          fuori.profiles = { store_name: p?.store_name ?? null };
        }
        return fuori;
      };
      const esegui = (): { data: unknown; error: { message: string } | null } => {
        if (azione.tipo === 'select') {
          const m = mancante(colonne);
          if (m) return { data: null, error: { message: m } };
          let r = righe().filter((x) => filtri.every((f) => f(x)));
          // Più order() uno dopo l'altro, come PostgREST: il secondo decide solo a parità del primo.
          const confronta = (a: Riga, b: Riga, k: string) => (typeof a[k] === 'number' && typeof b[k] === 'number' ? (a[k] as number) - (b[k] as number) : String(a[k] ?? '') < String(b[k] ?? '') ? -1 : String(a[k] ?? '') > String(b[k] ?? '') ? 1 : 0);
          if (ordini.length) r = [...r].sort((a, b) => { for (const { k, asc } of ordini) { const d = confronta(a, b, k); if (d) return asc ? d : -d; } return 0; });
          if (limite !== null) r = r.slice(inizio, limite);
          return { data: r.map(proietta), error: null };
        }
        if (azione.tipo === 'update') {
          const m = mancante(Object.keys(azione.valori).join(','));
          if (m) return { data: null, error: { message: m } };
          if (Object.keys(azione.valori).some((k) => db.scrittureGuaste?.[tabella]?.includes(k))) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
          const toccate = righe().filter((x) => filtri.every((f) => f(x)));
          for (const r of toccate) Object.assign(r, azione.valori);
          db.scritture.push({ tabella, tipo: 'update', valori: azione.valori });
          return { data: restituisci ? toccate.map((r) => ({ ...r })) : null, error: null };
        }
        const m = mancante(Object.keys(azione.righe[0] ?? {}).join(','));
        if (m) return { data: null, error: { message: m } };
        const unica = db.uniche[tabella] ?? azione.su;
        const nuove: Riga[] = [];
        for (const riga of azione.righe) {
          const gia = righe().find((x) => x[unica] === riga[unica]);
          if (gia) {
            if (azione.ignora) continue;
            return { data: null, error: { message: `duplicate key value violates unique constraint "${tabella}_${unica}_key"` } };
          }
          const nuova = { id: nuovoId(), creato_il: new Date().toISOString(), aggiornato_il: new Date().toISOString(), ...(db.predefiniti?.[tabella] ?? {}), ...riga };
          righe().push(nuova);
          nuove.push(nuova);
          db.scritture.push({ tabella, tipo: 'insert', valori: riga });
        }
        return { data: restituisci ? nuove.map((r) => ({ ...r })) : null, error: null };
      };

      const q = {
        select(c = '*') { if (azione.tipo === 'select') colonne = c; else restituisci = true; return q; },
        update(valori: Riga) { azione = { tipo: 'update', valori }; return q; },
        upsert(r: Riga | Riga[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { azione = { tipo: 'upsert', righe: Array.isArray(r) ? r : [r], ignora: Boolean(o.ignoreDuplicates), su: o.onConflict ?? 'id' }; return q; },
        insert(r: Riga | Riga[]) { azione = { tipo: 'upsert', righe: Array.isArray(r) ? r : [r], ignora: false, su: 'id' }; return q; },
        eq(k: string, v: unknown) { filtri.push((r) => r[k] === v); return q; },
        in(k: string, v: unknown[]) { filtri.push((r) => v.includes(r[k])); return q; },
        // 28/11/2026 — Per la mappa dei clienti: «is null» (prendere solo un cliente libero) e le pagine (range).
        is(k: string, v: unknown) { filtri.push((r) => (v === null ? r[k] === null || r[k] === undefined : r[k] === v)); return q; },
        range(da: number, a: number) { limite = a + 1; inizio = da; return q; },
        not(k: string, op: string, v: unknown) { if (op === 'is' && v === null) filtri.push((r) => r[k] !== null && r[k] !== undefined); return q; },
        order(k: string, o: { ascending?: boolean } = {}) { ordini.push({ k, asc: o.ascending !== false }); return q; },
        limit(n: number) { limite = n; return q; },
        async maybeSingle() {
          const e = esegui();
          if (e.error) return e;
          const d = e.data as Riga[] | null;
          return { data: d && d.length ? d[0] : null, error: null };
        },
        then<T>(ok: (v: { data: unknown; error: { message: string } | null }) => T, ko?: (e: unknown) => T) {
          try { return Promise.resolve(ok(esegui())); } catch (e) { return ko ? Promise.resolve(ko(e)) : Promise.reject(e); }
        },
      };
      return q;
    },
  };
}
