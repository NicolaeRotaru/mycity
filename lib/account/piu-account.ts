/**
 * PIÙ ACCOUNT SULLO STESSO DISPOSITIVO — 25/11/2026.
 *
 * Nicola: «aggiungi la possibilità di avere più account e fare lo switch senza doversi disconnettere
 * dall'account». Scelta sua: per tutti (cliente, negozio, fattorino, admin), nel menu dell'account,
 * come su Gmail; gli accessi restano salvati solo su quel dispositivo.
 *
 * COME FUNZIONA
 *  · «Aggiungi un altro account» salva l'accesso di chi c'è adesso e apre la pagina di accesso. Il
 *    nuovo accesso prende il posto di quello attivo SENZA chiuderlo sul server: quello di prima resta
 *    valido e salvato qui.
 *  · «Passa a …» prende l'accesso salvato, lo rinnova a parte e solo se è ancora buono lo installa.
 *    Se lo si installasse direttamente e non fosse più buono, la libreria dell'accesso farebbe uscire
 *    anche l'account attivo (auth-js, _callRefreshToken → _removeSession): per questo la prova si fa
 *    prima, con una chiamata a parte che non tocca la sessione di nessuno.
 *  · «Esci» chiude l'account attivo sul server e dimentica tutto quello che è salvato qui.
 *
 * IL PRINCIPIO DEL CARRELLO E DELLE BOZZE (Nicola, 25/11 notte: «rifai la base»).
 * I primi quattro collaudi trovavano ogni volta un'altra strada per cui la spesa o la bozza di un
 * account finiva a un altro, perché le protezioni si accendevano solo dentro il percorso «Aggiungi».
 * Ora la regola è una sola e non dipende dalla strada: il browser ricorda di chi sono i dati che
 * contiene (`CHIAVE_UTENTE_DEL_BROWSER`). Quando entra un account diverso da quello, per qualunque
 * strada — cambio, aggiunta, un link e poi «indietro», un'altra scheda —, carrello e bozze di quello
 * di prima vanno da parte sotto il suo id, e tornano quelle del nuovo (`allineaUtenteDelBrowser`).
 * La chiamano la sincronizzazione del carrello (prima di fondere) e RicordaAccount: chi arriva primo
 * fa il lavoro, l'altro trova già fatto, e l'ordine dei componenti non conta.
 * Senza nessuno prima (chi entra da ospite, o dopo «Esci») non si mette da parte niente: il carrello
 * da ospite si fonde nell'account come sempre.
 *
 * LE SCHEDE. Il cookie dell'accesso è uno solo per tutto il browser. Una scheda che vede arrivare un
 * account diverso da quello della sua pagina, fuori dalle pagine di accesso e senza averlo chiesto
 * lei, si ferma con un avviso e non salva più bozze fino al ricaricamento (RicordaAccount). Nei pochi
 * istanti prima che l'avviso arrivi, il segno a tempo `CHIAVE_IN_CORSO` (con l'id del nuovo account)
 * ferma i salvataggi delle pagine che non sono di quell'account.
 *
 * COSA SI SALVA E DOVE: nel localStorage del browser, che è lo stesso posto dove la libreria tiene
 * già la sessione attiva (nei cookie leggibili dal browser): nessuna esposizione nuova. Al massimo
 * cinque account; per ognuno id, email, nome e la coppia di chiavi dell'accesso. Un accesso salvato
 * da più di 6 mesi si scarta, come il cookie dell'accesso (lib/supabase/client.ts), e le sue bozze
 * messe da parte se ne vanno con lui.
 *
 * Qui non c'è React né il client di Supabase: le funzioni ricevono quello che usano, così le prove
 * le fanno girare senza browser.
 */

