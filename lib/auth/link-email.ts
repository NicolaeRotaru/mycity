/**
 * 15/10/2026 (R13) — IL LINK DELL'EMAIL DEVE FUNZIONARE SU QUALUNQUE DISPOSITIVO.
 *
 * IL DIFETTO. Il client Supabase del browser usa il flusso PKCE: il link che
 * arriva per email porta un `code`, e quel codice si scambia con una sessione
 * solo se c'e' anche l'altra meta' del segreto (il «code verifier»), che sta in
 * un cookie del browser che ha fatto la richiesta. Chi chiede la nuova password
 * dal computer e apre l'email dal telefono — o dal browser interno dell'app di
 * posta — quel cookie non ce l'ha: la pagina /reset-password ripiegava in
 * silenzio sulla vista «Inserisci la tua email», come se non avesse fatto
 * niente. La conferma dell'iscrizione finiva su /sign-in?error=callback_failed,
 * e la pagina di accesso quell'errore non lo leggeva.
 *
 * LA RIPARAZIONE, in due tempi:
 *  ① la strada vera: il link dell'email porta un `token_hash` e va su
 *    /auth/confirm, che lo verifica sul server con `verifyOtp`. Non serve nessun
 *    cookie del browser di partenza: funziona da qualunque dispositivo. Diventa
 *    la strada di tutti quando i modelli delle email su Supabase puntano li'.
 *  ② finche' i modelli non cambiano, i link di oggi (`?code=`) continuano a
 *    funzionare nello stesso browser, e quando non possono funzionare la pagina
 *    DICE perche' e cosa fare, invece di ricominciare da capo in silenzio.
 *
 * Qui sta la logica che decide; le rotte e le pagine la chiamano.
 */
import { safeInternalPath } from '@/lib/safe-redirect';

/** I tipi di link che Supabase sa verificare con `verifyOtp({ token_hash, type })`. */
export const TIPI_LINK_EMAIL = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;
export type TipoLinkEmail = (typeof TIPI_LINK_EMAIL)[number];

/** Dove porta il link per cambiare la password, sempre. */
export const PAGINA_NUOVA_PASSWORD = '/reset-password';

type Parametri = { get(nome: string): string | null };

function tipoValido(grezzo: string | null): TipoLinkEmail | null {
  return (TIPI_LINK_EMAIL as readonly string[]).includes(grezzo ?? '') ? (grezzo as TipoLinkEmail) : null;
}

/** Base finta: serve solo a smontare un percorso relativo nei suoi pezzi. */
const CASA = 'http://percorso.interno';

/**
 * Il percorso interno a cui tornare, da quello che arriva nel link.
 *
 * Il modello dell'email puo' passarci `{{ .RedirectTo }}`, che e' un indirizzo
 * INTERO (`https://…/auth/callback?next=%2Fcheckout…`): qui se ne tiene solo il
 * percorso, e se il percorso e' a sua volta una porta d'ingresso (/auth/callback,
 * /auth/confirm) se ne prende il `next` di dentro. Del dominio non ci si fida
 * mai: si ritorna sempre a casa nostra, e da `safeInternalPath` passa tutto.
 */
export function percorsoDiRitorno(grezzo: string | null | undefined, ripiego = '/', profondita = 0): string {
  if (typeof grezzo !== 'string' || !grezzo.trim()) return ripiego;
  let percorso = grezzo.trim();
  if (/^https?:\/\//i.test(percorso)) {
    try {
      const assoluto = new URL(percorso);
      percorso = `${assoluto.pathname}${assoluto.search}${assoluto.hash}`;
    } catch {
      return ripiego;
    }
  }
  const sicuro = safeInternalPath(percorso, '');
  if (!sicuro) return ripiego;
  const pezzi = new URL(sicuro, CASA);
  if (pezzi.pathname === '/auth/callback' || pezzi.pathname === '/auth/confirm') {
    if (profondita >= 2) return ripiego;
    return percorsoDiRitorno(pezzi.searchParams.get('next'), ripiego, profondita + 1);
  }
  return sicuro;
}

export type LinkDiConferma =
  | { valido: true; tokenHash: string; tipo: TipoLinkEmail; next: string }
  | { valido: false; tipo: TipoLinkEmail | null; next: string };

/**
 * Legge il link `/auth/confirm?token_hash=…&type=…&next=…`.
 *
 * Il token_hash di Supabase e' un'impronta esadecimale, a volte col prefisso
 * `pkce_`: lettere, cifre, trattino e trattino basso. Qualunque altra cosa non
 * e' un link nostro e non si manda nemmeno a Supabase.
 */
