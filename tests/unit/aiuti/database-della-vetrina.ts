/**
 * IL FINTO DATABASE DELLA SQUADRA VETRINA: STORIE, DROP, EVENTI, LISTE, PROFILI PUBBLICI.
 *
 * 18/10/2026 — Nato per una domanda: «storie, drop del giorno, eventi, Chi siamo, liste e profili
 * pubblici si vedono ancora quando la tabella dei profili si chiude?». Il finto condiviso
 * (`database-coi-permessi.ts`) non conosce le storie, i drop, gli eventi, le liste, il conteggio
 * delle righe, e non simula la regola del profilo pubblico (033): con lui le liste e /u/ sarebbero
 * rosse anche nel mondo di oggi. Quello resta com'e' (lo usano le altre squadre); questo e' suo
 * cugino, con le stesse quattro regole di fondo:
 *
 *  ① LE REGOLE DI LETTURA PER CHI GUARDA. Su `profiles` chiunque legge la propria riga; nel mondo
 *    di OGGI anche i negozi approvati con insegna (018) e chi ha acceso il profilo pubblico (033).
 *    Dopo le migrazioni 110, 112 e 161 restano solo la propria riga (e l'amministratore).
 *  ② LA VISTA `seller_public_profiles` COI PERMESSI DI CHI L'HA CREATA: legge `profiles` per intero
 *    e mostra solo i venditori approvati con insegna, solo con le colonne della vista.
 *  ③ GLI AGGANCI SI LEGGONO COI PERMESSI DI CHI GUARDA: un aggancio a una riga che chi guarda non
 *    puo' leggere torna `null`, come in PostgREST.
 *  ④ UNA COLONNA CHE NON C'E' FA FALLIRE LA DOMANDA INTERA (42703).
 *
 * In piu': il client di servizio (`servizio: true`) legge tutto senza regole, come quello vero.
 */
import { COLONNE_VISTA_IN_PRODUZIONE } from './database-coi-permessi';

export type Riga = Record<string, unknown>;
export type Dati = Record<string, Riga[]>;

export type MondoVetrina = {
  nome: string;
  /** Le regole 018 (negozi approvati) e 033 (profilo pubblico) su `profiles`: vive oggi, tolte dopo. */
  profiliApertiAgliEstranei: boolean;
};

export const OGGI: MondoVetrina = { nome: 'oggi (migrazioni non applicate)', profiliApertiAgliEstranei: true };
export const DOPO: MondoVetrina = { nome: 'dopo le 48 migrazioni (profili chiusi)', profiliApertiAgliEstranei: false };

const COLONNE: Record<string, string[]> = {
  profiles: [
    ...COLONNE_VISTA_IN_PRODUZIONE,
    'full_name', 'email', 'billing_iban', 'public_profile_enabled', 'public_handle', 'public_bio', 'public_avatar_url',
  ],
  products: ['id', 'name', 'description', 'price', 'images', 'seller_id', 'status', 'created_at'],
  seller_stories: ['id', 'seller_id', 'image_url', 'caption', 'link_url', 'view_count', 'expires_at', 'created_at'],
  daily_drops: ['id', 'drop_date', 'discount_percent', 'original_price', 'drop_price', 'headline', 'product_id'],
  marketplace_events: [
    'id', 'title', 'description', 'cover_image_url', 'starts_at', 'ends_at', 'discount_percent', 'cta_label',
    'cta_url', 'status', 'sponsor_seller_id',
  ],
  product_lists: ['id', 'owner_id', 'title', 'description', 'cover_emoji', 'is_public', 'is_featured', 'updated_at'],
  product_list_items: ['list_id', 'product_id', 'sort_order', 'note'],
  cms_pages: ['slug', 'title', 'sections', 'status'],
  user_achievements: ['user_id', 'achievement_id', 'unlocked_at'],
};

/** Gli agganci: dalla tabella, con quale nome (relazione o vincolo), su quale colonna, verso dove. */
type Aggancio = { colonna: string; verso: string; inverso?: boolean };
const AGGANCI: Record<string, Record<string, Aggancio>> = {
  seller_stories: { profiles: { colonna: 'seller_id', verso: 'profiles' } },
  daily_drops: { products: { colonna: 'product_id', verso: 'products' } },
  products: { profiles: { colonna: 'seller_id', verso: 'profiles' } },
  marketplace_events: { profiles: { colonna: 'sponsor_seller_id', verso: 'profiles' } },
  product_lists: {
    profiles: { colonna: 'owner_id', verso: 'profiles' },
    // L'aggancio all'indietro: le voci che puntano a questa lista (`list_id`).
    product_list_items: { colonna: 'list_id', verso: 'product_list_items', inverso: true },
  },
  product_list_items: { products: { colonna: 'product_id', verso: 'products' } },
};

