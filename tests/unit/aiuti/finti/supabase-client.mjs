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

export const supabase = {
  from: (tavola) => catena(tavola),
  rpc: async () => ({ data: null, error: null }),
  auth: {
    // Chi è collegato lo decide la prova, con `globalThis.__UTENTE__`.
    getUser: async () => ({ data: { user: globalThis.__UTENTE__ ?? null }, error: null }),
    getSession: async () => ({
      data: { session: globalThis.__UTENTE__ ? { user: globalThis.__UTENTE__ } : null },
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
    from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({ data: null, error: null }) }),
  },
};

export default supabase;