export function leggiLinkDiConferma(params: Parametri): LinkDiConferma {
  const tipo = tipoValido(params.get('type'));
  // Il link della password porta sempre alla pagina della password: un `next`
  // diverso non serve a niente e aprirebbe una porta in piu'.
  const next = tipo === 'recovery' ? PAGINA_NUOVA_PASSWORD : percorsoDiRitorno(params.get('next'), '/');
  const tokenHash = (params.get('token_hash') ?? '').trim();
  if (!tipo || !/^[A-Za-z0-9_-]{8,256}$/.test(tokenHash)) return { valido: false, tipo, next };
  return { valido: true, tokenHash, tipo, next };
}

/** Perche' un link non ha aperto una sessione. */
export type MotivoLinkNonRiuscito = 'link_scaduto' | 'link_non_valido';

/**
 * Dove va chi ha un link che non ha funzionato: mai una pagina muta.
 * Il link della password torna alla pagina della password, con il motivo; gli
 * altri vanno all'accesso, con il motivo e la strada da cui si veniva.
 */
export function rimandoLinkNonRiuscito(
  tipo: TipoLinkEmail | null,
  motivo: MotivoLinkNonRiuscito,
  next = '/',
): string {
  if (tipo === 'recovery') return `${PAGINA_NUOVA_PASSWORD}?errore=${motivo}`;
  return paginaDiAccesso(motivo, next);
}

function paginaDiAccesso(errore: string, next: string): string {
  const dove = new URLSearchParams({ error: errore });
  if (next && next !== '/') dove.set('returnTo', next);
  return `/sign-in?${dove.toString()}`;
}

/**
 * Dove va chi ha appena confermato col token_hash. Porta gli stessi segnali
 * del ritorno da /auth/callback (`auth`, `via`), cosi' la pagina d'arrivo conta
 * l'iscrizione o l'accesso come prima.
 */
export function destinazioneDopoLaConferma(base: string, link: { tipo: TipoLinkEmail; next: string }): URL {
  const dove = new URL(link.next, base);
  if (link.tipo === 'recovery') return dove;
  dove.searchParams.set('auth', link.tipo === 'signup' || link.tipo === 'invite' ? 'signup' : 'signin');
  dove.searchParams.set('via', 'email');
  return dove;
}

/** Supabase, quando il link e' scaduto o gia' usato, rimanda con questi parametri. */
function haErroreDiSupabase(params: Parametri): boolean {
  return !!(params.get('error') || params.get('error_code') || params.get('error_description'));
}

/**
 * Il ritorno su /auth/callback non ha aperto una sessione: dove va la persona.
 *
 *  - Supabase ha gia' detto «link scaduto o gia' usato» → lo diciamo.
 *  - Manca il codice → link incompleto (o con la sessione nel frammento, che il
 *    server non vede: la pagina di accesso lo riconosce da sola).
 *  - Lo scambio del codice e' fallito: se il link veniva dall'email (nessuna
 *    `versione`, che mette solo il pulsante Google), l'email E' gia' confermata —
 *    Supabase manda il codice solo DOPO aver verificato il link — e manca solo
 *    il cookie del browser di partenza. Lo diciamo, e si accede con la password.
 */
export function rimandoDelRitornoSenzaSessione(
  params: Parametri,
  next: string,
  motivo: 'senza-codice' | 'scambio-fallito',
): string {
  if (haErroreDiSupabase(params)) return paginaDiAccesso('link_scaduto', next);
  if (motivo === 'senza-codice') return paginaDiAccesso('missing_code', next);
  if (params.get('versione')) return paginaDiAccesso('accesso_non_riuscito', next);
  return paginaDiAccesso('email_confermata', next);
}