type Errore = { code: string; message: string };
class ErroreDb extends Error {
  constructor(readonly errore: Errore) {
    super(errore.message);
  }
}

type Voce =
  | { tipo: 'colonna'; nome: string }
  | { tipo: 'aggancio'; alias: string; relazione: string; figli: Voce[] };

function leggiSelect(select: string): Voce[] {
  const pulita = select.replace(/\s+/g, ' ').trim();
  const pezzi: string[] = [];
  let profondita = 0;
  let corrente = '';
  for (const c of pulita) {
    if (c === '(') profondita += 1;
    if (c === ')') profondita -= 1;
    if (c === ',' && profondita === 0) {
      pezzi.push(corrente.trim());
      corrente = '';
    } else {
      corrente += c;
    }
  }
  if (corrente.trim()) pezzi.push(corrente.trim());
  return pezzi.map((pezzo): Voce => {
    const aperta = pezzo.indexOf('(');
    if (aperta < 0) return { tipo: 'colonna', nome: pezzo };
    const testa = pezzo.slice(0, aperta).trim();
    const dentro = pezzo.slice(aperta + 1, pezzo.lastIndexOf(')'));
    const [alias, resto] = testa.includes(':') ? testa.split(':') : [null, testa];
    const relazione = resto.split('!')[0].trim();
    return { tipo: 'aggancio', alias: (alias ?? relazione).trim(), relazione, figli: leggiSelect(dentro) };
  });
}

type Filtro = { tipo: string; colonna: string; valore: unknown };

export type Lettura = { tabella: string; colonne: string };

/**
 * Il database, visto da `chi` (un id, o `null` per chi non ha l'account) nel `mondo` dato.
 * Con `servizio: true` e' il client di servizio: nessuna regola.
 */
