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
 * cinque account; per ognuno id, email, nome e la coppia di chiavi dell'accesso.
 *
 * Qui non c'è React né il client di Supabase: le funzioni ricevono quello che usano, così le prove
 * le fanno girare senza browser.
 */

export const CHIAVE_ACCOUNT = 'mycity:account-salvati';
/** Nella scheda (sessionStorage): l'id di chi ha premuto «Aggiungi un altro account». */
export const CHIAVE_AGGIUNTA = 'mycity:aggiunta-account';
export const MASSIMO_ACCOUNT = 5;
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

type Deposito = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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
export function leggiAccount(d: Deposito | null = locale()): AccountSalvato[] {
  try {
    const grezzo = JSON.parse(d?.getItem(CHIAVE_ACCOUNT) ?? '[]') as unknown;
    return Array.isArray(grezzo) ? grezzo.filter(valido).slice(0, MASSIMO_ACCOUNT) : [];
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
  if (evento === 'SIGNED_OUT') {
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
  }
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
  if (r.status >= 500) throw new Error(`servizio dell'accesso non raggiungibile (${r.status})`);
  if (!r.ok) return null;
  const corpo = (await r.json().catch(() => null)) as Partial<SessioneMinima> | null;
  if (!corpo?.access_token || !corpo.refresh_token || !corpo.user?.id) return null;
  return { access_token: corpo.access_token, refresh_token: corpo.refresh_token, user: corpo.user };
}

export type EsitoCambio =
  | { ok: true; dove: string }
  | { ok: false; motivo: 'sconosciuto' | 'scaduto' | 'rete'; email: string | null };

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

  const attuale = await m.sessioneAttuale();
  if (attuale && attuale.user.id !== id) {
    ricordaSessione(attuale, d);
    await m.salvaCarrello(attuale.user.id).catch(() => undefined);
  }

  const ripristina = m.svuotaCarrello();
  const { error } = await m.installa({ access_token: nuova.access_token, refresh_token: nuova.refresh_token });
  if (error) {
    ripristina();
    return { ok: false, motivo: 'rete', email: destinazione.email };
  }
  const ruolo = await m.ruoloDi(id).catch(() => null);
  return { ok: true, dove: casaDelRuolo(ruolo) };
}