export const CHIAVE_ACCOUNT = 'mycity:account-salvati';
/** Nella scheda (sessionStorage): l'id di chi ha premuto «Aggiungi un altro account». */
export const CHIAVE_AGGIUNTA = 'mycity:aggiunta-account';
/** Di chi sono i dati (carrello, bozze) che il browser contiene adesso. */
export const CHIAVE_UTENTE_DEL_BROWSER = 'mycity:utente-del-browser';
export const MASSIMO_ACCOUNT = 5;
/** Quanto vale un accesso salvato: 6 mesi, come il cookie dell'accesso (DURATA_MASSIMA_SESSIONE_S). */
export const DURATA_ACCESSO_SALVATO_MS = 180 * 24 * 60 * 60 * 1000;
/** Scritta a ogni cambio: le ALTRE schede la sentono (evento «storage») e si fermano con un avviso. */
export const CHIAVE_CAMBIO = 'mycity:cambio-account';
/** «<id del nuovo account>:<ora>»: per pochi secondi le pagine di altri account non salvano bozze. */
export const CHIAVE_IN_CORSO = 'mycity:cambio-in-corso';
const DURATA_IN_CORSO_MS = 15_000;
/** I dati del browser che appartengono a un account. */
export const CHIAVI_DELL_ACCOUNT = [
  'mc_new_product_draft', 'mc_checkout_draft', 'mycity:ai-batch:lavoro', 'mc_addr_hint',
  // il carrello e le sue due date (lib/cart.ts, components/CartCrossDeviceSync.tsx)
  'cart', 'cart_updated_at', 'mc_cart_synced_at',
] as const;
/** Le pagine dove si entra in un account: lì un account nuovo è atteso, non un cambio fatto altrove. */
export const PAGINE_DELL_ACCESSO = ['/sign-in', '/sign-up', '/auth/', '/reset-password'];
const DA_PARTE = 'mycity:da-parte:';
/** La bozza della cassa: nome, telefono e indirizzo scritti da ospite prima dell'accesso (app/checkout/page.tsx). */
const BOZZA_DELLA_CASSA = 'mc_checkout_draft';
/** L'evento che avvisa i menu aperti che l'elenco è cambiato (nella stessa scheda «storage» non arriva). */
export const EVENTO_ACCOUNT = 'mycity:account-cambiati';

export type AccountSalvato = {
  id: string;
  email: string | null;
  nome: string | null;
  accessToken: string;
  refreshToken: string;
  salvatoIl: number;
};

/** Quello che serve di una sessione di Supabase. */
export type SessioneMinima = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
};

type Deposito = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>;

function locale(): Deposito | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function scheda(): Deposito | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
function leggi(d: Deposito | null, k: string): string | null {
  try { return d?.getItem(k) ?? null; } catch { return null; }
}
function metti(d: Deposito | null, k: string, v: string): void {
  try { d?.setItem(k, v); } catch { /* deposito pieno o chiuso */ }
}
function togli(d: Deposito | null, k: string): void {
  try { d?.removeItem(k); } catch { /* noop */ }
}

function avvisa() {
  try { window.dispatchEvent(new Event(EVENTO_ACCOUNT)); } catch { /* fuori dal browser */ }
}

const testo = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function valido(x: unknown): x is AccountSalvato {
  const a = x as Partial<AccountSalvato> | null;
  return !!a && typeof a.id === 'string' && !!a.id && typeof a.accessToken === 'string' && !!a.accessToken
    && typeof a.refreshToken === 'string' && !!a.refreshToken;
}

/** Gli account salvati su questo dispositivo, il più recente per primo. Mai un errore: al peggio nessuno. */
export function leggiAccount(d: Deposito | null = locale(), ora = Date.now()): AccountSalvato[] {
  try {
    const grezzo = JSON.parse(leggi(d, CHIAVE_ACCOUNT) ?? '[]') as unknown;
    return Array.isArray(grezzo)
      ? grezzo.filter(valido).filter((a) => ora - Number(a.salvatoIl ?? 0) <= DURATA_ACCESSO_SALVATO_MS).slice(0, MASSIMO_ACCOUNT)
      : [];
  } catch {
    return [];
  }
}

/** Le chiavi del deposito che cominciano così (il deposito vero ha `length` e `key`). */
function chiaviCon(prefisso: string, d: Deposito | null): string[] {
  const chiavi: string[] = [];
  try {
    for (let i = 0; i < (d?.length ?? 0); i++) {
      const k = d?.key?.(i);
      if (k?.startsWith(prefisso)) chiavi.push(k);
    }
  } catch { /* noop */ }
  return chiavi;
}

