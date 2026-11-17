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

/**
 * 15/10/2026 (R13 · R43) — LE PORTE DELL'ACCESSO, DECISE DALLA PROVA.
 *
 * Le pagine di accesso, registrazione, verifica dell'email e nuova password
 * chiamano `signUp`, `resend`, `setSession`, `resetPasswordForEmail`,
 * `updateUser`: qui non c'erano, e una prova che montava una di quelle pagine la
 * vedeva scoppiare al primo clic — per questo nessuna le montava, e i loro
 * difetti si potevano rimettere a suite verde. Con `globalThis.__AUTH_FINTA__`
 * (un oggetto di funzioni) la prova dice cosa risponde ognuna e conta le
 * chiamate. Chi non lo imposta riceve una risposta vuota e senza errore.
 */
const portaAuth = (nome, ripiego) => async (...argomenti) => {
  const finta = globalThis.__AUTH_FINTA__?.[nome];
  if (typeof finta === 'function') return finta(...argomenti);
  return ripiego;
};
const NESSUNO = { data: { user: null, session: null }, error: null };

/**
 * 17/11/2026 — Come nel client vero, la risposta di una funzione del database si concatena
 * prima dell'attesa: `.rpc(...).order(...).range(...)`. Prima `rpc` era una funzione async e
 * tornava una promessa nuda: il secondo anello scoppiava, e una pagina che pagina i risultati di
 * una funzione non si poteva montare. Qui gli anelli passano oltre (come quelli di `from` senza
 * database della prova) e l'attesa dà la risposta del database della prova.
 */
/**
 * 17/11/2026 — Una funzione che la prova non ha previsto (nessun database della prova con `rpc`)
 * non risponde più «nessun errore». Prima `{ data: null, error: null }`: una pagina che salva con
 * una funzione del database sembrava riuscita anche se non scriveva niente. Ora risponde con un
 * errore che dice quale funzione mancava; la risposta la dà la prova con `__CLIENT_SUPABASE__`.
 */
const rpcNonPrevista = (nome) => ({
  data: null,
  error: {
    code: 'RPC_NON_PREVISTA',
    message: `Prova: nessuna risposta prevista per la funzione del database «${nome}» (dalla con globalThis.__CLIENT_SUPABASE__.rpc).`,
    details: null,
    hint: null,
  },
});

const catenaDiUnaFunzione = (nome, argomenti) => {
  /**
   * 17/11/2026 — La chiamata al database della prova parte solo quando qualcuno aspetta la
   * risposta (`then`/`await`, o la riga sola di `single`), come nel client vero, e una volta sola
   * anche se la si aspetta due volte. Prima partiva subito, a `.rpc(...)`: una funzione chiamata e
   * mai aspettata, che nel client vero non arriva mai al database, nella prova sembrava arrivata.
   * Fino ad allora gli anelli si annotano, e alla partenza si fanno nell'ordine.
   */
  const anelli = [];
  let riga = null;
  let partita;
  const parti = () => {
    if (!partita) {
      try {
        let esito = clientDellaProva()?.rpc ? clientDellaProva().rpc(nome, argomenti) : rpcNonPrevista(nome);
        /**
         * 17/11/2026 — Gli anelli dopo la funzione arrivano al database della prova, come quelli di
         * `from`: se la sua risposta sa fare `order`, `range`, `eq`… li fa lei, e la prova vede la
         * finestra chiesta. Prima passavano oltre sempre, e una funzione che taglia e ordina
         * restituiva tutte le righe. Una risposta che non li sa fare (una promessa nuda, come quella
         * dei database delle prove di oggi) li lascia passare oltre come prima.
         */
        for (const [m, a] of anelli) if (typeof esito?.[m] === 'function') esito = esito[m](...a);
        const daTagliare = riga !== null && typeof esito?.[riga] !== 'function';
        if (riga !== null && !daTagliare) esito = esito[riga]();
        partita = Promise.resolve(esito).then((r) => (daTagliare
          ? { data: Array.isArray(r?.data) ? (r.data[0] ?? null) : (r?.data ?? null), error: r?.error ?? null }
          : r));
      } catch (errore) {
        partita = Promise.reject(errore);
      }
    }
    return partita;
  };
  const c = {};
  for (const m of ['eq', 'neq', 'in', 'or', 'ilike', 'gte', 'lte', 'order', 'limit', 'range', 'is', 'not', 'contains', 'overlaps', 'filter', 'match', 'select']) {
    c[m] = (...a) => { anelli.push([m, a]); return c; };
  }
  c.then = (risolvi, rifiuta) => parti().then(risolvi, rifiuta);
  // Una riga sola: si aspetta come una promessa, e parte anche lei solo all'attesa.
  const unaRiga = (m) => () => {
    riga = m;
    return {
      then: (risolvi, rifiuta) => parti().then(risolvi, rifiuta),
      catch: (rifiuta) => parti().catch(rifiuta),
      finally: (allaFine) => parti().finally(allaFine),
    };
  };
  c.single = unaRiga('single');
  c.maybeSingle = unaRiga('maybeSingle');
  return c;
};

export const supabase = {
  from: (tavola) => (clientDellaProva() ? clientDellaProva().from(tavola) : catena(tavola)),
  rpc: (nome, argomenti) => catenaDiUnaFunzione(nome, argomenti),
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
    // S10 (5/11/2026) — Come il client vero: l'esito dello scambio del `code`
    // all'avvio. La pagina della nuova password lo legge.
    initialize: async () => ({ error: null }),
    signOut: portaAuth('signOut', { error: null }),
    signUp: portaAuth('signUp', NESSUNO),
    signInWithPassword: portaAuth('signInWithPassword', NESSUNO),
    resend: portaAuth('resend', NESSUNO),
    setSession: portaAuth('setSession', NESSUNO),
    resetPasswordForEmail: portaAuth('resetPasswordForEmail', { data: {}, error: null }),
    updateUser: portaAuth('updateUser', NESSUNO),
    exchangeCodeForSession: portaAuth('exchangeCodeForSession', NESSUNO),
  },
  // 5/11/2026 (S04) — Un canale vero si concatena: `.on(...).on(...).subscribe()`. Prima il
  // secondo `.on` non c'era, e ogni pagina che ascolta due eventi registrava un TypeError a ogni
  // giro, che chi legge i log prendeva per un guasto della pagina.
  channel: () => {
    const canale = { on: () => canale, subscribe: () => canale, unsubscribe: () => {} };
    return canale;
  },
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

/** Le scorciatoie di `lib/supabase/client.ts`, che passano dalle stesse porte qui sopra. */
export const auth = {
  signUp: (email, password, options) => supabase.auth.signUp({ email, password, options }),
  signIn: (email, password, options) => supabase.auth.signInWithPassword({ email, password, options }),
  signOut: () => supabase.auth.signOut(),
};

export default supabase;