export function databaseDellaVetrina(
  dati: Dati,
  mondo: MondoVetrina,
  chi: string | null,
  opzioni: { servizio?: boolean; tabellaGuasta?: string } = {},
) {
  const servizio = opzioni.servizio === true;
  const letture: Lettura[] = [];
  const profili = () => dati.profiles ?? [];
  const negozioApprovato = (id: unknown) =>
    profili().some((p) => p.id === id && p.role === 'seller' && p.is_approved === true);

  const colonneDi = (tabella: string): string[] =>
    tabella === 'seller_public_profiles' ? [...COLONNE_VISTA_IN_PRODUZIONE] : COLONNE[tabella] ?? [];

  const visibili = (tabella: string): Riga[] => {
    if (tabella === 'seller_public_profiles') {
      return profili()
        .filter((p) => p.is_approved === true && p.store_name != null && p.role === 'seller')
        .map((p) => Object.fromEntries(colonneDi(tabella).map((c) => [c, p[c] ?? null])));
    }
    const tutte = dati[tabella] ?? [];
    if (servizio) return tutte;
    switch (tabella) {
      case 'profiles':
        return tutte.filter(
          (p) =>
            (chi !== null && p.id === chi) ||
            (mondo.profiliApertiAgliEstranei &&
              ((p.is_approved === true && p.store_name != null) || p.public_profile_enabled === true)),
        );
      case 'products':
        return tutte.filter(
          (p) => (p.status === 'available' && negozioApprovato(p.seller_id)) || (chi !== null && p.seller_id === chi),
        );
      case 'seller_stories':
        return tutte.filter((s) => String(s.expires_at) > new Date().toISOString());
      case 'marketplace_events':
        return tutte.filter((e) => ['scheduled', 'live', 'ended'].includes(String(e.status)));
      case 'product_lists':
        return tutte.filter((l) => l.is_public === true || (chi !== null && l.owner_id === chi));
      case 'product_list_items': {
        const liste = visibili('product_lists').map((l) => l.id);
        return tutte.filter((i) => liste.includes(i.list_id));
      }
      case 'user_achievements':
        return tutte.filter((a) => chi !== null && a.user_id === chi);
      default:
        return tutte;
    }
  };

  const controllaColonna = (tabella: string, colonna: string) => {
    if (colonna === '*') return;
    if (!colonneDi(tabella).includes(colonna)) {
      throw new ErroreDb({ code: '42703', message: `column ${tabella}.${colonna} does not exist` });
    }
  };

  const proietta = (tabella: string, riga: Riga, voci: Voce[]): Riga => {
    const fuori: Riga = {};
    for (const v of voci) {
      if (v.tipo === 'colonna') {
        controllaColonna(tabella, v.nome);
        if (v.nome === '*') for (const c of colonneDi(tabella)) fuori[c] = riga[c] ?? null;
        else fuori[v.nome] = riga[v.nome] ?? null;
        continue;
      }
      const a = AGGANCI[tabella]?.[v.relazione];
      if (!a) {
        throw new ErroreDb({ code: 'PGRST200', message: `Could not find a relationship between '${tabella}' and '${v.relazione}'` });
      }
      if (a.inverso) {
        const figli = visibili(a.verso).filter((r) => r[a.colonna] === riga.id);
        const soloConta = v.figli.length === 1 && v.figli[0].tipo === 'colonna' && v.figli[0].nome === 'count';
        fuori[v.alias] = soloConta ? [{ count: figli.length }] : figli.map((f) => proietta(a.verso, f, v.figli));
        continue;
      }
      const bersaglio = visibili(a.verso).find((r) => r.id === riga[a.colonna]);
      fuori[v.alias] = bersaglio ? proietta(a.verso, bersaglio, v.figli) : null;
    }
    return fuori;
  };

  const confronta = (riga: Riga, f: Filtro): boolean => {
    const v = riga[f.colonna];
    switch (f.tipo) {
      case 'eq': return v === f.valore;
      case 'in': return (f.valore as unknown[]).includes(v);
      case 'gt': return String(v) > String(f.valore);
      case 'ilike': {
        const re = new RegExp(
          `^${String(f.valore).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`,
          'i',
        );
        return re.test(String(v ?? ''));
      }
      default: throw new Error(`filtro ${f.tipo} non simulato`);
    }
  };

  class Domanda {
    private colonne = '*';
    private conta = false;
    private soloTesta = false;
    private filtri: Filtro[] = [];
    private ordine: Array<{ colonna: string; crescente: boolean }> = [];
    private tetto: number | null = null;
    private modo: 'elenco' | 'una' | 'unaForse' = 'elenco';
    constructor(private readonly tabella: string) {}

    select(colonne = '*', o?: { count?: string; head?: boolean }) {
      this.colonne = colonne;
      letture.push({ tabella: this.tabella, colonne });
      this.conta = o?.count === 'exact';
      this.soloTesta = o?.head === true;
      return this;
    }
    eq(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'eq', colonna, valore }); return this; }
    in(colonna: string, valore: unknown[]) { this.filtri.push({ tipo: 'in', colonna, valore }); return this; }
    gt(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'gt', colonna, valore }); return this; }
    ilike(colonna: string, valore: string) { this.filtri.push({ tipo: 'ilike', colonna, valore }); return this; }
    order(colonna: string, o?: { ascending?: boolean }) { this.ordine.push({ colonna, crescente: o?.ascending !== false }); return this; }
    limit(n: number) { this.tetto = n; return this; }
    single() { this.modo = 'una'; return this; }
    maybeSingle() { this.modo = 'unaForse'; return this; }

    private esegui(): { data: unknown; error: Errore | null; count?: number | null } {
      // Variante scomoda: questa tabella non risponde (rete caduta, database fermo).
      if (opzioni.tabellaGuasta === this.tabella) {
        return { data: null, error: { code: '08006', message: 'connection failure' } };
      }
      try {
        const voci = leggiSelect(this.colonne);
        let righe = [...visibili(this.tabella)];
        for (const f of this.filtri) {
          controllaColonna(this.tabella, f.colonna);
          righe = righe.filter((r) => confronta(r, f));
        }
        for (const o of [...this.ordine].reverse()) {
          righe.sort((a, b) => {
            const cmp = String(a[o.colonna]) === String(b[o.colonna]) ? 0 : String(a[o.colonna]) < String(b[o.colonna]) ? -1 : 1;
            return o.crescente ? cmp : -cmp;
          });
        }
        if (this.tetto !== null) righe = righe.slice(0, this.tetto);
        const proiettate = righe.map((r) => proietta(this.tabella, r, voci));
        const count = this.conta ? proiettate.length : null;
        if (this.soloTesta) return { data: null, error: null, count };
        if (this.modo === 'elenco') return { data: proiettate, error: null, count };
        if (proiettate.length > 1) return { data: null, error: { code: 'PGRST116', message: 'more than one row' } };
        if (proiettate.length === 0 && this.modo === 'una') return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: proiettate[0] ?? null, error: null };
      } catch (e) {
        if (e instanceof ErroreDb) return { data: null, error: e.errore };
        throw e;
      }
    }

    then<T>(risolvi: (r: { data: unknown; error: Errore | null; count?: number | null }) => T, rifiuta?: (e: unknown) => T) {
      try {
        return Promise.resolve(risolvi(this.esegui()));
      } catch (e) {
        return rifiuta ? Promise.resolve(rifiuta(e)) : Promise.reject(e);
      }
    }
  }

  return {
    /** Ogni domanda fatta: tabella e colonne chieste. */
    letture,
    client: {
      from: (tabella: string) => new Domanda(tabella),
      rpc: async (nome: string) => {
        if (nome === 'event_rsvp_counts') return { data: [], error: null };
        return { data: null, error: { code: '42883', message: `function ${nome} does not exist` } };
      },
    },
  };
}