function scrivi(lista: AccountSalvato[], d: Deposito | null) {
  const tenuti = lista.slice(0, MASSIMO_ACCOUNT);
  if (tenuti.length === 0) togli(d, CHIAVE_ACCOUNT);
  else metti(d, CHIAVE_ACCOUNT, JSON.stringify(tenuti));
  // I dati messi da parte per un account che non c'è più nell'elenco se ne vanno con lui; si tengono
  // solo quelli di chi è nell'elenco e di chi ha i dati nel browser adesso.
  const vivi = new Set(tenuti.map((a) => a.id));
  const delBrowser = leggi(d, CHIAVE_UTENTE_DEL_BROWSER);
  if (delBrowser) vivi.add(delBrowser);
  for (const k of chiaviCon(DA_PARTE, d)) {
    if (!vivi.has(k.slice(DA_PARTE.length).split(':')[0])) togli(d, k);
  }
  avvisa();
}

/** Salva (o rinfresca) l'accesso di una sessione, in cima all'elenco. */
export function ricordaSessione(s: SessioneMinima, d: Deposito | null = locale(), ora = Date.now()): AccountSalvato[] {
  const meta = s.user.user_metadata ?? {};
  const voce: AccountSalvato = {
    id: s.user.id,
    email: testo(s.user.email),
    nome: testo(meta.store_name) ?? testo(meta.full_name) ?? testo(meta.name),
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    salvatoIl: ora,
  };
  const prima = leggiAccount(d, ora);
  const vecchia = prima.find((a) => a.id === voce.id);
  if (vecchia && !voce.nome) voce.nome = vecchia.nome;
  const lista = [voce, ...prima.filter((a) => a.id !== voce.id)];
  scrivi(lista, d);
  return lista;
}

export function dimenticaAccount(id: string, d: Deposito | null = locale()): void {
  scrivi(leggiAccount(d).filter((a) => a.id !== id), d);
}

/** «Esci»: niente resta su questo dispositivo, nemmeno i dati messi da parte per gli altri account. */
export function dimenticaTutti(d: Deposito | null = locale(), s: Deposito | null = scheda()): void {
  togli(d, CHIAVE_UTENTE_DEL_BROWSER);
  scrivi([], d);
  togli(s, CHIAVE_AGGIUNTA);
  togli(d, CHIAVE_CAMBIO);
  togli(d, CHIAVE_IN_CORSO);
}

// ───────────────────────────── il principio del carrello e delle bozze ─────────────────────────────

/** Mette da parte i dati di quell'account (sotto il suo id) e li toglie dal browser. */
export function metteDaParte(id: string, d: Deposito | null = locale()): void {
  for (const k of CHIAVI_DELL_ACCOUNT) {
    const v = leggi(d, k);
    if (v !== null) metti(d, `${DA_PARTE}${id}:${k}`, v);
    togli(d, k);
  }
}

/**
 * Rimette nel browser i dati messi da parte per quell'account. Un dato che nel browser c'è già è più
 * nuovo di quello messo da parte, e vince lui.
 */
export function riprendi(id: string, d: Deposito | null = locale()): void {
  for (const k of CHIAVI_DELL_ACCOUNT) {
    const v = leggi(d, `${DA_PARTE}${id}:${k}`);
    if (v !== null && leggi(d, k) === null) metti(d, k, v);
    togli(d, `${DA_PARTE}${id}:${k}`);
  }
}

/**
 * La regola: i dati del browser sono di `id`. Se erano di un altro account, vanno da parte per lui e
 * tornano quelli di `id`. Se non erano di nessuno (ospite, dopo «Esci») restano e diventano suoi.
 * Si può chiamare quante volte si vuole: risponde se ha spostato qualcosa.
 */
export function allineaUtenteDelBrowser(id: string, d: Deposito | null = locale()): boolean {
  const prima = leggi(d, CHIAVE_UTENTE_DEL_BROWSER);
  if (prima === id) return false;
  if (prima) metteDaParte(prima, d);
  riprendi(id, d);
  metti(d, CHIAVE_UTENTE_DEL_BROWSER, id);
  if (!prima) return false;
  // Chi ha spostato i dati avvisa le altre schede, ancora sull'account di prima: subito il segno a
  // tempo, poi il segnale che apre il loro avviso.
  segnaInCorso(id, d);
  segnaCambio(id, d);
  return true;
}