/** Legge il frammento `#a=1&b=2` come parametri. */
function parametriDelFrammento(frammento: string | null | undefined): URLSearchParams {
  return new URLSearchParams((frammento ?? '').replace(/^#/, ''));
}

/** Il frammento porta una sessione (il link «implicito» di Supabase)? */
export function frammentoConSessione(frammento: string | null | undefined): boolean {
  const p = parametriDelFrammento(frammento);
  return !!(p.get('access_token') || p.get('refresh_token'));
}

export type AvvisoDiAccesso = { tono: 'info' | 'errore'; testo: string };

const TESTO_EMAIL_CONFERMATA =
  'La tua email è confermata. Ora accedi con la tua email e la password che hai scelto.';
const TESTO_LINK_SCADUTO =
  'Il link che hai aperto è scaduto o è già stato usato. Prova ad accedere: se l’email non risulta ancora confermata, ti aiutiamo a fartene mandare uno nuovo.';

/**
 * Cosa dice la pagina di accesso a chi ci arriva da un link che non ha aperto
 * la sessione. Prima leggeva solo `returnTo`, e l'errore restava nell'indirizzo
 * senza che nessuno lo spiegasse. `null` = nessun avviso.
 */
export function avvisoAlRitornoSullAccesso(
  errore: string | null | undefined,
  frammento?: string | null,
): AvvisoDiAccesso | null {
  const f = parametriDelFrammento(frammento);
  const erroreNelFrammento = !!(f.get('error') || f.get('error_code') || f.get('error_description'));
  switch (errore) {
    case 'email_confermata':
      return { tono: 'info', testo: TESTO_EMAIL_CONFERMATA };
    case 'link_scaduto':
      return { tono: 'errore', testo: TESTO_LINK_SCADUTO };
    case 'link_non_valido':
      return {
        tono: 'errore',
        testo: 'Il link che hai aperto non è completo: forse si è spezzato copiandolo. Prova ad accedere qui sotto.',
      };
    case 'callback_failed':
      // Il nome di prima, se qualcuno ha l'indirizzo salvato: copre sia la
      // conferma dell'email aperta su un altro dispositivo, sia il resto.
      return {
        tono: 'info',
        testo:
          'Il link non ha completato l’accesso da questo dispositivo. Se stavi confermando l’email, è già confermata: accedi qui sotto con email e password.',
      };
    case 'accesso_non_riuscito':
      return { tono: 'errore', testo: 'L’accesso non è andato a buon fine. Riprova.' };
    case 'missing_code': {
      if (erroreNelFrammento) return { tono: 'errore', testo: TESTO_LINK_SCADUTO };
      const tipo = f.get('type');
      if (frammentoConSessione(frammento) && tipo !== 'recovery') return { tono: 'info', testo: TESTO_EMAIL_CONFERMATA };
      return {
        tono: 'errore',
        testo: 'Il link che hai aperto non è completo. Prova ad accedere qui sotto con email e password.',
      };
    }
    default:
      return null;
  }
}

/** Perche' la pagina della nuova password non ha una sessione da usare. */
export type MotivoResetSenzaSessione = 'altro-browser' | 'link-scaduto' | 'link-non-valido';

/**
 * Chi arriva su /reset-password senza una sessione: ha aperto un link che non
 * poteva funzionare qui (e va detto), o e' venuto a chiederne uno (e basta il
 * modulo)? `null` = nessun link, nessuna spiegazione da dare.
 */
export function motivoLinkPasswordSenzaSessione(query: Parametri, frammento?: string | null): MotivoResetSenzaSessione | null {
  const f = parametriDelFrammento(frammento);
  const errore = query.get('errore');
  if (errore === 'link_non_valido') return 'link-non-valido';
  if (
    errore === 'link_scaduto' ||
    haErroreDiSupabase(query) ||
    !!(f.get('error') || f.get('error_code') || f.get('error_description'))
  ) {
    return 'link-scaduto';
  }
  if (query.get('code')) return 'altro-browser';
  return null;
}

/** Le parole che la pagina della nuova password mostra, per ogni motivo. */
export const SPIEGAZIONE_RESET: Record<MotivoResetSenzaSessione, { titolo: string; testo: string }> = {
  'altro-browser': {
    titolo: 'Questo link va aperto dove l’hai chiesto',
    testo:
      'Il link per la nuova password funziona solo nel browser da cui l’hai chiesto. Succede se l’hai chiesto dal computer e lo apri dal telefono, o se l’app della posta lo apre al suo interno. Aprilo nel browser di partenza, oppure chiedi qui sotto un link nuovo e aprilo in questo stesso browser.',
  },
  'link-scaduto': {
    titolo: 'Il link è scaduto',
    testo: 'Questo link per la nuova password è scaduto o è già stato usato. Chiedine uno nuovo qui sotto.',
  },
  'link-non-valido': {
    titolo: 'Il link non è completo',
    testo: 'Il link che hai aperto non è completo: forse si è spezzato copiandolo. Chiedine uno nuovo qui sotto.',
  },
};
