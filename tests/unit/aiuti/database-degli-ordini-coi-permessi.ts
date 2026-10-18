/**
 * UN FINTO POSTGREST PER LE PAGINE DEGLI ORDINI, CHE RISPONDE COME RISPONDE A CHI GUARDA.
 *
 * 18/10/2026 (seconda ondata, squadra ordini) — Il gemello di `database-coi-permessi.ts`, che resta
 * com'e' (lo usano le altre squadre): quello conosce solo la vetrina — prodotti, categorie,
 * preferiti — e non gli ordini, le loro righe e le conversazioni. Qui servono proprio quelli, con
 * gli agganci che le pagine degli ordini scrivono (`profiles!orders_seller_id_fkey`,
 * `order_items ( … products ( … ) )`, `profiles!conversations_seller_id_fkey`).
 *
 * Fa le stesse quattro cose del gemello, sugli stessi mondi (`OGGI`, `DOPO_LA_161`,
 * `PROFILI_CHIUSI_VISTA_VECCHIA`, importati da li'):
 *  ① LE REGOLE DI LETTURA PER CHI GUARDA. Su `profiles` si vede la propria riga e, solo nel mondo di
 *    oggi, anche le righe approvate con un'insegna (la regola che le migrazioni 110/112/161 tolgono).
 *    Un ordine lo vedono il cliente, il fattorino assegnato e il negozio; una conversazione i due
 *    che ci parlano; le righe di un ordine chi vede l'ordine.
 *  ② LA VISTA PUBBLICA COI PERMESSI DI CHI L'HA CREATA: solo i negozi approvati, con insegna e col
 *    ruolo di negozio, e solo le colonne della vista (senza quelle della 126 dove non c'e').
 *  ③ GLI AGGANCI LETTI COI PERMESSI DI CHI GUARDA: un aggancio verso una riga che chi guarda non
 *    puo' leggere torna `null`. Due agganci verso la stessa tabella senza il nome del vincolo sono
 *    ambigui e fanno fallire la domanda (PGRST201), come sul server vero.
 *  ④ UNA COLONNA CHE LA VISTA NON HA FA FALLIRE TUTTA LA DOMANDA (42703).
 */
import { COLONNE_VISTA_IN_PRODUZIONE, type Mondo } from './database-coi-permessi';

export type Riga = Record<string, unknown>;
export type DatiOrdini = Record<string, Riga[]>;

const COLONNE_126 = [
  'business_legal_name', 'business_form', 'business_vat_number', 'business_address', 'business_city', 'business_zip',
];

type Aggancio = { verso: string; colonna: string; vincolo?: string; molti?: boolean };

/**
 * Le relazioni che il database conosce. `molti`: la tabella figlia punta al padre con `colonna`
 * (le righe di un ordine). Altrimenti e' il padre a puntare con `colonna` alla riga `verso`.
 */
const AGGANCI: Record<string, Aggancio[]> = {
  orders: [
    { verso: 'profiles', colonna: 'seller_id', vincolo: 'orders_seller_id_fkey' },
    { verso: 'profiles', colonna: 'rider_id', vincolo: 'orders_rider_id_fkey' },
    { verso: 'profiles', colonna: 'user_id', vincolo: 'orders_user_id_fkey' },
    { verso: 'order_items', colonna: 'order_id', molti: true },
  ],
  order_items: [{ verso: 'products', colonna: 'product_id', vincolo: 'order_items_product_id_fkey' }],
  conversations: [
    { verso: 'profiles', colonna: 'buyer_id', vincolo: 'conversations_buyer_id_fkey' },
    { verso: 'profiles', colonna: 'seller_id', vincolo: 'conversations_seller_id_fkey' },
  ],
};

type Errore = { code: string; message: string };
class ErroreDb extends Error {
  constructor(readonly errore: Errore) {
    super(errore.message);
  }
}

type Voce =
  | { tipo: 'colonna'; nome: string }
  | { tipo: 'aggancio'; alias: string; relazione: string; vincolo: string | null; figli: Voce[] };

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
    const parti = resto.split('!').map((p) => p.trim());
    const vincolo = parti.slice(1).find((p) => p !== 'inner' && p !== 'left') ?? null;
    return { tipo: 'aggancio', alias: (alias ?? parti[0]).trim(), relazione: parti[0], vincolo, figli: leggiSelect(dentro) };
  });
}