// ───────────────────────────────────────── le schede ─────────────────────────────────────────

/** Di chi è la pagina aperta in questa scheda, e se è ferma sotto l'avviso: valgono fino al ricaricamento. */
let utenteDellaPagina: string | null = null;
let schedaFerma = false;
let cambioQui = false;

export function utenteDellaPaginaAttuale(): string | null { return utenteDellaPagina; }
export function segnaUtenteDellaPagina(id: string | null): void { utenteDellaPagina = id; }
export function fermaQuestaScheda(): void { schedaFerma = true; }
/** Il cambio l'ha chiesto questa scheda («Passa a…»): non è un cambio fatto altrove. */
export function cambioChiestoQui(): boolean { return cambioQui; }
/** Solo per le prove: la scheda riparte come dopo un ricaricamento. */
export function _riparteLaScheda(): void { utenteDellaPagina = null; schedaFerma = false; cambioQui = false; }

/** Avvisa le altre schede che l'account è cambiato (lo ascolta RicordaAccount). */
export function segnaCambio(id: string, d: Deposito | null = locale(), ora = Date.now()): void {
  metti(d, CHIAVE_CAMBIO, `${id}:${ora}`);
}
function segnaInCorso(id: string, d: Deposito | null = locale(), ora = Date.now()) {
  metti(d, CHIAVE_IN_CORSO, `${id}:${ora}`);
}

/**
 * I moduli di questa pagina non devono salvare bozze (useFormAutosave): la scheda è ferma sotto
 * l'avviso, o è appena entrato un altro account e la pagina non è sua.
 */
export function cambioInCorso(d: Deposito | null = locale(), ora = Date.now()): boolean {
  if (schedaFerma) return true;
  const [id, quando] = (leggi(d, CHIAVE_IN_CORSO) ?? '').split(':');
  const fresco = Number(quando) > 0 && ora - Number(quando) < DURATA_IN_CORSO_MS;
  return fresco && id !== utenteDellaPagina;
}

/**
 * Un evento dell'accesso visto da questa scheda. Risponde `true` se la scheda deve fermarsi con
 * l'avviso: è arrivato un account diverso da quello della pagina, fuori dalle pagine di accesso, e
 * non l'ha chiesto lei.
 */
export function vedeEntrare(id: string, percorso: string, evento = ''): boolean {
  // Un rinnovo delle chiavi non è un account che entra (vedi dopoEventoAccesso).
  if (evento === 'TOKEN_REFRESHED') return false;
  if (utenteDellaPagina === null || utenteDellaPagina === id) {
    utenteDellaPagina = id;
    return false;
  }
  if (cambioQui || PAGINE_DELL_ACCESSO.some((p) => percorso.startsWith(p))) {
    utenteDellaPagina = id;
    return false;
  }
  schedaFerma = true;
  return true;
}

// ─────────────────────────────────── l'elenco e gli eventi ───────────────────────────────────

/** Chi ha premuto «Aggiungi un altro account» in questa scheda, se un'aggiunta è in corso. */
export function aggiuntaIniziataDa(s: Deposito | null = scheda()): string | null {
  return leggi(s, CHIAVE_AGGIUNTA);
}

/** «Aggiungi un altro account»: salva chi c'è adesso e segna l'aggiunta in corso. */
export function iniziaAggiunta(attuale: SessioneMinima | null, d: Deposito | null = locale(), s: Deposito | null = scheda()): void {
  if (!attuale) return;
  ricordaSessione(attuale, d);
  metti(s, CHIAVE_AGGIUNTA, attuale.user.id);
}

/**
 * Da chiamare a ogni evento dell'accesso (onAuthStateChange), in tutto il sito.
 *  · SIGNED_OUT, o un accesso finito da solo (la pagina riparte e il cookie non c'è più): si dimentica
 *    tutto. Con la rete caduta all'apertura la libreria dà una sessione vuota ma il cookie resta:
 *    lì non si cancella niente (lo dice chi chiama, con `sessioneNelDeposito`).
 *  · con una sessione: i dati del browser diventano suoi (la regola sopra); un accesso già salvato si
 *    rinfresca (la libreria cambia le chiavi da sola, e una chiave vecchia usata di nuovo fa chiudere
 *    tutta la sessione); durante un'aggiunta il nuovo account si salva e l'aggiunta finisce.
 *  · chi non ha mai aggiunto un account non ha niente nell'elenco: lì non si scrive niente.
 */
