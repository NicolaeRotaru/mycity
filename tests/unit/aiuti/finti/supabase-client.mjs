/**
 * Il client Supabase in finto: qui non si legge nessun database, ma il modulo
 * vero va in errore senza le chiavi d'ambiente e porterebbe giù il montaggio.
 */
const catena = () => {
  const c = {};
  const passa = () => c;
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'or', 'ilike', 'gte', 'lte', 'order', 'limit', 'range', 'is', 'not', 'contains', 'overlaps', 'filter', 'match']) {
    c[m] = passa;
  }
  c.single = async () => ({ data: null, error: null });
  c.maybeSingle = async () => ({ data: null, error: null });
  c.then = (risolvi) => Promise.resolve({ data: [], error: null }).then(risolvi);
  return c;
};

export const supabase = {
  from: () => catena(),
  rpc: async () => ({ data: null, error: null }),
  auth: {
    // Chi è collegato lo decide la prova, con `globalThis.__UTENTE__`.
    getUser: async () => ({ data: { user: globalThis.__UTENTE__ ?? null }, error: null }),
    getSession: async () => ({
      data: { session: globalThis.__UTENTE__ ? { user: globalThis.__UTENTE__ } : null },
      error: null,
    }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => {} }),
  removeChannel: () => {},
  storage: {
    from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({ data: null, error: null }) }),
  },
};

export default supabase;
