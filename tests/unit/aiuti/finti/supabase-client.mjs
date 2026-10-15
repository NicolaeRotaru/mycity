/**
 * Il client Supabase in finto: qui non si legge nessun database, ma il modulo
 * vero va in errore senza le chiavi d'ambiente e porterebbe giù il montaggio.
 */
/**
 * 30/8/2026 (R088) — la risposta di una lettura la può decidere la prova.
 *
 * Prima da qui usciva sempre `{ data: [], error: null }`: nessuna prova poteva montare una pagina
 * con dei prodotti veri in mano, né con la lettura caduta. Con `globalThis.__RISPOSTA_SUPABASE__`
 * — un oggetto, o una funzione che riceve `{ tavola, colonne }` — la prova dice cosa risponde il
 * database. Chi non lo imposta non si accorge di niente: si torna alla lista vuota di prima.
 */
const catena = (tavola) => {
  const c = {};
  let colonne = '';
  const passa = () => c;
  for (const m of ['insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'or', 'ilike', 'gte', 'lte', 'order', 'limit', 'range', 'is', 'not', 'contains', 'overlaps', 'filter', 'match']) {
    c[m] = passa;
  }
  c.select = (cols) => { colonne = cols ?? ''; return c; };
  const risposta = () => {
    const detta = globalThis.__RISPOSTA_SUPABASE__;
    const esito = typeof detta === 'function' ? detta({ tavola, colonne }) : detta;
    return esito ?? { data: [], error: null };
  };
  c.single = async () => { const r = risposta(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error ?? null }; };
  c.maybeSingle = c.single;
  c.then = (risolvi) => Promise.resolve(risposta()).then(risolvi);
  return c;
};

/**
 * 15/10/2026 (R3) — e la risposta la può dare anche un database finto intero.
 *
 * `__RISPOSTA_SUPABASE__` vede solo la tavola e le colonne, non i filtri né chi guarda: con lui
 * non si poteva mettere in scena «la tabella dei profili si è chiusa e la fascia si svuota». Con
 * `globalThis.__CLIENT_SUPABASE__` la prova consegna un client che applica regole e agganci (per
 * esempio `aiuti/database-coi-permessi.ts`), e la lettura scritta nel componente gira contro di
 * lui. Chi non lo imposta non si accorge di niente.
 */
const clientDellaProva = () => globalThis.__CLIENT_SUPABASE__;

export const supabase = {
  from: (tavola) => (clientDellaProva() ? clientDellaProva().from(tavola) : catena(tavola)),
  rpc: async (nome, argomenti) =>
    clientDellaProva()?.rpc ? clientDellaProva().rpc(nome, argomenti) : { data: null, error: null },
  auth: {
    // Chi è collegato lo decide la prova, con `globalThis.__UTENTE__`.
    getUser: async () => ({ data: { user: globalThis.__UTENTE__ ?? null }, error: null }),
    // Il gettone della sessione lo decide la prova con `globalThis.__GETTONE__`
    // (15/10/2026): chi non lo imposta ha la sessione di prima, senza gettone, e
    // i componenti che lo pretendono si fermano su «Sessione scaduta» come prima.
    getSession: async () => ({
      data: {
        session: globalThis.__UTENTE__
          ? { user: globalThis.__UTENTE__, access_token: globalThis.__GETTONE__ }
          : null,
      },
      error: null,
    }),
    /**
     * Chi ascolta i cambi di sessione si registra qui. La prova che vuole
     * provare cosa succede a un'uscita richiama gli ascolti a mano:
     * `globalThis.__ASCOLTI_AUTH__.forEach((a) => a('SIGNED_OUT', null))`.
     * Chi non li guarda non si accorge di niente.
     */
    onAuthStateChange: (ascolto) => {
      if (typeof ascolto === 'function') {
        (globalThis.__ASCOLTI_AUTH__ ??= []).push(ascolto);
      }
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signOut: async () => ({ error: null }),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => {} }),
  removeChannel: () => {},
  storage: {
    // L'indirizzo pubblico di una foto caricata lo decide la prova con
    // `globalThis.__URL_PUBBLICO__` (una funzione del percorso). Senza, resta
    // vuoto come prima (15/10/2026).
    from: () => ({
      getPublicUrl: (percorso) => ({
        data: {
          publicUrl: typeof globalThis.__URL_PUBBLICO__ === 'function' ? globalThis.__URL_PUBBLICO__(percorso) : '',
        },
      }),
      upload: async () => ({ data: null, error: null }),
    }),
  },
};

export default supabase;