export function dopoEventoAccesso(
  evento: string,
  sessione: SessioneMinima | null,
  d: Deposito | null = locale(),
  s: Deposito | null = scheda(),
  dove: { sessioneNelDeposito?: boolean } = {},
): void {
  const finita = evento === 'INITIAL_SESSION' && !sessione?.user?.id && dove.sessioneNelDeposito === false;
  if (evento === 'SIGNED_OUT' || finita) {
    // 28/11/2026 (R01-012, onda 2) — L'accesso finito da solo arriva come INITIAL_SESSION vuota, non
    // come SIGNED_OUT: la bozza della cassa (nome, telefono, indirizzo) restava nel browser per chi
    // veniva dopo. Se i dati del browser erano di un account, se ne va come all'«Esci»
    // (components/providers/QueryProvider.tsx). Se non erano di nessuno è la bozza di un ospite che
    // sta andando ad accedere (la pagina di accesso riparte senza sessione): resta.
    if (finita && leggi(d, CHIAVE_UTENTE_DEL_BROWSER)) {
      togli(d, BOZZA_DELLA_CASSA);
      togli(s, BOZZA_DELLA_CASSA);
    }
    dimenticaTutti(d, s);
    return;
  }
  if (!sessione?.user?.id || !sessione.access_token || !sessione.refresh_token) return;
  const id = sessione.user.id;
  // Un rinnovo delle chiavi non cambia chi è dentro: non sposta i dati del browser. Arrivato in ritardo
  // da un'altra scheda, riporterebbe i dati all'account di prima subito dopo un cambio (quinto collaudo).
  if (evento !== 'TOKEN_REFRESHED') allineaUtenteDelBrowser(id, d);
  const daChi = aggiuntaIniziataDa(s);
  const salvato = leggiAccount(d).some((a) => a.id === id);
  if (salvato || daChi) ricordaSessione(sessione, d);
  if (daChi && (daChi !== id || evento === 'SIGNED_IN')) togli(s, CHIAVE_AGGIUNTA);
}

/** «Aggiungi un altro account»: salva chi c'è e manda su il suo carrello. Risponde dove andare. */
export async function preparaAggiunta(
  m: Pick<MondoDelCambio, 'sessioneAttuale' | 'salvaCarrello'>,
  d: Deposito | null = locale(),
  s: Deposito | null = scheda(),
): Promise<string> {
  const attuale = await m.sessioneAttuale();
  if (attuale) {
    iniziaAggiunta(attuale, d, s);
    allineaUtenteDelBrowser(attuale.user.id, d);
    await m.salvaCarrello(attuale.user.id).catch(() => undefined);
  }
  return '/sign-in?aggiungi=1';
}

// ──────────────────────────────────────── il cambio ────────────────────────────────────────

/**
 * Rinnova un accesso salvato con una chiamata a parte (l'endpoint dei token di Supabase), senza
 * toccare la sessione attiva. Risponde la sessione nuova, o `null` se l'accesso non vale più.
 * Una rete caduta lancia: non vuol dire che l'accesso sia scaduto.
 */
