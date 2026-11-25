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
 *  · «Esci» chiude l'account attivo sul server e dimentica tutti gli accessi salvati su questo
 *    dispositivo: chi esce da un computer condiviso non lascia dietro chiavi di nessuno.
 *
 * COSA SI SALVA E DOVE: nel localStorage del browser, che è lo stesso posto dove la libreria tiene
 * già la sessione attiva (nei cookie leggibili dal browser): nessuna esposizione nuova. Al massimo
 * cinque account; per ognuno id, email, nome e la coppia di chiavi dell'accesso. Un accesso salvato
 * da più di 6 mesi si scarta, come il cookie dell'accesso (lib/supabase/client.ts).
 *
 * DAL COLLAUDO DEL 25/11 (sera):
 *  · le bozze che il sito tiene nel browser senza dire di chi sono (il nuovo prodotto, la cassa, il
 *    lavoro dell'AI, l'indirizzo suggerito) si mettono da parte per account a ogni cambio e a ogni
 *    aggiunta, e tornano quando si torna su quell'account: la bozza del negozio A non compare nel B;
 *  · anche «Aggiungi un altro account» mette da parte il carrello: entrando, il sito l'avrebbe
 *    fuso nel carrello del nuovo account, anche sul server;
 *  · un accesso finito senza «Esci» (cookie scaduto o revocato: la pagina riparte senza sessione)
 *    dimentica tutto come «Esci»: chi entra dopo non deve trovare «Passa a…» di nessuno;
 *  · dopo un cambio le altre schede aperte si ricaricano: il cookie è uno solo, e una scheda rimasta
 *    col modulo del negozio di prima scriverebbe col nuovo account.
 *
 * Qui non c'è React né il client di Supabase: le funzioni ricevono quello che usano, così le prove
 * le fanno girare senza browser.
 */

export const CHIAVE_ACCOUNT = 'mycity:account-salvati';
/** Nella scheda (sessionStorage): l'id di chi ha premuto «Aggiungi un altro account». */
export const CHIAVE_AGGIUNTA = 'mycity:aggiunta-account';
export const MASSIMO_ACCOUNT = 5;
/** Quanto vale un accesso salvato: 6 mesi, come il cookie dell'accesso (DURATA_MASSIMA_SESSIONE_S). */
export const DURATA_ACCESSO_SALVATO_MS = 180 * 24 * 60 * 60 * 1000;
/** Scritta a ogni cambio: le ALTRE schede la sentono (evento «storage») e si ricaricano. */
export const CHIAVE_CAMBIO = 'mycity:cambio-account';
/** Le bozze del browser che appartengono a un account (vedi sopra). */
export const CHIAVI_DELL_ACCOUNT = ['mc_new_product_draft', 'mc_checkout_draft', 'mycity:ai-batch:lavoro', 'mc_addr_hint'] as const;
const DA_PARTE = 'mycity:da-parte:';
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
    const grezzo = JSON.parse(d?.getItem(CHIAVE_ACCOUNT) ?? '[]') as unknown;
    return Array.isArray(grezzo)
      ? grezzo.filter(valido).filter((a) => ora - Number(a.salvatoIl ?? 0) <= DURATA_ACCESSO_SALVATO_MS).slice(0, MASSIMO_ACCOUNT)
      : [];
  } catch {
    return [];
  }
}

function scrivi(lista: AccountSalvato[], d: Deposito | null) {
  try {
    if (lista.length === 0) d?.removeItem(CHIAVE_ACCOUNT);
    else d?.setItem(CHIAVE_ACCOUNT, JSON.stringify(lista.slice(0, MASSIMO_ACCOUNT)));
  } catch { /* deposito pieno o chiuso: si resta con un account solo, come prima */ }
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
  const prima = leggiAccount(d).find((a) => a.id === voce.id);
  if (prima && !voce.nome) voce.nome = prima.nome;
  const lista = [voce, ...leggiAccount(d).filter((a) => a.id !== voce.id)];
  scrivi(lista, d);
  return lista;
}

export function dimenticaAccount(id: string, d: Deposito | null = locale()): void {
  scrivi(leggiAccount(d).filter((a) => a.id !== id), d);
}