type Filtro = { tipo: string; colonna: string; valore: unknown };

/**
 * `vistaGiu`: la vista dei negozi risponde con un errore (per esempio un tempo scaduto), mentre
 * tutto il resto si legge. Serve a provare che un guasto della sola vista non spegne pagine intere.
 * `ordiniGiu`: lo stesso guasto sulla tabella degli ordini, per distinguere un guasto vero da un
 * ordine che non c'e'.
 */
export function databaseDegliOrdini(
  dati: DatiOrdini,
  mondo: Mondo,
  chi: string | null,
  opzioni: { vistaGiu?: boolean; ordiniGiu?: boolean } = {},
) {
  const righe = (t: string) => dati[t] ?? [];

  const colonneDellaVista = () =>
    mondo.vistaCon126 ? [...COLONNE_VISTA_IN_PRODUZIONE, ...COLONNE_126] : [...COLONNE_VISTA_IN_PRODUZIONE];

  const ordineVisibile = (o: Riga) =>
    chi !== null && (o.user_id === chi || o.rider_id === chi || o.seller_id === chi);

  /** Le righe che chi guarda puo' leggere, tabella per tabella. */
  const visibili = (tabella: string): Riga[] => {
    switch (tabella) {
      case 'profiles':
        return righe('profiles').filter(
          (p) =>
            (chi !== null && p.id === chi) ||
            (mondo.profiliApertiAgliEstranei && p.is_approved === true && p.store_name != null),
        );
      case 'seller_public_profiles': {
        const colonne = colonneDellaVista();
        return righe('profiles')
          .filter((p) => p.is_approved === true && p.store_name != null && p.role === 'seller')
          .map((p) => Object.fromEntries(colonne.map((c) => [c, p[c] ?? null])));
      }
      case 'orders':
        return righe('orders').filter(ordineVisibile);
      case 'order_items':
        return righe('order_items').filter((r) => righe('orders').some((o) => o.id === r.order_id && ordineVisibile(o)));
      case 'conversations':
        return righe('conversations').filter((c) => chi !== null && (c.buyer_id === chi || c.seller_id === chi));
      case 'messages':
        return righe('messages').filter((m) =>
          righe('conversations').some((c) => c.id === m.conversation_id && chi !== null && (c.buyer_id === chi || c.seller_id === chi)),
        );
      default:
        return righe(tabella);
    }
  };

  const controllaColonna = (tabella: string, colonna: string) => {
    if (tabella !== 'seller_public_profiles' || colonna === '*') return;
    if (!colonneDellaVista().includes(colonna)) {
      throw new ErroreDb({ code: '42703', message: `column ${tabella}.${colonna} does not exist` });
    }
  };

  const trovaAggancio = (tabella: string, v: Extract<Voce, { tipo: 'aggancio' }>): Aggancio => {
    const candidati = (AGGANCI[tabella] ?? []).filter(
      (a) => a.verso === v.relazione && (v.vincolo === null || a.vincolo === v.vincolo || a.colonna === v.vincolo),
    );
    if (candidati.length === 0) {
      throw new ErroreDb({ code: 'PGRST200', message: `Could not find a relationship between '${tabella}' and '${v.relazione}'` });
    }
    if (candidati.length > 1) {
      throw new ErroreDb({ code: 'PGRST201', message: `Could not embed because more than one relationship was found for '${tabella}' and '${v.relazione}'` });
    }
    return candidati[0];
  };

  const proietta = (tabella: string, riga: Riga, voci: Voce[]): Riga => {
    const fuori: Riga = {};
    for (const v of voci) {
      if (v.tipo === 'colonna') {
        controllaColonna(tabella, v.nome);
        if (v.nome === '*') Object.assign(fuori, riga);
        else fuori[v.nome] = riga[v.nome] ?? null;
        continue;
      }
      const a = trovaAggancio(tabella, v);
      if (a.molti) {
        fuori[v.alias] = visibili(a.verso)
          .filter((figlio) => figlio[a.colonna] === riga.id)
          .map((figlio) => proietta(a.verso, figlio, v.figli));
      } else {
        const bersaglio = visibili(a.verso).find((r) => r.id === riga[a.colonna]);
        fuori[v.alias] = bersaglio ? proietta(a.verso, bersaglio, v.figli) : null;
      }
    }
    return fuori;
  };

  const confronta = (riga: Riga, f: Filtro): boolean => {
    const v = riga[f.colonna];
    switch (f.tipo) {
      case 'eq': return v === f.valore;
      case 'neq': return v !== f.valore;
      case 'is': return (v ?? null) === (f.valore ?? null);
      case 'in': return (f.valore as unknown[]).includes(v);
      case 'lte': return String(v) <= String(f.valore);
      case 'gte': return String(v) >= String(f.valore);
      default: throw new Error(`filtro ${f.tipo} non simulato`);
    }
  };

  class Domanda {
    private colonne = '*';
    private filtri: Filtro[] = [];
    private alternative: Filtro[][] = [];
    private ordine: Array<{ colonna: string; crescente: boolean }> = [];
    private tetto: number | null = null;
    private modo: 'elenco' | 'una' | 'unaForse' = 'elenco';
    constructor(private readonly tabella: string) {}

    select(colonne = '*') { this.colonne = colonne; return this; }
    eq(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'eq', colonna, valore }); return this; }
    neq(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'neq', colonna, valore }); return this; }
    is(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'is', colonna, valore }); return this; }
    in(colonna: string, valore: unknown[]) { this.filtri.push({ tipo: 'in', colonna, valore }); return this; }
    lte(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'lte', colonna, valore }); return this; }
    gte(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'gte', colonna, valore }); return this; }
    /** `or('buyer_id.eq.X,seller_id.eq.X')`: basta che una delle condizioni valga. */
    or(espressione: string) {
      this.alternative.push(
        espressione.split(',').map((pezzo) => {
          const [colonna, tipo, ...resto] = pezzo.split('.');
          return { tipo, colonna, valore: resto.join('.') };
        }),
      );
      return this;
    }
    order(colonna: string, o?: { ascending?: boolean }) { this.ordine.push({ colonna, crescente: o?.ascending !== false }); return this; }
    limit(n: number) { this.tetto = n; return this; }
    single() { this.modo = 'una'; return this; }
    maybeSingle() { this.modo = 'unaForse'; return this; }

    private esegui(): { data: unknown; error: Errore | null } {
      if ((opzioni.vistaGiu && this.tabella === 'seller_public_profiles') || (opzioni.ordiniGiu && this.tabella === 'orders')) {
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      }
      try {
        const voci = leggiSelect(this.colonne);
        let tutte = [...visibili(this.tabella)];
        for (const f of this.filtri) {
          controllaColonna(this.tabella, f.colonna);
          tutte = tutte.filter((r) => confronta(r, f));
        }
        for (const gruppo of this.alternative) tutte = tutte.filter((r) => gruppo.some((f) => confronta(r, f)));
        for (const o of [...this.ordine].reverse()) {
          tutte.sort((a, b) => {
            const cmp = String(a[o.colonna]) === String(b[o.colonna]) ? 0 : String(a[o.colonna]) < String(b[o.colonna]) ? -1 : 1;
            return o.crescente ? cmp : -cmp;
          });
        }
        if (this.tetto !== null) tutte = tutte.slice(0, this.tetto);
        const proiettate = tutte.map((r) => proietta(this.tabella, r, voci));
        if (this.modo === 'elenco') return { data: proiettate, error: null };
        if (proiettate.length > 1) return { data: null, error: { code: 'PGRST116', message: 'more than one row' } };
        if (proiettate.length === 0 && this.modo === 'una') return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: proiettate[0] ?? null, error: null };
      } catch (e) {
        if (e instanceof ErroreDb) return { data: null, error: e.errore };
        throw e;
      }
    }

    then<T>(risolvi: (r: { data: unknown; error: Errore | null }) => T, rifiuta?: (e: unknown) => T) {
      try {
        return Promise.resolve(risolvi(this.esegui()));
      } catch (e) {
        return rifiuta ? Promise.resolve(rifiuta(e)) : Promise.reject(e);
      }
    }
  }

  const letture: string[] = [];
  return {
    letture,
    client: {
      from: (tabella: string) => {
        letture.push(tabella);
        return new Domanda(tabella);
      },
      rpc: async (nome: string) => ({ data: null, error: { code: '42883', message: `function ${nome} does not exist` } }),
    },
  };
}