export async function rinnovaAccesso(
  refreshToken: string,
  opz: { url: string; chiave: string; fetch?: typeof fetch },
): Promise<SessioneMinima | null> {
  const chiama = opz.fetch ?? fetch;
  const r = await chiama(`${opz.url.replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: opz.chiave, authorization: `Bearer ${opz.chiave}`, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  // Solo un rifiuto vero dice che l'accesso non vale più; «troppe richieste» (429) e i guasti del
  // servizio sono passeggeri e non devono far cancellare l'account salvato.
  if (r.status === 400 || r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`servizio dell'accesso non disponibile (${r.status})`);
  const corpo = (await r.json().catch(() => null)) as Partial<SessioneMinima> | null;
  if (!corpo?.access_token || !corpo.refresh_token || !corpo.user?.id) return null;
  return { access_token: corpo.access_token, refresh_token: corpo.refresh_token, user: corpo.user };
}

export type EsitoCambio =
  | { ok: true; dove: string }
  | { ok: false; motivo: 'sconosciuto' | 'scaduto' | 'rete' | 'gia-attivo'; email: string | null };

/** Dove atterra chi passa a un account: la home del suo ruolo, come dopo l'accesso. */
export function casaDelRuolo(ruolo: string | null | undefined): string {
  if (ruolo === 'admin') return '/admin';
  if (ruolo === 'seller') return '/seller/dashboard';
  if (ruolo === 'rider') return '/rider';
  return '/';
}

/** Quello che il cambio usa del mondo: il client dell'accesso, il carrello sul server, la rete. */
export type MondoDelCambio = {
  sessioneAttuale: () => Promise<SessioneMinima | null>;
  installa: (s: { access_token: string; refresh_token: string }) => Promise<{ error: unknown }>;
  ruoloDi: (id: string) => Promise<string | null>;
  /**
   * Manda su il carrello dell'account che si lascia (mentre è ancora lui l'attivo). Se non riesce
   * lancia: il carrello resta comunque da parte per lui nel browser, e torna con lui.
   */
  salvaCarrello: (id: string) => Promise<void>;
  rinnova: (refreshToken: string) => Promise<SessioneMinima | null>;
  deposito?: Deposito | null;
};

/**
 * «Passa a questo account».
 *  0. se è già l'account attivo, o non si sa chi è attivo, non si fa niente;
 *  1. l'accesso salvato si rinnova a parte: se non vale più si toglie dall'elenco e l'attivo resta;
 *  2. chi si lascia si salva con le chiavi di adesso, e il suo carrello sale sul server;
 *  3. questa scheda smette di salvare bozze, e il nuovo accesso si installa. Entrando, la regola
 *     sposta da parte carrello e bozze di chi esce (la chiamano la sincronizzazione del carrello e
 *     RicordaAccount, e qui sotto per sicurezza); se l'installazione non riesce non si è mosso niente;
 *  4. si risponde dove andare (la home del ruolo): la pagina si ricarica da capo.
 */
export async function cambiaAccount(id: string, m: MondoDelCambio): Promise<EsitoCambio> {
  const d = m.deposito === undefined ? locale() : m.deposito;
  const destinazione = leggiAccount(d).find((a) => a.id === id);
  if (!destinazione) return { ok: false, motivo: 'sconosciuto', email: null };
  const attuale = await m.sessioneAttuale();
  if (attuale?.user.id === id) return { ok: false, motivo: 'gia-attivo', email: destinazione.email };
  if (!attuale) return { ok: false, motivo: 'rete', email: destinazione.email };

  let nuova: SessioneMinima | null;
  try {
    nuova = await m.rinnova(destinazione.refreshToken);
  } catch {
    return { ok: false, motivo: 'rete', email: destinazione.email };
  }
  if (!nuova || nuova.user.id !== id) {
    dimenticaAccount(id, d);
    return { ok: false, motivo: 'scaduto', email: destinazione.email };
  }
  // Le chiavi appena rinnovate sono le sole buone: quelle vecchie sono già state usate.
  ricordaSessione(nuova, d);
  ricordaSessione(attuale, d);
  allineaUtenteDelBrowser(attuale.user.id, d);
  await m.salvaCarrello(attuale.user.id).catch(() => undefined);

  cambioQui = true;
  schedaFerma = true;
  segnaInCorso(id, d);
  const { error } = await m.installa({ access_token: nuova.access_token, refresh_token: nuova.refresh_token });
  if (error) {
    cambioQui = false;
    schedaFerma = false;
    togli(d, CHIAVE_IN_CORSO);
    return { ok: false, motivo: 'rete', email: destinazione.email };
  }
  // Di solito l'hanno già fatto i due ascolti dell'accesso entrando; qui per sicurezza (non fa niente due volte).
  allineaUtenteDelBrowser(id, d);
  const ruolo = await m.ruoloDi(id).catch(() => null);
  return { ok: true, dove: casaDelRuolo(ruolo) };
}
