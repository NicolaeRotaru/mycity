/**
 * Error messages user-friendly — single source of truth.
 *
 * Esperti consultati:
 * - Content Designer: "Codici SQL/HTTP all'utente = perdita di fiducia istantanea.
 *   Italiano semplice, soluzione concreta, no panic tone."
 * - Trust & Safety: "Mai esporre dettagli interni (table name, column name,
 *   stack trace) all'utente esterno."
 */

import { trackErrorShown } from './analytics/events';

const SUPABASE_CODE_MAP: Record<string, string> = {
  '23505': 'Questo valore è già stato usato. Prova con uno diverso.',
  '23503': 'Impossibile completare: l\'elemento collegato non esiste più.',
  '23502': 'Manca un dato obbligatorio.',
  '23514': 'Il valore inserito non è valido.',
  '42501': 'Non hai i permessi per questa azione.',
  'PGRST116': 'Non trovato.',
  'PGRST204': 'Nessun risultato.',
  '22P02': 'Formato non valido.',
};

const GENERIC_FALLBACK = 'Qualcosa non ha funzionato. Riprova fra un momento.';

/**
 * GLI ERRORI DI SUPABASE AUTH, IN ITALIANO — o `null` se non lo riconosco.
 *
 * PERCHÉ ESISTE QUI. Una funzione con lo stesso mestiere viveva dentro
 * `app/sign-in/page.tsx`, non esportata: la usava solo quella pagina. Registrazione,
 * cambio password e cambio email chiamavano `friendlyError`, che di errori Auth non
 * sapeva niente — ha le mappe dei codici Postgres e dei guasti di rete, e nient'altro.
 * Il messaggio grezzo passava i filtri finali (meno di 200 caratteri, una riga sola,
 * comincia per lettera) e usciva tale e quale. L'errore più comune della
 * registrazione, «User already registered», arrivava così al cliente piacentino.
 *
 * PERCHÉ TORNA `null` INVECE DI UNA FRASE DI RIPIEGO. Il ripiego giusto dipende da
 * dove sei: «Accesso non riuscito» sull'accesso, «Registrazione non riuscita» sulla
 * registrazione. Una funzione condivisa che sceglie da sé ne sbaglierebbe due su tre.
 * Qui si traduce solo ciò che si riconosce; il ripiego lo mette chi chiama.
 *
 * PERCHÉ SOLO FRASI SPECIFICHE. La versione dentro sign-in finiva con due reti larghe
 * — `includes('password')`, `includes('email')` — che su quella schermata vanno bene
 * perché lì gli errori possibili sono solo di accesso. Dentro `friendlyError`, che
 * vede ogni errore dell'applicazione, quelle due reti tradurrebbero in «Password non
 * valida» un guasto che con l'accesso non c'entra niente. Qui restano fuori: sono la
 * coda di sign-in, non una regola generale.
 */
export function traduciErroreAuth(msg: string): string | null {
  const m = String(msg || '').toLowerCase();
  if (!m) return null;

  // Il gettone anti-bot vale una volta sola: dopo un tentativo andato male il server
  // lo rifiuta, e il messaggio grezzo parla di captcha su una schermata dove non c'e'
  // niente da premere.
  if (m.includes('captcha') || m.includes('turnstile'))
    return 'Il controllo anti-bot è scaduto: è stato rigenerato, premi di nuovo.';
  if (m.includes('invalid login credentials')) return 'Email o password non corrette';
  if (m.includes('email not confirmed'))
    return 'Email non confermata. Controlla la posta e clicca sul link che ti abbiamo inviato.';
  if (m.includes('user not found')) return 'Nessun account con questa email';

  // I quattro della registrazione e del cambio password, che prima uscivano in inglese.
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'Esiste già un account con questa email. Prova ad accedere.';
  if (m.includes('password should be at least')) {
    const n = m.match(/at least (\d+)/)?.[1];
    return n ? `La password deve essere di almeno ${n} caratteri` : 'La password è troppo corta';
  }
  if (m.includes('unable to validate email address') || m.includes('invalid email'))
    return 'Questa email non sembra valida. Controlla come l’hai scritta.';
  if (m.includes('email rate limit exceeded'))
    return 'Abbiamo già inviato troppe email a questo indirizzo. Riprova fra qualche minuto.';
  if (m.includes('new password should be different'))
    return 'La password nuova deve essere diversa da quella attuale';
  if (m.includes('same password'))
    return 'La password nuova deve essere diversa da quella attuale';

  // `rate limit` generico NON sta qui, ed e' una correzione che mi ha fatto la suite:
  // spostandolo dentro la funzione condivisa rubavo il caso a `friendlyError`, che lo
  // trattava gia' e con parole sue («Troppe richieste in poco tempo»). Una rete larga
  // messa in una funzione che vede TUTTI gli errori si prende anche quelli di altri.
  // Resta qui solo `email rate limit exceeded`, che e' di Auth e sta piu' sopra.
  // La rete larga vive nel ripiego di sign-in, dov'era prima.

  return null;
}

/**
 * Trasforma errori Supabase/Stripe/fetch in messaggi user-friendly italiani.
 * Logga il messaggio originale per debugging via PostHog.
 */