export function dimenticaTutti(d: Deposito | null = locale(), s: Deposito | null = scheda()): void {
  scrivi([], d);
  try { s?.removeItem(CHIAVE_AGGIUNTA); } catch { /* noop */ }
  // Anche le bozze messe da parte per gli altri account: contengono indirizzi e prodotti di altri.
  try {
    const chiavi: string[] = [];
    for (let i = 0; i < (d?.length ?? 0); i++) {
      const k = d?.key?.(i);
      if (k?.startsWith(DA_PARTE)) chiavi.push(k);
    }
    for (const k of chiavi) d?.removeItem(k);
  } catch { /* noop */ }
}

/**
 * Mette da parte le bozze di chi esce (sotto il suo id) e le toglie dal browser. Risponde come
 * rimettere tutto com'era, se il cambio non riesce.
 */
export function metteDaParte(idDiChiEsce: string | null, d: Deposito | null = locale()): () => void {
  const prima = CHIAVI_DELL_ACCOUNT.map((k) => {
    try { return [k, d?.getItem(k) ?? null] as const; } catch { return [k, null] as const; }
  });
  const scritte: string[] = [];
  for (const [k, v] of prima) {
    try {
      if (idDiChiEsce && v !== null) { d?.setItem(`${DA_PARTE}${idDiChiEsce}:${k}`, v); scritte.push(`${DA_PARTE}${idDiChiEsce}:${k}`); }
      d?.removeItem(k);
    } catch { /* noop */ }
  }
  return () => {
    for (const [k, v] of prima) { try { if (v !== null) d?.setItem(k, v); } catch { /* noop */ } }
    for (const k of scritte) { try { d?.removeItem(k); } catch { /* noop */ } }
  };
}

/** Rimette nel browser le bozze messe da parte per quell'account, se ce ne sono. */
export function riprendi(id: string, d: Deposito | null = locale()): void {
  for (const k of CHIAVI_DELL_ACCOUNT) {
    try {
      const v = d?.getItem(`${DA_PARTE}${id}:${k}`);
      if (v !== null && v !== undefined) d?.setItem(k, v);
      d?.removeItem(`${DA_PARTE}${id}:${k}`);
    } catch { /* noop */ }
  }
}

/** Avvisa le altre schede che l'account è cambiato (lo ascolta RicordaAccount). */
export function segnaCambio(id: string, d: Deposito | null = locale(), ora = Date.now()): void {
  try { d?.setItem(CHIAVE_CAMBIO, `${id}:${ora}`); } catch { /* noop */ }
}

/** Chi ha premuto «Aggiungi un altro account» in questa scheda, se un'aggiunta è in corso. */
export function aggiuntaIniziataDa(s: Deposito | null = scheda()): string | null {
  try { return s?.getItem(CHIAVE_AGGIUNTA) ?? null; } catch { return null; }
}

/**
 * «Aggiungi un altro account»: salva chi c'è adesso e segna l'aggiunta in corso. Il nuovo accesso
 * lo salverà `dopoEventoAccesso` appena arriva.
 */
export function iniziaAggiunta(attuale: SessioneMinima | null, d: Deposito | null = locale(), s: Deposito | null = scheda()): void {
  if (!attuale) return;
  ricordaSessione(attuale, d);
  try { s?.setItem(CHIAVE_AGGIUNTA, attuale.user.id); } catch { /* noop */ }
}

/**
 * Da chiamare a ogni evento dell'accesso (onAuthStateChange), in tutto il sito.
 *  · SIGNED_OUT: si dimenticano tutti gli account del dispositivo (vedi «Esci» sopra).
 *  · un accesso già salvato si rinfresca a ogni giro: la libreria cambia le chiavi da sola
 *    (TOKEN_REFRESHED), e una chiave vecchia usata di nuovo fa chiudere tutta la sessione.
 *  · durante un'aggiunta, il nuovo account si salva e l'aggiunta finisce.
 *  · chi non ha mai aggiunto un account non ha niente di salvato: qui non si scrive niente.
 */