export function friendlyError(err: unknown, context?: { page?: string; action?: string }): string {
  if (!err) return GENERIC_FALLBACK;

  // Supabase PostgrestError style
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: string; message?: string; status?: number };
    if (e.code && SUPABASE_CODE_MAP[e.code]) {
      trackErrorShown(e.code, e.message ?? '', context?.page);
      return SUPABASE_CODE_MAP[e.code];
    }
    if (e.message) {
      /**
       * 3/9/2026 — «LA SESSIONE È SCADUTA» DAVANTI A CHI AVEVA LA CARTA IN MANO.
       *
       * Quando il gateway risponde con la SUA pagina di errore — «504 GATEWAY
       * TIMEOUT» in HTML, o un 502, o un 413 — `res.json()` non trova JSON e
       * lancia «Unexpected token '<'» su Chrome, «JSON Parse error: Unrecognized
       * token '<'» su Safari. La parola «token» accendeva il ramo qui sotto e il
       * cliente leggeva «La sessione è scaduta. Accedi di nuovo.»: usciva
       * dall'account, rientrava, e spesso non tornava. Ordine perso al passo che
       * incassa, per un guasto che con la sessione non c'entra niente.
       *
       * Un errore si riconosce dal TIPO, non da una parola nel testo: qui si
       * guarda `SyntaxError` (ed è quello che lancia il parser) prima di ogni
       * espressione regolare.
       */
      if (err instanceof SyntaxError || /json parse error|unexpected token|unexpected end of json|is not valid json/i.test(e.message)) {
        trackErrorShown('risposta_non_json', e.message, context?.page);
        return 'Il server non ha risposto correttamente. Riprova fra qualche secondo.';
      }
      // Gli errori di Supabase Auth prima non li conosceva nessuno qui dentro, e uscivano
      // in inglese sulla registrazione e sul cambio password. `traduciErroreAuth` torna
      // `null` su tutto ciò che non riconosce, quindi non ruba niente ai rami sotto.
      const inItaliano = traduciErroreAuth(e.message);
      if (inItaliano) {
        trackErrorShown(e.code ?? 'auth', e.message, context?.page);
        return inItaliano;
      }
      // Fix #17: trackErrorShown in ogni ramo (era tracciato solo per i codici Supabase mappati).
      if (/duplicate key value/i.test(e.message)) {
        trackErrorShown('duplicate_key', e.message, context?.page);
        return SUPABASE_CODE_MAP['23505'];
      }
      if (/foreign key constraint/i.test(e.message)) {
        trackErrorShown('foreign_key', e.message, context?.page);
        return SUPABASE_CODE_MAP['23503'];
      }
      if (/permission denied|insufficient_privilege|row.level security/i.test(e.message)) {
        trackErrorShown('permission_denied', e.message, context?.page);
        return 'Non hai i permessi per questa azione.';
      }
      if (/network|fetch|timeout|aborted/i.test(e.message)) {
        trackErrorShown('network', e.message, context?.page);
        return 'Problema di connessione. Controlla la rete e riprova.';
      }
      if (/rate.limit|too many/i.test(e.message)) {
        trackErrorShown('rate_limit', e.message, context?.page);
        return 'Troppe richieste in poco tempo. Aspetta qualche secondo.';
      }
      // La rete era larghissima: bastava la parola «token» o «expired» in un
      // messaggio qualsiasi per mandare fuori l'utente. Adesso si riconoscono le
      // frasi vere di Supabase Auth, non una parola sola.
      if (
        e.status === 401 ||
        /\bjwt\b|refresh token|token (is |has )?expired|session (is |has )?expired|not authenticated|unauthoriz/i.test(e.message)
      ) {
        trackErrorShown('session_expired', e.message, context?.page);
        return 'La sessione è scaduta. Accedi di nuovo.';
      }
      trackErrorShown(e.code ?? 'unknown', e.message, context?.page);
      // Strip technical details
      const cleaned = e.message
        .replace(/\b[A-Z_]+\s*=\s*[^\s,]+/g, '')
        .replace(/\(.*?\)/g, '')
        .trim();
      // Le righe multiple sono un segnale forte di stack trace → scarta.
      // Il limite di lunghezza scarta i dump tecnici ma deve lasciar passare i
      // messaggi user-facing dei nostri endpoint (es. "<negozio> è chiuso in
      // questo momento. Riprova durante gli orari di apertura…", ~115 char):
      // con un cap a 100 venivano sostituiti dal generico, nascondendo il vero
      // motivo all'utente. 200 copre le frasi UI legittime, i veri stack trace
      // restano più lunghi.
      if (
        cleaned.length > 0 &&
        cleaned.length < 200 &&
        !cleaned.includes('\n') &&
        /^[a-zA-ZÀ-ſ]/.test(cleaned)
      ) {
        return cleaned;
      }
    }
    if (e.status) {
      // Fix #17: trackErrorShown per i codici HTTP (401/403/404/429/5xx).
      const statusLabel = e.status >= 500 ? 'http_5xx' : `http_${e.status}`;
      trackErrorShown(statusLabel, `HTTP ${e.status}`, context?.page);
      if (e.status === 401) return 'Devi accedere per continuare.';
      if (e.status === 403) return 'Non hai i permessi per questa azione.';
      if (e.status === 404) return 'Non trovato.';
      if (e.status === 429) return 'Troppe richieste. Aspetta un attimo.';
      if (e.status >= 500) return 'Problema del server. Riproveremo tra poco.';
    }
  }

  if (typeof err === 'string') return err;
  return GENERIC_FALLBACK;
}

/**
 * Estrae il messaggio d'errore dal body JSON di una API route, gestendo
 * SIA il formato ApiErrors `{ ok: false, error: { code, message } }` SIA
 * il formato legacy `{ error: "stringa" }`.
 *
 * Necessario perché molti endpoint usano ApiErrors (error = oggetto): fare
 * `new Error(body.error)` darebbe "[object Object]". Usare sempre questo.
 *
 *   const body = await res.json().catch(() => ({}));
 *   if (!res.ok) throw new Error(apiErrorMessage(body, 'Operazione fallita'));
 */
export function apiErrorMessage(body: unknown, fallback = 'Operazione non riuscita'): string {
  if (!body || typeof body !== 'object') return fallback;
  const e = (body as { error?: unknown }).error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}