export function dopoEventoAccesso(
  evento: string,
  sessione: SessioneMinima | null,
  d: Deposito | null = locale(),
  s: Deposito | null = scheda(),
): void {
  // «Esci», o un accesso finito da solo (la pagina riparte senza sessione): si dimentica tutto.
  if (evento === 'SIGNED_OUT' || (evento === 'INITIAL_SESSION' && !sessione?.user?.id)) {
    if (leggiAccount(d).length > 0 || aggiuntaIniziataDa(s)) dimenticaTutti(d, s);
    return;
  }
  if (!sessione?.user?.id || !sessione.access_token || !sessione.refresh_token) return;
  const daChi = aggiuntaIniziataDa(s);
  const salvato = leggiAccount(d).some((a) => a.id === sessione.user.id);
  if (!salvato && !daChi) return;
  ricordaSessione(sessione, d);
  if (daChi && daChi !== sessione.user.id) {
    try { s?.removeItem(CHIAVE_AGGIUNTA); } catch { /* noop */ }
    riprendi(sessione.user.id, d);
    segnaCambio(sessione.user.id, d);
  }
}

/**
 * «Aggiungi un altro account»: salva chi c'è, manda su il suo carrello e mette da parte carrello e
 * bozze, così il nuovo account parte pulito. Risponde dove andare.
 */
export async function preparaAggiunta(
  m: Pick<MondoDelCambio, 'sessioneAttuale' | 'salvaCarrello' | 'svuotaCarrello'>,
  d: Deposito | null = locale(),
  s: Deposito | null = scheda(),
): Promise<string> {
  const attuale = await m.sessioneAttuale();
  if (attuale) {
    iniziaAggiunta(attuale, d, s);
    await m.salvaCarrello(attuale.user.id).catch(() => undefined);
    m.svuotaCarrello();
    metteDaParte(attuale.user.id, d);
  }
  return '/sign-in?aggiungi=1';
}

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

/** Quello che il cambio usa del mondo: il client dell'accesso, il carrello, la rete. */
export type MondoDelCambio = {
  sessioneAttuale: () => Promise<SessioneMinima | null>;
  installa: (s: { access_token: string; refresh_token: string }) => Promise<{ error: unknown }>;
  ruoloDi: (id: string) => Promise<string | null>;
  /** Manda su il carrello dell'account che si lascia (mentre è ancora lui l'attivo). */
  salvaCarrello: (id: string) => Promise<void>;
  /**
   * Mette da parte il carrello del browser (la spesa di un account non passa all'altro) e risponde
   * come rimetterlo, se il cambio non riesce. Va fatto PRIMA di installare il nuovo accesso: appena
   * entra, il sito fonde il carrello del browser con quello del nuovo account.
   */
  svuotaCarrello: () => () => void;
  rinnova: (refreshToken: string) => Promise<SessioneMinima | null>;
  deposito?: Deposito | null;
};

/**
 * «Passa a questo account».
 *  0. se è già l'account attivo non si fa niente (rinnovare la sua chiave salvata, forse vecchia,
 *     farebbe chiudere al server la sessione attiva);
 *  1. l'accesso salvato si rinnova a parte: se non vale più si toglie dall'elenco e l'attivo resta;
 *  2. chi si lascia si salva con le chiavi di adesso, e il suo carrello sale sul server;
 *  3. il carrello del browser si mette da parte e il nuovo accesso si installa; se non riesce, il
 *     carrello torna com'era e l'account attivo resta quello;
 *  4. si risponde dove andare (la home del ruolo): la pagina si ricarica da capo.
 */
export async function cambiaAccount(id: string, m: MondoDelCambio): Promise<EsitoCambio> {
  const d = m.deposito === undefined ? locale() : m.deposito;
  const destinazione = leggiAccount(d).find((a) => a.id === id);
  if (!destinazione) return { ok: false, motivo: 'sconosciuto', email: null };
  const attuale = await m.sessioneAttuale();
  if (attuale?.user.id === id) return { ok: false, motivo: 'gia-attivo', email: destinazione.email };

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

  if (attuale) {
    ricordaSessione(attuale, d);
    await m.salvaCarrello(attuale.user.id).catch(() => undefined);
  }

  const ripristina = m.svuotaCarrello();
  const ripristinaBozze = metteDaParte(attuale?.user.id ?? null, d);
  const { error } = await m.installa({ access_token: nuova.access_token, refresh_token: nuova.refresh_token });
  if (error) {
    ripristinaBozze();
    ripristina();
    return { ok: false, motivo: 'rete', email: destinazione.email };
  }
  riprendi(id, d);
  segnaCambio(id, d);
  const ruolo = await m.ruoloDi(id).catch(() => null);
  return { ok: true, dove: casaDelRuolo(ruolo) };
}
